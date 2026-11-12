-- DadoFit V13.2.1 - Sponsored review history hotfix
-- Fixes PostgreSQL error:
--   there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- challenge_reviews is intentionally historical. Since V10 it no longer has
-- UNIQUE(participant_id), allowing reject -> resubmit -> review cycles.
-- Therefore sponsored reviews must INSERT a new review row instead of using UPSERT.

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

  -- challenge_reviews intentionally keeps a review history. V10 removed the
  -- old UNIQUE(participant_id) constraint so rejected evidence can be resubmitted
  -- and reviewed again. Each decision therefore creates a new immutable review row.
  insert into public.challenge_reviews (participant_id, reviewer_user_id, decision, notes, created_at)
  values (p_participant_id, v_actor, p_decision, nullif(left(btrim(coalesce(p_notes, '')), 500), ''), now());

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

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v13.2.1-sponsored-review-history-hotfix',
    'workspace_model', 'personal+organization',
    'sponsored_catalog_exercises', true,
    'sponsored_goal_types', jsonb_build_array('repetitions', 'time', 'distance', 'quantity'),
    'sponsored_review_history', true,
    'sponsored_daily_limit', 3,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
