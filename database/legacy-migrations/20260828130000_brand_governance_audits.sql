-- DadoFit V13.3 - Brand Governance, double validation and audit trail
-- Adds optional per-campaign double validation without changing existing campaigns.
-- Existing campaigns keep requires_double_validation = false.

alter table public.sponsor_campaigns
  add column if not exists requires_double_validation boolean not null default false;

alter table public.challenge_participants
  add column if not exists primary_reviewer_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists primary_reviewed_at timestamptz,
  add column if not exists audit_status text not null default 'not_required',
  add column if not exists auditor_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists audited_at timestamptz;

alter table public.challenge_participants
  drop constraint if exists challenge_participants_status_check;
alter table public.challenge_participants
  add constraint challenge_participants_status_check
  check (status in ('invited', 'accepted', 'declined', 'submitted', 'pending_audit', 'approved', 'rejected', 'expired'));

alter table public.challenge_participants
  drop constraint if exists challenge_participants_audit_status_check;
alter table public.challenge_participants
  add constraint challenge_participants_audit_status_check
  check (audit_status in ('not_required', 'pending', 'approved', 'rejected'));

alter table public.challenge_reviews
  add column if not exists review_stage text not null default 'primary';

alter table public.challenge_reviews
  drop constraint if exists challenge_reviews_review_stage_check;
alter table public.challenge_reviews
  add constraint challenge_reviews_review_stage_check
  check (review_stage in ('primary', 'audit'));

create index if not exists sponsor_campaigns_governance_v133_idx
  on public.sponsor_campaigns (organization_id, requires_double_validation, status);
create index if not exists challenge_participants_audit_v133_idx
  on public.challenge_participants (audit_status, status, primary_reviewed_at desc);
create index if not exists challenge_reviews_stage_v133_idx
  on public.challenge_reviews (review_stage, created_at desc);

-- Governance can only be changed while a campaign is not actively accepting participants.
create or replace function public.set_sponsor_campaign_double_validation(
  p_campaign_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.sponsor_campaigns%rowtype;
  v_manager_count integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_campaign
  from public.sponsor_campaigns
  where id = p_campaign_id
  for update;
  if not found then raise exception 'campaign not found'; end if;

  if not public.is_brand_manager(v_campaign.organization_id) then
    raise exception 'only Brand Owners or Admins can change governance settings';
  end if;

  if v_campaign.status not in ('draft', 'paused') then
    raise exception 'pause the campaign before changing double validation';
  end if;

  if coalesce(p_enabled, false) then
    select count(*)::integer into v_manager_count
    from public.organization_members
    where organization_id = v_campaign.organization_id
      and status = 'active'
      and role in ('owner', 'admin');
    if v_manager_count < 2 then
      raise exception 'double validation requires at least two active Brand Owners/Admins';
    end if;
  end if;

  update public.sponsor_campaigns
  set requires_double_validation = coalesce(p_enabled, false), updated_at = now()
  where id = p_campaign_id;

  return coalesce(p_enabled, false);
end;
$$;

revoke all on function public.set_sponsor_campaign_double_validation(uuid, boolean) from public;
grant execute on function public.set_sponsor_campaign_double_validation(uuid, boolean) to authenticated;

-- Internal reward finalizer. It preserves the V13 anti-farming and idempotency rules.
create or replace function public.complete_sponsored_approval_v133(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_campaign_name text;
  v_daily_rewards integer := 0;
  v_daily_limit constant integer := 3;
  v_coins bigint := 0;
  v_reward_xp bigint := 0;
  v_balance bigint := 0;
  v_xp bigint := 0;
  v_level integer := 1;
  v_reward_block_reason text := null;
begin
  select * into v_participant
  from public.challenge_participants
  where id = p_participant_id
  for update;
  if not found then raise exception 'participant not found'; end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;
  if not found or v_challenge.challenge_type <> 'sponsored'
     or v_challenge.metadata ->> 'reward_policy' <> 'v13-sponsored' then
    raise exception 'participant does not belong to a sponsored challenge';
  end if;

  if v_participant.rewarded_at is not null then
    return jsonb_build_object(
      'status', 'approved',
      'already_rewarded', true,
      'reward_blocked', false,
      'coins_granted', v_participant.reward_coins_granted,
      'xp_granted', v_participant.reward_xp_granted
    );
  end if;

  select name into v_campaign_name
  from public.sponsor_campaigns
  where id = v_challenge.sponsor_campaign_id;

  perform pg_advisory_xact_lock(hashtextextended('dadofit:sponsored-reward:user:' || v_participant.user_id::text, 0));

  select count(*)::integer into v_daily_rewards
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where cp.user_id = v_participant.user_id
    and cp.id <> p_participant_id
    and cp.status = 'approved'
    and cp.rewarded_at is not null
    and (cp.reward_coins_granted > 0 or cp.reward_xp_granted > 0)
    and c.challenge_type = 'sponsored'
    and c.metadata ->> 'reward_policy' = 'v13-sponsored'
    and cp.rewarded_at > now() - interval '24 hours';

  if v_daily_rewards >= v_daily_limit then
    v_reward_block_reason := 'sponsored_daily_limit';
  end if;

  if v_reward_block_reason is not null then
    update public.user_progress
    set challenges_completed = challenges_completed + 1
    where user_id = v_participant.user_id;

    update public.challenge_participants
    set status = 'approved',
        completed_at = now(),
        rewarded_at = null,
        reward_coins_granted = 0,
        reward_xp_granted = 0,
        reward_block_reason = v_reward_block_reason,
        updated_at = now()
    where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'sponsored_approved_no_reward',
      '¡Branded Challenge aprobado!',
      'Reto completado. Alcanzaste el límite de 3 recompensas patrocinadas en una ventana de 24 horas.',
      jsonb_build_object(
        'campaign_id', v_challenge.sponsor_campaign_id,
        'challenge_id', v_challenge.id,
        'participant_id', p_participant_id,
        'reward_blocked', true,
        'reward_block_reason', v_reward_block_reason,
        'coins', 0,
        'xp', 0
      )
    );

    return jsonb_build_object(
      'status', 'approved',
      'reward_blocked', true,
      'reward_block_reason', v_reward_block_reason,
      'coins_granted', 0,
      'xp_granted', 0,
      'daily_reward_limit', v_daily_limit
    );
  end if;

  v_coins := least(v_challenge.reward_coins, 50);
  v_reward_xp := least(v_challenge.reward_xp, 100);

  if v_coins > 0 then
    select new_balance into v_balance
    from public.grant_wallet_coins(
      v_participant.user_id,
      v_coins,
      'sponsored_challenge_reward',
      v_challenge.id,
      format('Branded Challenge completado: %s', coalesce(v_campaign_name, v_challenge.exercise_name)),
      format('sponsored-challenge:%s:coins', p_participant_id)
    );
  else
    select coalesce(w.balance, 0) into v_balance
    from public.wallets w where w.user_id = v_participant.user_id;
  end if;

  if v_reward_xp > 0 then
    select new_xp, new_level into v_xp, v_level
    from public.grant_user_xp(
      v_participant.user_id,
      v_reward_xp,
      'sponsored_challenge_reward',
      v_challenge.id,
      format('Branded Challenge completado: %s', coalesce(v_campaign_name, v_challenge.exercise_name)),
      format('sponsored-challenge:%s:xp', p_participant_id)
    );
  else
    select coalesce(up.xp, 0), coalesce(up.level, 1) into v_xp, v_level
    from public.user_progress up where up.user_id = v_participant.user_id;
  end if;

  update public.user_progress
  set challenges_completed = challenges_completed + 1
  where user_id = v_participant.user_id;

  update public.challenge_participants
  set status = 'approved',
      completed_at = now(),
      rewarded_at = now(),
      reward_coins_granted = v_coins,
      reward_xp_granted = v_reward_xp,
      reward_block_reason = null,
      updated_at = now()
  where id = p_participant_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_participant.user_id,
    'sponsored_approved',
    '¡Branded Challenge aprobado!',
    format('+%s DadoCoins · +%s XP', v_coins, v_reward_xp),
    jsonb_build_object(
      'campaign_id', v_challenge.sponsor_campaign_id,
      'challenge_id', v_challenge.id,
      'participant_id', p_participant_id,
      'coins', v_coins,
      'xp', v_reward_xp,
      'balance', v_balance,
      'level', v_level,
      'reward_blocked', false
    )
  );

  return jsonb_build_object(
    'status', 'approved',
    'reward_blocked', false,
    'reward_block_reason', null,
    'coins_granted', v_coins,
    'xp_granted', v_reward_xp,
    'new_balance', v_balance,
    'new_xp', v_xp,
    'new_level', v_level,
    'daily_reward_limit', v_daily_limit
  );
end;
$$;

revoke all on function public.complete_sponsored_approval_v133(uuid) from public, anon, authenticated;

-- Re-submissions clear the current review stage while keeping challenge_reviews immutable.
create or replace function public.submit_sponsored_challenge(p_participant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_campaign_name text;
  v_manager record;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select * into v_participant
  from public.challenge_participants
  where id = p_participant_id
  for update;
  if not found or v_participant.user_id <> v_actor then raise exception 'participant not found'; end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'sponsored'
     or v_challenge.metadata ->> 'reward_policy' <> 'v13-sponsored'
     or v_challenge.status <> 'active' then
    raise exception 'challenge is not active';
  end if;
  if v_challenge.expires_at is null or v_challenge.expires_at <= now() then raise exception 'challenge has expired'; end if;
  if v_participant.status not in ('accepted', 'rejected') then raise exception 'participant cannot submit evidence in current status'; end if;
  if not exists (select 1 from public.challenge_evidence ce where ce.participant_id = p_participant_id) then raise exception 'at least one evidence file is required'; end if;

  update public.challenge_participants
  set status = 'submitted',
      submitted_at = now(),
      primary_reviewer_user_id = null,
      primary_reviewed_at = null,
      audit_status = 'not_required',
      auditor_user_id = null,
      audited_at = null,
      updated_at = now()
  where id = p_participant_id;

  select name into v_campaign_name from public.sponsor_campaigns where id = v_challenge.sponsor_campaign_id;

  for v_manager in
    select om.user_id
    from public.organization_members om
    where om.organization_id = v_challenge.creator_organization_id
      and om.status = 'active'
      and om.role in ('owner', 'admin')
  loop
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_manager.user_id,
      'sponsored_evidence_submitted',
      'Nueva evidencia patrocinada',
      format('%s · %s', coalesce(v_campaign_name, 'Branded Challenge'), v_challenge.exercise_name),
      jsonb_build_object('organization_id', v_challenge.creator_organization_id, 'campaign_id', v_challenge.sponsor_campaign_id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id)
    );
  end loop;

  return 'submitted';
end;
$$;

revoke all on function public.submit_sponsored_challenge(uuid) from public;
grant execute on function public.submit_sponsored_challenge(uuid) to authenticated;

-- First review. For double-validation campaigns, approval moves to pending_audit and does not grant rewards.
create or replace function public.review_sponsored_challenge(
  p_participant_id uuid,
  p_decision text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_campaign public.sponsor_campaigns%rowtype;
  v_manager record;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;

  select * into v_participant from public.challenge_participants where id = p_participant_id for update;
  if not found then raise exception 'participant not found'; end if;

  select * into v_challenge from public.challenges where id = v_participant.challenge_id;
  if v_challenge.challenge_type <> 'sponsored' or v_challenge.metadata ->> 'reward_policy' <> 'v13-sponsored' then raise exception 'participant does not belong to a V13 sponsored challenge'; end if;
  if not public.is_brand_manager(v_challenge.creator_organization_id) then raise exception 'only Brand Owners or Admins can review sponsored evidence'; end if;
  if v_participant.user_id = v_actor then raise exception 'reviewer cannot approve their own evidence'; end if;

  if v_participant.status = 'pending_audit' then
    return jsonb_build_object('status', 'pending_audit', 'reward_blocked', false, 'coins_granted', 0, 'xp_granted', 0);
  end if;
  if v_participant.status = 'approved' then
    return jsonb_build_object('status', 'approved', 'already_rewarded', v_participant.rewarded_at is not null, 'reward_blocked', v_participant.reward_block_reason is not null, 'reward_block_reason', v_participant.reward_block_reason, 'coins_granted', v_participant.reward_coins_granted, 'xp_granted', v_participant.reward_xp_granted);
  end if;
  if v_participant.status <> 'submitted' then raise exception 'evidence can only be reviewed after submission'; end if;

  select * into v_campaign from public.sponsor_campaigns where id = v_challenge.sponsor_campaign_id;

  insert into public.challenge_reviews (participant_id, reviewer_user_id, decision, notes, review_stage, created_at)
  values (p_participant_id, v_actor, p_decision, nullif(left(btrim(coalesce(p_notes, '')), 500), ''), 'primary', now());

  update public.challenge_participants
  set primary_reviewer_user_id = v_actor, primary_reviewed_at = now(), updated_at = now()
  where id = p_participant_id;

  if p_decision = 'rejected' then
    update public.challenge_participants
    set status = 'rejected', audit_status = 'not_required', auditor_user_id = null, audited_at = null, updated_at = now()
    where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (v_participant.user_id, 'sponsored_evidence_rejected', 'Tu evidencia necesita otro intento', coalesce(nullif(left(btrim(coalesce(p_notes, '')), 500), ''), 'Sube una nueva evidencia y vuelve a enviarla.'), jsonb_build_object('campaign_id', v_challenge.sponsor_campaign_id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id));
    return jsonb_build_object('status', 'rejected', 'reward_blocked', false, 'coins_granted', 0, 'xp_granted', 0);
  end if;

  if coalesce(v_campaign.requires_double_validation, false) then
    update public.challenge_participants
    set status = 'pending_audit', audit_status = 'pending', auditor_user_id = null, audited_at = null, updated_at = now()
    where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (v_participant.user_id, 'sponsored_pending_audit', 'Primera validación aprobada', 'Tu evidencia pasó la revisión inicial y está pendiente de auditoría final.', jsonb_build_object('campaign_id', v_challenge.sponsor_campaign_id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id));

    for v_manager in
      select om.user_id
      from public.organization_members om
      where om.organization_id = v_challenge.creator_organization_id
        and om.status = 'active'
        and om.role in ('owner', 'admin')
        and om.user_id <> v_actor
    loop
      insert into public.notifications (user_id, notification_type, title, body, data)
      values (v_manager.user_id, 'sponsored_audit_required', 'Aprobación pendiente de auditoría', format('%s · %s requiere segunda validación.', coalesce(v_campaign.name, 'Branded Challenge'), v_challenge.exercise_name), jsonb_build_object('organization_id', v_challenge.creator_organization_id, 'campaign_id', v_challenge.sponsor_campaign_id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id, 'primary_reviewer_user_id', v_actor));
    end loop;

    return jsonb_build_object('status', 'pending_audit', 'requires_second_validation', true, 'reward_blocked', false, 'coins_granted', 0, 'xp_granted', 0);
  end if;

  update public.challenge_participants set audit_status = 'not_required', updated_at = now() where id = p_participant_id;
  v_result := public.complete_sponsored_approval_v133(p_participant_id);
  return v_result;
end;
$$;

revoke all on function public.review_sponsored_challenge(uuid, text, text) from public;
grant execute on function public.review_sponsored_challenge(uuid, text, text) to authenticated;

-- Second review. The auditor must be a different Owner/Admin from the primary reviewer.
create or replace function public.audit_sponsored_challenge(
  p_participant_id uuid,
  p_decision text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;

  select * into v_participant from public.challenge_participants where id = p_participant_id for update;
  if not found then raise exception 'participant not found'; end if;
  select * into v_challenge from public.challenges where id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'sponsored' or v_challenge.metadata ->> 'reward_policy' <> 'v13-sponsored' then raise exception 'participant does not belong to a sponsored challenge'; end if;
  if not public.is_brand_manager(v_challenge.creator_organization_id) then raise exception 'only Brand Owners or Admins can audit sponsored evidence'; end if;
  if v_participant.user_id = v_actor then raise exception 'auditor cannot audit their own evidence'; end if;
  if v_participant.primary_reviewer_user_id = v_actor then raise exception 'the second validation must be performed by a different reviewer'; end if;
  if v_participant.status <> 'pending_audit' or v_participant.audit_status <> 'pending' then raise exception 'participant is not pending audit'; end if;

  insert into public.challenge_reviews (participant_id, reviewer_user_id, decision, notes, review_stage, created_at)
  values (p_participant_id, v_actor, p_decision, nullif(left(btrim(coalesce(p_notes, '')), 500), ''), 'audit', now());

  update public.challenge_participants
  set auditor_user_id = v_actor, audited_at = now(), audit_status = case when p_decision = 'approved' then 'approved' else 'rejected' end, updated_at = now()
  where id = p_participant_id;

  if p_decision = 'rejected' then
    update public.challenge_participants set status = 'rejected', completed_at = null, rewarded_at = null, reward_coins_granted = 0, reward_xp_granted = 0, reward_block_reason = null, updated_at = now() where id = p_participant_id;
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (v_participant.user_id, 'sponsored_audit_rejected', 'La auditoría solicita una nueva evidencia', coalesce(nullif(left(btrim(coalesce(p_notes, '')), 500), ''), 'La segunda validación no fue aprobada. Corrige la evidencia y vuelve a enviarla.'), jsonb_build_object('campaign_id', v_challenge.sponsor_campaign_id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id));
    return jsonb_build_object('status', 'rejected', 'audit_status', 'rejected', 'reward_blocked', false, 'coins_granted', 0, 'xp_granted', 0);
  end if;

  v_result := public.complete_sponsored_approval_v133(p_participant_id);
  return v_result || jsonb_build_object('audit_status', 'approved');
end;
$$;

revoke all on function public.audit_sponsored_challenge(uuid, text, text) from public;
grant execute on function public.audit_sponsored_challenge(uuid, text, text) to authenticated;

-- A challenge cannot be closed with operational reviews or second validations still pending.
create or replace function public.close_sponsored_challenge(p_challenge_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_challenge public.challenges%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_challenge from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'challenge not found'; end if;
  if v_challenge.challenge_type <> 'sponsored' then raise exception 'not a sponsored challenge'; end if;
  if not public.is_brand_manager(v_challenge.creator_organization_id) then raise exception 'only Brand Owners or Admins can close this challenge'; end if;

  if exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.status in ('submitted', 'pending_audit')) then
    raise exception 'review and audit pending evidence before closing the challenge';
  end if;

  update public.challenge_participants set status = 'expired', updated_at = now() where challenge_id = p_challenge_id and status in ('accepted', 'rejected', 'invited');
  update public.challenges set status = 'completed' where id = p_challenge_id and status = 'active';
  return 'completed';
end;
$$;

revoke all on function public.close_sponsored_challenge(uuid) from public;
grant execute on function public.close_sponsored_challenge(uuid) to authenticated;

-- One secure dashboard RPC powers Brand operations, audit queue and immutable history.
create or replace function public.get_brand_governance_dashboard(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_members integer := 0;
  v_campaigns integer := 0;
  v_active_campaigns integer := 0;
  v_sponsored_challenges integer := 0;
  v_active_challenges integer := 0;
  v_participants integer := 0;
  v_pending_review integer := 0;
  v_pending_audit integer := 0;
  v_approved integer := 0;
  v_rejected integer := 0;
  v_coins bigint := 0;
  v_xp bigint := 0;
  v_campaigns_config jsonb := '[]'::jsonb;
  v_queue jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.is_brand_manager(p_organization_id) then raise exception 'Brand governance requires Owner or Admin access'; end if;

  select count(*)::integer into v_members from public.organization_members where organization_id = p_organization_id and status = 'active';
  select count(*)::integer, count(*) filter (where status = 'active')::integer into v_campaigns, v_active_campaigns from public.sponsor_campaigns where organization_id = p_organization_id;
  select count(*)::integer, count(*) filter (where status = 'active')::integer into v_sponsored_challenges, v_active_challenges from public.challenges where creator_organization_id = p_organization_id and challenge_type = 'sponsored';

  select
    count(*)::integer,
    count(*) filter (where cp.status = 'submitted')::integer,
    count(*) filter (where cp.status = 'pending_audit')::integer,
    count(*) filter (where cp.status = 'approved')::integer,
    count(*) filter (where cp.status = 'rejected')::integer,
    coalesce(sum(cp.reward_coins_granted), 0),
    coalesce(sum(cp.reward_xp_granted), 0)
  into v_participants, v_pending_review, v_pending_audit, v_approved, v_rejected, v_coins, v_xp
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where c.creator_organization_id = p_organization_id and c.challenge_type = 'sponsored';

  select coalesce(jsonb_agg(to_jsonb(cfg) order by cfg.created_at desc), '[]'::jsonb)
  into v_campaigns_config
  from (
    select sc.id, sc.name, sc.status, sc.requires_double_validation, sc.created_at
    from public.sponsor_campaigns sc
    where sc.organization_id = p_organization_id
    order by sc.created_at desc
  ) cfg;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.primary_reviewed_at asc), '[]'::jsonb)
  into v_queue
  from (
    select
      cp.id as participant_id,
      cp.user_id,
      coalesce(nullif(p.display_name, ''), p.username, 'Gymbro') as participant_name,
      p.username,
      c.id as challenge_id,
      sc.id as campaign_id,
      sc.name as campaign_name,
      c.exercise_name,
      c.reps,
      c.metadata,
      coalesce(nullif(rp.display_name, ''), rp.username, 'Reviewer') as primary_reviewer_name,
      cp.primary_reviewed_at,
      ce.storage_path as evidence_storage_path,
      ce.evidence_kind,
      ce.file_name as evidence_file_name
    from public.challenge_participants cp
    join public.challenges c on c.id = cp.challenge_id
    join public.sponsor_campaigns sc on sc.id = c.sponsor_campaign_id
    join public.profiles p on p.id = cp.user_id
    left join public.profiles rp on rp.id = cp.primary_reviewer_user_id
    left join lateral (
      select e.storage_path, e.evidence_kind, e.file_name
      from public.challenge_evidence e
      where e.participant_id = cp.id
      order by e.created_at desc
      limit 1
    ) ce on true
    where c.creator_organization_id = p_organization_id
      and c.challenge_type = 'sponsored'
      and cp.status = 'pending_audit'
      and cp.audit_status = 'pending'
    order by cp.primary_reviewed_at asc nulls first
    limit 50
  ) q;

  select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select
      cr.id,
      cr.participant_id,
      cr.review_stage,
      cr.decision,
      cr.notes,
      cr.created_at,
      coalesce(nullif(pp.display_name, ''), pp.username, 'Gymbro') as participant_name,
      pp.username,
      sc.name as campaign_name,
      c.exercise_name,
      coalesce(nullif(rp.display_name, ''), rp.username, 'Reviewer') as reviewer_name
    from public.challenge_reviews cr
    join public.challenge_participants cp on cp.id = cr.participant_id
    join public.challenges c on c.id = cp.challenge_id
    left join public.sponsor_campaigns sc on sc.id = c.sponsor_campaign_id
    join public.profiles pp on pp.id = cp.user_id
    join public.profiles rp on rp.id = cr.reviewer_user_id
    where c.creator_organization_id = p_organization_id and c.challenge_type = 'sponsored'
    order by cr.created_at desc
    limit 100
  ) h;

  return jsonb_build_object(
    'members', v_members,
    'campaigns', v_campaigns,
    'active_campaigns', v_active_campaigns,
    'sponsored_challenges', v_sponsored_challenges,
    'active_challenges', v_active_challenges,
    'participants', v_participants,
    'pending_review', v_pending_review,
    'pending_audit', v_pending_audit,
    'approved', v_approved,
    'rejected', v_rejected,
    'coins_granted', v_coins,
    'xp_granted', v_xp,
    'campaigns_config', v_campaigns_config,
    'audit_queue', v_queue,
    'history', v_history
  );
end;
$$;

revoke all on function public.get_brand_governance_dashboard(uuid) from public;
grant execute on function public.get_brand_governance_dashboard(uuid) to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v13.3-brand-governance-audits',
    'workspace_model', 'personal+organization',
    'sponsored_catalog_exercises', true,
    'sponsored_goal_types', jsonb_build_array('repetitions', 'time', 'distance', 'quantity'),
    'sponsored_review_history', true,
    'brand_double_validation', true,
    'brand_audit_trail', true,
    'sponsored_daily_limit', 3,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
