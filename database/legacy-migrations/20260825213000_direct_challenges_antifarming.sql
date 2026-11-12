-- DadoFit V10.2 - Anti-Farming Reward Rules
-- Direct 1v1 challenges remain completable, but economic rewards are rate-limited.
-- Rules:
--   1) Same challenger -> same recipient: max 1 rewarded direct challenge per rolling 24h.
--   2) Same recipient: max 5 rewarded direct challenges total per rolling 24h.
-- Existing completed rewards are preserved. This policy applies to approvals after this migration.

alter table public.challenge_participants
  add column if not exists reward_block_reason text;

alter table public.challenge_participants
  drop constraint if exists challenge_participants_reward_block_reason_check;

alter table public.challenge_participants
  add constraint challenge_participants_reward_block_reason_check
  check (
    reward_block_reason is null
    or reward_block_reason in ('pair_cooldown', 'daily_limit')
  );

create index if not exists challenge_participants_rewarded_user_idx
  on public.challenge_participants (user_id, rewarded_at desc)
  where rewarded_at is not null;

create or replace function public.review_direct_challenge(
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
  v_balance bigint;
  v_xp bigint;
  v_level integer;
  v_coins bigint;
  v_reward_xp bigint;
  v_last_pair_reward timestamptz;
  v_rewards_last_24h integer := 0;
  v_reward_block_reason text := null;
  v_pair_cooldown_hours constant integer := 24;
  v_daily_reward_limit constant integer := 5;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision';
  end if;

  select * into v_participant
  from public.challenge_participants
  where id = p_participant_id
  for update;

  if not found then
    raise exception 'challenge participant not found';
  end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'direct'
     or v_challenge.metadata ->> 'reward_policy' <> 'v10-direct-1v1' then
    raise exception 'challenge is not a V10 direct challenge';
  end if;

  if v_challenge.creator_user_id <> v_actor then
    raise exception 'only the challenge creator can review evidence';
  end if;

  -- Idempotent terminal state. Repeated approvals never alter balances, XP or counters.
  if v_participant.status = 'approved' then
    return jsonb_build_object(
      'status', 'approved',
      'already_rewarded', v_participant.rewarded_at is not null,
      'reward_blocked', v_participant.reward_block_reason is not null,
      'reward_block_reason', v_participant.reward_block_reason,
      'coins_granted', v_participant.reward_coins_granted,
      'xp_granted', v_participant.reward_xp_granted,
      'rewarded_at', v_participant.rewarded_at,
      'pair_cooldown_hours', v_pair_cooldown_hours,
      'daily_reward_limit', v_daily_reward_limit
    );
  end if;

  if v_participant.status <> 'submitted' then
    raise exception 'challenge can only be reviewed after evidence submission';
  end if;

  insert into public.challenge_reviews (participant_id, reviewer_user_id, decision, notes)
  values (p_participant_id, v_actor, p_decision, nullif(btrim(p_notes), ''));

  if p_decision = 'rejected' then
    update public.challenge_participants
    set status = 'rejected'
    where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'challenge_evidence_rejected',
      'Tu evidencia necesita otro intento',
      coalesce(nullif(btrim(p_notes), ''), 'Sube una nueva evidencia y vuelve a enviarla.'),
      jsonb_build_object('challenge_id', v_challenge.id, 'participant_id', p_participant_id)
    );

    return jsonb_build_object(
      'status', 'rejected',
      'already_rewarded', false,
      'reward_blocked', false,
      'reward_block_reason', null,
      'coins_granted', 0,
      'xp_granted', 0
    );
  end if;

  -- Serialize all direct reward decisions for this recipient. This closes the race where
  -- two challengers could approve simultaneously and both pass the anti-farming checks.
  perform pg_advisory_xact_lock(
    hashtextextended('dadofit:direct-reward:user:' || v_participant.user_id::text, 0)
  );

  -- Pair cooldown: one economic reward from the same challenger to the same recipient
  -- during a rolling 24-hour window.
  select max(cp.rewarded_at)
    into v_last_pair_reward
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where cp.user_id = v_participant.user_id
    and cp.id <> p_participant_id
    and cp.status = 'approved'
    and cp.rewarded_at is not null
    and (cp.reward_coins_granted > 0 or cp.reward_xp_granted > 0)
    and c.challenge_type = 'direct'
    and c.creator_user_id = v_actor
    and cp.rewarded_at > now() - interval '24 hours';

  if v_last_pair_reward is not null then
    v_reward_block_reason := 'pair_cooldown';
  end if;

  -- Global direct-challenge cap for the recipient. Only actually granted rewards count.
  if v_reward_block_reason is null then
    select count(*)::integer
      into v_rewards_last_24h
    from public.challenge_participants cp
    join public.challenges c on c.id = cp.challenge_id
    where cp.user_id = v_participant.user_id
      and cp.id <> p_participant_id
      and cp.status = 'approved'
      and cp.rewarded_at is not null
      and (cp.reward_coins_granted > 0 or cp.reward_xp_granted > 0)
      and c.challenge_type = 'direct'
      and cp.rewarded_at > now() - interval '24 hours';

    if v_rewards_last_24h >= v_daily_reward_limit then
      v_reward_block_reason := 'daily_limit';
    end if;
  end if;

  -- A valid challenge is still completed when anti-farming blocks the economic payout.
  -- It counts in challenges_completed, but does not create wallet/progress transactions.
  if v_reward_block_reason is not null then
    update public.user_progress
    set challenges_completed = challenges_completed + 1
    where user_id = v_participant.user_id;

    update public.challenge_participants
    set
      status = 'approved',
      completed_at = now(),
      rewarded_at = null,
      reward_coins_granted = 0,
      reward_xp_granted = 0,
      reward_block_reason = v_reward_block_reason
    where id = p_participant_id;

    update public.challenges
    set status = 'completed'
    where id = v_challenge.id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'challenge_approved_no_reward',
      '¡Reto aprobado!',
      case v_reward_block_reason
        when 'pair_cooldown' then 'Reto completado. La recompensa está en cooldown para este Gymbro durante 24 horas.'
        when 'daily_limit' then 'Reto completado. Alcanzaste el límite de 5 recompensas de retos 1 vs 1 en 24 horas.'
        else 'Reto completado sin recompensa adicional por política anti-farming.'
      end,
      jsonb_build_object(
        'challenge_id', v_challenge.id,
        'participant_id', p_participant_id,
        'coins', 0,
        'xp', 0,
        'reward_blocked', true,
        'reward_block_reason', v_reward_block_reason,
        'pair_cooldown_hours', v_pair_cooldown_hours,
        'daily_reward_limit', v_daily_reward_limit
      )
    );

    return jsonb_build_object(
      'status', 'approved',
      'already_rewarded', false,
      'reward_blocked', true,
      'reward_block_reason', v_reward_block_reason,
      'coins_granted', 0,
      'xp_granted', 0,
      'pair_cooldown_hours', v_pair_cooldown_hours,
      'daily_reward_limit', v_daily_reward_limit,
      'last_pair_rewarded_at', v_last_pair_reward
    );
  end if;

  -- Eligible reward. Amounts remain server-controlled and capped by V10.
  v_coins := least(v_challenge.reward_coins, 25);
  v_reward_xp := least(v_challenge.reward_xp, 50);

  select new_balance into v_balance
  from public.grant_wallet_coins(
    v_participant.user_id,
    v_coins,
    'challenge_reward',
    v_challenge.id,
    format('Reto completado: %s', v_challenge.exercise_name),
    format('challenge:%s:coins', p_participant_id)
  );

  select new_xp, new_level into v_xp, v_level
  from public.grant_user_xp(
    v_participant.user_id,
    v_reward_xp,
    'challenge_reward',
    v_challenge.id,
    format('Reto completado: %s', v_challenge.exercise_name),
    format('challenge:%s:xp', p_participant_id)
  );

  update public.user_progress
  set challenges_completed = challenges_completed + 1
  where user_id = v_participant.user_id;

  update public.challenge_participants
  set
    status = 'approved',
    completed_at = now(),
    rewarded_at = now(),
    reward_coins_granted = v_coins,
    reward_xp_granted = v_reward_xp,
    reward_block_reason = null
  where id = p_participant_id;

  update public.challenges
  set status = 'completed'
  where id = v_challenge.id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_participant.user_id,
    'challenge_approved',
    '¡Reto aprobado!',
    format('+%s DadoCoins y +%s XP', v_coins, v_reward_xp),
    jsonb_build_object(
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
    'already_rewarded', false,
    'reward_blocked', false,
    'reward_block_reason', null,
    'coins_granted', v_coins,
    'xp_granted', v_reward_xp,
    'new_balance', v_balance,
    'new_xp', v_xp,
    'new_level', v_level,
    'pair_cooldown_hours', v_pair_cooldown_hours,
    'daily_reward_limit', v_daily_reward_limit
  );
end;
$$;

revoke all on function public.review_direct_challenge(uuid, text, text) from public;
grant execute on function public.review_direct_challenge(uuid, text, text) to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v10.2-direct-antifarming',
    'reward_pair_cooldown_hours', 24,
    'reward_daily_limit', 5,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
