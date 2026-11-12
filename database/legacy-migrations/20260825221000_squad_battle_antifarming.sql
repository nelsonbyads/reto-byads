-- DadoFit V11.1 - Squad Battle Anti-Farming
-- Group battles get their own anti-farming guard before functional validation.
-- Rules:
--   1) Same Squad pair: max 1 rewarded battle per rolling 24h.
--   2) Same user: max 5 rewarded Squad-battle contributions per rolling 24h.
--   3) Same participant: reward remains idempotent and can only be granted once.
-- A blocked contribution is still completed and counts in challenges_completed,
-- but grants 0 DadoCoins, 0 XP and 0 Team Points.

alter table public.challenge_participants
  add column if not exists team_points_granted integer not null default 0 check (team_points_granted >= 0);

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
      'squad_daily_limit'
    )
  );

create index if not exists group_battles_pair_recent_idx
  on public.group_battles (challenger_group_id, challenged_group_id, created_at desc);

create or replace function public.review_group_challenge(
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
  v_battle public.group_battles%rowtype;
  v_review_group_id uuid;
  v_balance bigint;
  v_xp bigint;
  v_level integer;
  v_coins bigint;
  v_reward_xp bigint;
  v_team_points integer;
  v_reward_block_reason text := null;
  v_last_pair_reward timestamptz;
  v_user_rewards_last_24h integer := 0;
  v_pair_cooldown_hours constant integer := 24;
  v_daily_reward_limit constant integer := 5;
  v_pair_key text;
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

  select * into v_battle
  from public.group_battles
  where challenge_id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'group'
     or v_challenge.metadata ->> 'reward_policy' <> 'v11-squad-battle'
     or v_battle.status <> 'active' then
    raise exception 'challenge is not a V11 squad battle';
  end if;

  v_review_group_id := case
    when v_participant.group_id = v_battle.challenger_group_id then v_battle.challenged_group_id
    else v_battle.challenger_group_id
  end;

  if not public.is_group_admin(v_review_group_id) then
    raise exception 'only an opposing squad captain can review this evidence';
  end if;

  if v_participant.status = 'approved' then
    return jsonb_build_object(
      'status', 'approved',
      'already_rewarded', v_participant.rewarded_at is not null,
      'reward_blocked', v_participant.reward_block_reason is not null,
      'reward_block_reason', v_participant.reward_block_reason,
      'coins_granted', v_participant.reward_coins_granted,
      'xp_granted', v_participant.reward_xp_granted,
      'team_points', v_participant.team_points_granted,
      'rewarded_at', v_participant.rewarded_at,
      'pair_cooldown_hours', v_pair_cooldown_hours,
      'daily_reward_limit', v_daily_reward_limit
    );
  end if;

  if v_participant.status <> 'submitted' then
    raise exception 'evidence can only be reviewed after submission';
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
      'squad_battle_evidence_rejected',
      'Tu evidencia necesita otro intento',
      coalesce(nullif(btrim(p_notes), ''), 'Sube una nueva evidencia y vuelve a enviarla.'),
      jsonb_build_object('battle_id', v_battle.id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id)
    );

    return jsonb_build_object(
      'status', 'rejected',
      'already_rewarded', false,
      'reward_blocked', false,
      'reward_block_reason', null,
      'coins_granted', 0,
      'xp_granted', 0,
      'team_points', 0
    );
  end if;

  -- Serialize reward decisions for the same user and same Squad pair.
  perform pg_advisory_xact_lock(
    hashtextextended('dadofit:squad-reward:user:' || v_participant.user_id::text, 0)
  );

  v_pair_key :=
    least(v_battle.challenger_group_id::text, v_battle.challenged_group_id::text)
    || ':' ||
    greatest(v_battle.challenger_group_id::text, v_battle.challenged_group_id::text);

  perform pg_advisory_xact_lock(
    hashtextextended('dadofit:squad-reward:pair:' || v_pair_key, 0)
  );

  -- Same Squad pair can generate economic/Team-Point rewards in only one battle
  -- during the rolling cooldown. Other members in the current battle are excluded
  -- from this check so all members of the eligible battle can contribute normally.
  select max(se.created_at)
    into v_last_pair_reward
  from public.score_events se
  join public.group_battles gb on gb.challenge_id = se.challenge_id
  where gb.id <> v_battle.id
    and se.team_points > 0
    and se.created_at > now() - interval '24 hours'
    and (
      (gb.challenger_group_id = v_battle.challenger_group_id and gb.challenged_group_id = v_battle.challenged_group_id)
      or
      (gb.challenger_group_id = v_battle.challenged_group_id and gb.challenged_group_id = v_battle.challenger_group_id)
    );

  if v_last_pair_reward is not null then
    v_reward_block_reason := 'squad_pair_cooldown';
  end if;

  -- Per-user Squad battle cap. Only payouts actually granted count.
  if v_reward_block_reason is null then
    select count(*)::integer
      into v_user_rewards_last_24h
    from public.challenge_participants cp
    join public.challenges c on c.id = cp.challenge_id
    where cp.user_id = v_participant.user_id
      and cp.id <> p_participant_id
      and cp.status = 'approved'
      and cp.rewarded_at is not null
      and (cp.reward_coins_granted > 0 or cp.reward_xp_granted > 0 or cp.team_points_granted > 0)
      and c.challenge_type = 'group'
      and c.metadata ->> 'reward_policy' = 'v11-squad-battle'
      and cp.rewarded_at > now() - interval '24 hours';

    if v_user_rewards_last_24h >= v_daily_reward_limit then
      v_reward_block_reason := 'squad_daily_limit';
    end if;
  end if;

  -- Valid completion without economic/competitive payout when anti-farming applies.
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
      team_points_granted = 0,
      reward_block_reason = v_reward_block_reason
    where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'squad_battle_approved_no_reward',
      '¡Aporte aprobado!',
      case v_reward_block_reason
        when 'squad_pair_cooldown' then 'Aporte completado. Estos Squads ya generaron recompensas entre sí durante las últimas 24 horas.'
        when 'squad_daily_limit' then 'Aporte completado. Alcanzaste el límite de 5 recompensas de batallas de Squad en 24 horas.'
        else 'Aporte completado sin recompensa adicional por política anti-farming.'
      end,
      jsonb_build_object(
        'battle_id', v_battle.id,
        'challenge_id', v_challenge.id,
        'participant_id', p_participant_id,
        'coins', 0,
        'xp', 0,
        'team_points', 0,
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
      'team_points', 0,
      'pair_cooldown_hours', v_pair_cooldown_hours,
      'daily_reward_limit', v_daily_reward_limit,
      'last_pair_rewarded_at', v_last_pair_reward
    );
  end if;

  v_coins := least(v_challenge.reward_coins, 25);
  v_reward_xp := least(v_challenge.reward_xp, 50);
  v_team_points := least(v_challenge.team_points, 100);

  select new_balance into v_balance
  from public.grant_wallet_coins(
    v_participant.user_id,
    v_coins,
    'squad_battle_reward',
    v_challenge.id,
    format('Batalla de Squad completada: %s', v_challenge.exercise_name),
    format('group-challenge:%s:coins', p_participant_id)
  );

  select new_xp, new_level into v_xp, v_level
  from public.grant_user_xp(
    v_participant.user_id,
    v_reward_xp,
    'squad_battle_reward',
    v_challenge.id,
    format('Batalla de Squad completada: %s', v_challenge.exercise_name),
    format('group-challenge:%s:xp', p_participant_id)
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
    team_points_granted = v_team_points,
    reward_block_reason = null
  where id = p_participant_id;

  insert into public.score_events (
    season_id,
    challenge_id,
    participant_id,
    group_id,
    organization_id,
    team_points,
    sponsor_points
  ) values (
    v_challenge.season_id,
    v_challenge.id,
    p_participant_id,
    v_participant.group_id,
    null,
    v_team_points,
    0
  )
  on conflict (participant_id) do nothing;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_participant.user_id,
    'squad_battle_approved',
    '¡Aporte aprobado!',
    format('+%s DadoCoins, +%s XP y +%s Team Points', v_coins, v_reward_xp, v_team_points),
    jsonb_build_object(
      'battle_id', v_battle.id,
      'challenge_id', v_challenge.id,
      'participant_id', p_participant_id,
      'coins', v_coins,
      'xp', v_reward_xp,
      'team_points', v_team_points,
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
    'team_points', v_team_points,
    'new_balance', v_balance,
    'new_xp', v_xp,
    'new_level', v_level,
    'pair_cooldown_hours', v_pair_cooldown_hours,
    'daily_reward_limit', v_daily_reward_limit
  );
end;
$$;

revoke all on function public.review_group_challenge(uuid, text, text) from public;
grant execute on function public.review_group_challenge(uuid, text, text) to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v11.1-squad-antifarming',
    'direct_pair_cooldown_hours', 24,
    'direct_daily_limit', 5,
    'squad_pair_cooldown_hours', 24,
    'squad_daily_limit', 5,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
