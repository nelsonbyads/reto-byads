-- DadoFit V13 - Brands, Sponsors & Branded Challenges
-- Brand workspaces can create campaigns and publish public sponsored challenges.
-- Participants join from their personal workspace, evidence is mandatory,
-- Brand Owners/Admins review submissions, and rewards remain server-owned.

alter table public.sponsor_campaigns
  add column if not exists created_by_user_id uuid references public.profiles(id) on delete set null;

alter table public.sponsor_campaigns
  add column if not exists max_participants integer;

alter table public.sponsor_campaigns
  drop constraint if exists sponsor_campaigns_max_participants_check;
alter table public.sponsor_campaigns
  add constraint sponsor_campaigns_max_participants_check
  check (max_participants is null or (max_participants >= 1 and max_participants <= 5000));

create index if not exists sponsor_campaigns_org_status_v13_idx
  on public.sponsor_campaigns (organization_id, status, created_at desc);

-- Draft/private campaign data stays inside the Brand workspace. A campaign remains
-- readable to participants while it still owns an active public challenge.
drop policy if exists sponsor_campaigns_read_authenticated on public.sponsor_campaigns;
drop policy if exists sponsor_campaigns_read_v13 on public.sponsor_campaigns;
create policy sponsor_campaigns_read_v13
on public.sponsor_campaigns for select
to authenticated
using (
  public.is_organization_member(organization_id)
  or status = 'active'
  or exists (
    select 1 from public.challenges c
    where c.sponsor_campaign_id = sponsor_campaigns.id
      and c.challenge_type = 'sponsored'
      and c.status = 'active'
  )
);

-- Sponsored challenge discovery is public only while active. Creators and joined
-- participants keep access after completion through the existing creator/participant rules.
drop policy if exists challenges_read_visible on public.challenges;
create policy challenges_read_visible
on public.challenges for select
to authenticated
using (
  public.is_challenge_creator(id)
  or public.is_challenge_participant(id)
  or challenge_type = 'public'
  or (challenge_type = 'sponsored' and status = 'active')
);

-- Any Brand workspace that already existed before V13 is considered verified for
-- beta continuity. New Brand workspaces created after this migration remain pending
-- until a future verification/admin workflow approves them.
update public.organizations
set verification_status = 'verified'
where organization_type in ('brand', 'sponsor', 'company')
  and verification_status = 'pending_verification';

alter table public.challenge_participants
  drop constraint if exists challenge_participants_reward_block_reason_check;

alter table public.challenge_participants
  add constraint challenge_participants_reward_block_reason_check
  check (
    reward_block_reason is null
    or reward_block_reason in (
      'pair_cooldown',
      'daily_limit',
      'squad_pair_cooldown',
      'squad_daily_limit',
      'organization_pair_cooldown',
      'organization_daily_limit',
      'gym_pair_cooldown',
      'gym_daily_limit',
      'sponsored_daily_limit'
    )
  );

create or replace function public.is_brand_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and o.organization_type in ('brand', 'sponsor', 'company')
      and o.verification_status not in ('rejected', 'suspended')
  );
$$;

create or replace function public.is_brand_manager(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('owner', 'admin')
      and o.organization_type in ('brand', 'sponsor', 'company')
      and o.verification_status not in ('rejected', 'suspended')
  );
$$;

revoke all on function public.is_brand_organization(uuid) from public;
revoke all on function public.is_brand_manager(uuid) from public;
grant execute on function public.is_brand_organization(uuid) to authenticated;
grant execute on function public.is_brand_manager(uuid) to authenticated;

-- Sponsored challenges are reserved for Brand/Sponsor/Company workspaces and must
-- be created by an Owner/Admin. This protects against direct client writes that try
-- to bypass the RPC layer.
create or replace function public.enforce_sponsored_challenge_v13()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.challenge_type <> 'sponsored' then
    return new;
  end if;

  if new.creator_kind <> 'organization' or new.creator_organization_id is null then
    raise exception 'sponsored challenge requires a Brand organization creator';
  end if;

  if not public.is_brand_organization(new.creator_organization_id) then
    raise exception 'sponsored challenges require a Brand/Sponsor workspace';
  end if;

  if auth.uid() is not null and not public.is_brand_manager(new.creator_organization_id) then
    raise exception 'only Brand Owners or Admins can create or edit sponsored challenges';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_sponsored_challenge_v13() from public, anon, authenticated;

drop trigger if exists challenges_sponsored_kind_v13 on public.challenges;
create trigger challenges_sponsored_kind_v13
before insert or update of challenge_type, creator_kind, creator_organization_id on public.challenges
for each row execute function public.enforce_sponsored_challenge_v13();

create or replace function public.create_sponsor_campaign(
  p_organization_id uuid,
  p_name text,
  p_description text default null,
  p_default_reward_coins integer default 25,
  p_default_reward_xp integer default 50,
  p_max_participants integer default 500
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign_id uuid;
  v_verification text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.is_brand_manager(p_organization_id) then
    raise exception 'only Brand Owners or Admins can create campaigns';
  end if;

  select verification_status into v_verification
  from public.organizations
  where id = p_organization_id;

  if v_verification in ('rejected', 'suspended') then
    raise exception 'Brand workspace is not eligible to create campaigns';
  end if;

  if length(btrim(coalesce(p_name, ''))) < 3 or length(btrim(p_name)) > 100 then
    raise exception 'campaign name must have between 3 and 100 characters';
  end if;
  if p_default_reward_coins < 0 or p_default_reward_coins > 50 then
    raise exception 'sponsored DadoCoins reward must be between 0 and 50';
  end if;
  if p_default_reward_xp < 0 or p_default_reward_xp > 100 then
    raise exception 'sponsored XP reward must be between 0 and 100';
  end if;
  if p_max_participants < 1 or p_max_participants > 5000 then
    raise exception 'campaign max participants must be between 1 and 5000';
  end if;

  insert into public.sponsor_campaigns (
    organization_id,
    created_by_user_id,
    name,
    description,
    status,
    default_reward_coins,
    default_reward_xp,
    max_participants,
    metadata
  ) values (
    p_organization_id,
    v_actor,
    left(btrim(p_name), 100),
    nullif(left(btrim(coalesce(p_description, '')), 700), ''),
    'draft',
    p_default_reward_coins,
    p_default_reward_xp,
    p_max_participants,
    jsonb_build_object('audience', 'public', 'version', 'v13')
  )
  returning id into v_campaign_id;

  return v_campaign_id;
end;
$$;

revoke all on function public.create_sponsor_campaign(uuid, text, text, integer, integer, integer) from public;
grant execute on function public.create_sponsor_campaign(uuid, text, text, integer, integer, integer) to authenticated;

create or replace function public.set_sponsor_campaign_status(
  p_campaign_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign public.sponsor_campaigns%rowtype;
  v_verification text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_status not in ('draft', 'active', 'paused', 'completed', 'cancelled') then
    raise exception 'invalid campaign status';
  end if;

  select * into v_campaign
  from public.sponsor_campaigns
  where id = p_campaign_id
  for update;
  if not found then raise exception 'campaign not found'; end if;

  if not public.is_brand_manager(v_campaign.organization_id) then
    raise exception 'only Brand Owners or Admins can change campaign status';
  end if;

  select verification_status into v_verification
  from public.organizations where id = v_campaign.organization_id;

  if p_status = 'active' and v_verification <> 'verified' then
    raise exception 'Brand must be verified before activating campaigns';
  end if;

  if p_status = 'completed' and exists (
    select 1 from public.challenges c
    where c.sponsor_campaign_id = p_campaign_id
      and c.challenge_type = 'sponsored'
      and c.status = 'active'
  ) then
    raise exception 'close active sponsored challenges before completing the campaign';
  end if;

  update public.sponsor_campaigns
  set
    status = p_status,
    starts_at = case when p_status = 'active' then coalesce(starts_at, now()) else starts_at end,
    ends_at = case when p_status in ('completed', 'cancelled') then coalesce(ends_at, now()) else ends_at end
  where id = p_campaign_id;

  if p_status = 'cancelled' then
    update public.challenges
    set status = 'cancelled'
    where sponsor_campaign_id = p_campaign_id
      and challenge_type = 'sponsored'
      and status = 'active';
  end if;

  return p_status;
end;
$$;

revoke all on function public.set_sponsor_campaign_status(uuid, text) from public;
grant execute on function public.set_sponsor_campaign_status(uuid, text) to authenticated;

create or replace function public.publish_sponsored_challenge(
  p_campaign_id uuid,
  p_exercise_name text,
  p_reps integer,
  p_duration_hours integer default 72,
  p_max_participants integer default 100
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign public.sponsor_campaigns%rowtype;
  v_organization public.organizations%rowtype;
  v_challenge_id uuid;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select * into v_campaign
  from public.sponsor_campaigns
  where id = p_campaign_id;
  if not found then raise exception 'campaign not found'; end if;

  if not public.is_brand_manager(v_campaign.organization_id) then
    raise exception 'only Brand Owners or Admins can publish sponsored challenges';
  end if;

  select * into v_organization
  from public.organizations
  where id = v_campaign.organization_id;

  if v_organization.verification_status <> 'verified' then
    raise exception 'Brand must be verified before publishing sponsored challenges';
  end if;
  if v_campaign.status <> 'active' then
    raise exception 'campaign must be active before publishing a challenge';
  end if;
  if length(btrim(coalesce(p_exercise_name, ''))) < 2 or length(btrim(p_exercise_name)) > 160 then
    raise exception 'exercise/activity name must have between 2 and 160 characters';
  end if;
  if p_reps < 1 or p_reps > 1000 then raise exception 'invalid repetitions'; end if;
  if p_duration_hours < 1 or p_duration_hours > 336 then raise exception 'duration must be between 1 and 336 hours'; end if;
  if p_max_participants < 1 or p_max_participants > coalesce(v_campaign.max_participants, 5000) then
    raise exception 'challenge capacity exceeds campaign capacity';
  end if;

  insert into public.challenges (
    creator_kind,
    creator_organization_id,
    challenge_type,
    status,
    title,
    description,
    exercise_id,
    exercise_name,
    reps,
    dice_level,
    starts_at,
    expires_at,
    evidence_required,
    reward_coins,
    reward_xp,
    team_points,
    sponsor_points,
    sponsor_campaign_id,
    max_participants,
    metadata
  ) values (
    'organization',
    v_campaign.organization_id,
    'sponsored',
    'active',
    left(v_campaign.name, 160),
    v_campaign.description,
    'sponsored-' || replace(gen_random_uuid()::text, '-', ''),
    left(btrim(p_exercise_name), 160),
    p_reps,
    'amateur',
    now(),
    now() + make_interval(hours => p_duration_hours),
    true,
    least(v_campaign.default_reward_coins, 50),
    least(v_campaign.default_reward_xp, 100),
    0,
    0,
    v_campaign.id,
    p_max_participants,
    jsonb_build_object(
      'reward_policy', 'v13-sponsored',
      'audience', 'public',
      'brand_organization_id', v_campaign.organization_id,
      'published_by_user_id', v_actor
    )
  ) returning id into v_challenge_id;

  return v_challenge_id;
end;
$$;

revoke all on function public.publish_sponsored_challenge(uuid, text, integer, integer, integer) from public;
grant execute on function public.publish_sponsored_challenge(uuid, text, integer, integer, integer) to authenticated;

create or replace function public.join_sponsored_challenge(p_challenge_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_challenge public.challenges%rowtype;
  v_campaign_status text;
  v_participant_id uuid;
  v_count integer;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select * into v_challenge
  from public.challenges
  where id = p_challenge_id
  for update;
  if not found then raise exception 'sponsored challenge not found'; end if;

  if v_challenge.challenge_type <> 'sponsored'
     or v_challenge.metadata ->> 'reward_policy' <> 'v13-sponsored'
     or v_challenge.status <> 'active' then
    raise exception 'challenge is not available';
  end if;
  if v_challenge.expires_at is null or v_challenge.expires_at <= now() then
    raise exception 'challenge has expired';
  end if;

  select status into v_campaign_status
  from public.sponsor_campaigns
  where id = v_challenge.sponsor_campaign_id;
  if v_campaign_status <> 'active' then raise exception 'campaign is not accepting participants'; end if;

  if exists (
    select 1 from public.organization_members om
    where om.organization_id = v_challenge.creator_organization_id
      and om.user_id = v_actor
      and om.status = 'active'
  ) then
    raise exception 'members of the sponsoring Brand cannot join their own challenge';
  end if;

  select id into v_participant_id
  from public.challenge_participants
  where challenge_id = p_challenge_id and user_id = v_actor;
  if found then return v_participant_id; end if;

  select count(*)::integer into v_count
  from public.challenge_participants
  where challenge_id = p_challenge_id;
  if v_challenge.max_participants is not null and v_count >= v_challenge.max_participants then
    raise exception 'challenge capacity is full';
  end if;

  insert into public.challenge_participants (
    challenge_id,
    user_id,
    status,
    accepted_at
  ) values (
    p_challenge_id,
    v_actor,
    'accepted',
    now()
  ) returning id into v_participant_id;

  return v_participant_id;
end;
$$;

revoke all on function public.join_sponsored_challenge(uuid) from public;
grant execute on function public.join_sponsored_challenge(uuid) to authenticated;

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
  if not found or v_participant.user_id <> v_actor then
    raise exception 'participant not found';
  end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'sponsored'
     or v_challenge.metadata ->> 'reward_policy' <> 'v13-sponsored'
     or v_challenge.status <> 'active' then
    raise exception 'challenge is not active';
  end if;
  if v_challenge.expires_at is null or v_challenge.expires_at <= now() then
    raise exception 'challenge has expired';
  end if;
  if v_participant.status not in ('accepted', 'rejected') then
    raise exception 'participant cannot submit evidence in current status';
  end if;
  if not exists (select 1 from public.challenge_evidence ce where ce.participant_id = p_participant_id) then
    raise exception 'at least one evidence file is required';
  end if;

  update public.challenge_participants
  set status = 'submitted', submitted_at = now()
  where id = p_participant_id;

  select name into v_campaign_name
  from public.sponsor_campaigns
  where id = v_challenge.sponsor_campaign_id;

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
      format('%s · %s repeticiones de %s', coalesce(v_campaign_name, 'Branded Challenge'), v_challenge.reps, v_challenge.exercise_name),
      jsonb_build_object(
        'organization_id', v_challenge.creator_organization_id,
        'campaign_id', v_challenge.sponsor_campaign_id,
        'challenge_id', v_challenge.id,
        'participant_id', p_participant_id
      )
    );
  end loop;

  return 'submitted';
end;
$$;

revoke all on function public.submit_sponsored_challenge(uuid) from public;
grant execute on function public.submit_sponsored_challenge(uuid) to authenticated;

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
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;

  select * into v_participant
  from public.challenge_participants
  where id = p_participant_id
  for update;
  if not found then raise exception 'participant not found'; end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;
  if v_challenge.challenge_type <> 'sponsored'
     or v_challenge.metadata ->> 'reward_policy' <> 'v13-sponsored' then
    raise exception 'participant does not belong to a V13 sponsored challenge';
  end if;

  if not public.is_brand_manager(v_challenge.creator_organization_id) then
    raise exception 'only Brand Owners or Admins can review sponsored evidence';
  end if;
  if v_participant.user_id = v_actor then
    raise exception 'reviewer cannot approve their own evidence';
  end if;

  if v_participant.status = 'approved' then
    return jsonb_build_object(
      'status', 'approved',
      'already_rewarded', v_participant.rewarded_at is not null,
      'reward_blocked', v_participant.reward_block_reason is not null,
      'reward_block_reason', v_participant.reward_block_reason,
      'coins_granted', v_participant.reward_coins_granted,
      'xp_granted', v_participant.reward_xp_granted,
      'daily_reward_limit', v_daily_limit
    );
  end if;
  if v_participant.status <> 'submitted' then
    raise exception 'evidence can only be reviewed after submission';
  end if;

  insert into public.challenge_reviews (participant_id, reviewer_user_id, decision, notes, created_at)
  values (p_participant_id, v_actor, p_decision, nullif(left(btrim(coalesce(p_notes, '')), 500), ''), now())
  on conflict (participant_id) do update
  set reviewer_user_id = excluded.reviewer_user_id,
      decision = excluded.decision,
      notes = excluded.notes,
      created_at = excluded.created_at;

  select name into v_campaign_name
  from public.sponsor_campaigns
  where id = v_challenge.sponsor_campaign_id;

  if p_decision = 'rejected' then
    update public.challenge_participants
    set status = 'rejected'
    where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'sponsored_evidence_rejected',
      'Tu evidencia necesita otro intento',
      coalesce(nullif(left(btrim(coalesce(p_notes, '')), 500), ''), 'Sube una nueva evidencia y vuelve a enviarla.'),
      jsonb_build_object('campaign_id', v_challenge.sponsor_campaign_id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id)
    );

    return jsonb_build_object('status', 'rejected', 'reward_blocked', false, 'coins_granted', 0, 'xp_granted', 0);
  end if;

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
        reward_block_reason = v_reward_block_reason
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
      reward_block_reason = null
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

revoke all on function public.review_sponsored_challenge(uuid, text, text) from public;
grant execute on function public.review_sponsored_challenge(uuid, text, text) to authenticated;

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

  select * into v_challenge
  from public.challenges
  where id = p_challenge_id
  for update;
  if not found then raise exception 'challenge not found'; end if;
  if v_challenge.challenge_type <> 'sponsored' then raise exception 'not a sponsored challenge'; end if;
  if not public.is_brand_manager(v_challenge.creator_organization_id) then
    raise exception 'only Brand Owners or Admins can close this challenge';
  end if;
  if exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id and cp.status = 'submitted'
  ) then
    raise exception 'review submitted evidence before closing the challenge';
  end if;

  update public.challenge_participants
  set status = 'expired'
  where challenge_id = p_challenge_id
    and status in ('accepted', 'rejected', 'invited');

  update public.challenges
  set status = 'completed'
  where id = p_challenge_id
    and status = 'active';

  return 'completed';
end;
$$;

revoke all on function public.close_sponsored_challenge(uuid) from public;
grant execute on function public.close_sponsored_challenge(uuid) to authenticated;

create or replace function public.get_brand_dashboard_summary(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_members integer := 0;
  v_campaigns integer := 0;
  v_active_campaigns integer := 0;
  v_sponsored_challenges integer := 0;
  v_active_challenges integer := 0;
  v_participants integer := 0;
  v_pending_review integer := 0;
  v_approved integer := 0;
  v_coins bigint := 0;
  v_xp bigint := 0;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.is_organization_member(p_organization_id) or not public.is_brand_organization(p_organization_id) then
    raise exception 'Brand workspace access required';
  end if;

  select count(*)::integer into v_members
  from public.organization_members om
  where om.organization_id = p_organization_id and om.status = 'active';

  select count(*)::integer,
         count(*) filter (where sc.status = 'active')::integer
    into v_campaigns, v_active_campaigns
  from public.sponsor_campaigns sc
  where sc.organization_id = p_organization_id;

  select count(*)::integer,
         count(*) filter (where c.status = 'active')::integer
    into v_sponsored_challenges, v_active_challenges
  from public.challenges c
  where c.creator_organization_id = p_organization_id
    and c.challenge_type = 'sponsored';

  select
    count(cp.id)::integer,
    count(cp.id) filter (where cp.status = 'submitted')::integer,
    count(cp.id) filter (where cp.status = 'approved')::integer,
    coalesce(sum(cp.reward_coins_granted), 0),
    coalesce(sum(cp.reward_xp_granted), 0)
  into v_participants, v_pending_review, v_approved, v_coins, v_xp
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where c.creator_organization_id = p_organization_id
    and c.challenge_type = 'sponsored';

  return jsonb_build_object(
    'members', v_members,
    'campaigns', v_campaigns,
    'active_campaigns', v_active_campaigns,
    'sponsored_challenges', v_sponsored_challenges,
    'active_challenges', v_active_challenges,
    'participants', v_participants,
    'pending_review', v_pending_review,
    'approved', v_approved,
    'coins_granted', v_coins,
    'xp_granted', v_xp
  );
end;
$$;

revoke all on function public.get_brand_dashboard_summary(uuid) from public;
revoke all on function public.get_brand_dashboard_summary(uuid) from anon;
grant execute on function public.get_brand_dashboard_summary(uuid) to authenticated;

create or replace function public.get_sponsored_pending_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select count(*)::integer into v_count
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where cp.user_id = v_actor
    and c.challenge_type = 'sponsored'
    and c.status = 'active'
    and cp.status in ('accepted', 'submitted', 'rejected');

  return v_count;
end;
$$;

revoke all on function public.get_sponsored_pending_count() from public;
revoke all on function public.get_sponsored_pending_count() from anon;
grant execute on function public.get_sponsored_pending_count() to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v13-brands-sponsors-branded-challenges',
    'workspace_model', 'personal+organization',
    'direct_pair_cooldown_hours', 24,
    'direct_daily_limit', 5,
    'squad_pair_cooldown_hours', 24,
    'squad_daily_limit', 5,
    'organization_pair_cooldown_hours', 24,
    'organization_daily_limit', 5,
    'gym_pair_cooldown_hours', 24,
    'gym_daily_limit', 5,
    'sponsored_daily_limit', 3,
    'brand_campaigns', true,
    'branded_challenges', true,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
