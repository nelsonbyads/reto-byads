-- DadoFit 2.1 - ECO-4C Challenge Reward Budget Enforcement
-- Connects dc_budgets to real DC payouts from review RPCs.

alter table public.challenges add column if not exists dc_budget_id uuid references public.dc_budgets(id) on delete set null;
alter table public.challenge_participants add column if not exists dc_block_reason text;

-- Resolves the active DC budget for a challenge, or null if none configured.
create or replace function public.eco4c_resolve_challenge_budget(p_challenge_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_challenge public.challenges;
  v_budget_id uuid;
begin
  select * into v_challenge from public.challenges where id = p_challenge_id;
  if not found then raise exception 'challenge not found'; end if;

  if v_challenge.dc_budget_id is not null then
    return v_challenge.dc_budget_id;
  end if;

  -- Partner/org challenge: look up an active budget for the organization.
  if v_challenge.creator_organization_id is not null then
    select id into v_budget_id from public.dc_budgets
      where organization_id = v_challenge.creator_organization_id and status = 'active'
      order by created_at desc limit 1;
    if v_budget_id is not null then return v_budget_id; end if;
  end if;

  -- Sponsored challenge: budget tied to its campaign/organization.
  if v_challenge.sponsor_campaign_id is not null then
    select sc.organization_id into v_budget_id from public.sponsor_campaigns sc
      where sc.id = v_challenge.sponsor_campaign_id;
    if v_budget_id is not null then
      select id into v_budget_id from public.dc_budgets
        where organization_id = v_budget_id and status = 'active'
        order by created_at desc limit 1;
      if v_budget_id is not null then return v_budget_id; end if;
    end if;
  end if;

  -- Internal DadoFit challenge: one active internal budget (if DadoFit configured one).
  select id into v_budget_id from public.dc_budgets
    where is_dadofit_internal = true and status = 'active'
    order by created_at desc limit 1;
  return v_budget_id;
end;
$$;

revoke all on function public.eco4c_resolve_challenge_budget(uuid) from public, anon, authenticated;

-- Gates DC grant behind budget consumption. Does NOT raise when blocked: returns
-- granted=false + block_reason so the approval can still succeed with 0 DC.
create or replace function public.eco4c_grant_dc(
  p_user_id uuid,
  p_amount bigint,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_idempotency_key text
)
returns table(granted boolean, block_reason text, new_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget_id uuid;
  v_challenge public.challenges;
  v_consume jsonb;
  v_tx uuid;
  v_bal bigint;
begin
  select * into v_challenge from public.challenges where id = p_source_id;
  v_budget_id := public.eco4c_resolve_challenge_budget(p_source_id);

  if v_budget_id is null then
    -- No budget configured: block emission, record participant reason, return current balance.
    update public.challenge_participants
      set dc_block_reason = case when v_challenge.creator_organization_id is not null or v_challenge.sponsor_campaign_id is not null
        then 'budget_not_configured' else 'budget_not_configured' end
      where challenge_id = p_source_id and user_id = p_user_id;
    return query select false, 'budget_not_configured'::text, (select w.balance from public.wallets w where w.user_id = p_user_id);
    return;
  end if;

  v_consume := public.consume_dc_budget_internal(
    v_budget_id, p_amount, 'grant', p_user_id, p_source_id, null, 'reward_payout', p_source_type, null, p_idempotency_key);

  if (v_consume->>'success')::boolean is not true then
    update public.challenge_participants set dc_block_reason = v_consume->>'block_reason'
      where challenge_id = p_source_id and user_id = p_user_id;
    return query select false, (v_consume->>'block_reason')::text, (select w.balance from public.wallets w where w.user_id = p_user_id);
    return;
  end if;

  select new_balance into v_bal from public.grant_wallet_coins(
    p_user_id, p_amount, p_source_type, p_source_id, p_description, p_idempotency_key);

  update public.challenge_participants set dc_block_reason = null
    where challenge_id = p_source_id and user_id = p_user_id;

  return query select true, null::text, v_bal;
end;
$$;

revoke all on function public.eco4c_grant_dc(uuid,bigint,text,uuid,text,text) from public, anon, authenticated;

-- Allow challenges to reference a DC budget explicitly.
alter table public.challenges add column if not exists dc_budget_id uuid references public.dc_budgets(id) on delete set null;

alter table public.challenge_participants add column if not exists dc_block_reason text;

create or replace function public.get_dadofit_schema_version()
returns text language sql stable as $$ select 'v15.7.18-eco4c-challenge-dc-budget-enforcement'::text; $$;
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
  v_dc_block_reason text;
  v_dc_ok boolean;
  v_granted_coins bigint := 0;
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

    v_dc_block_reason := null;
  v_granted_coins := 0;
  if v_coins > 0 then
    select gated.block_reason, gated.new_balance, gated.granted into v_dc_block_reason, v_balance, v_dc_ok
      from public.eco4c_grant_dc(v_participant.user_id,
    v_coins,
    'challenge_reward',
    v_challenge.id,
    format('Reto completado: %s', v_challenge.exercise_name),
    format('challenge:%s:coins', p_participant_id)) gated;
    if v_dc_ok then
      v_granted_coins := v_coins;
    end if;
    v_coins := v_granted_coins;
  else
    select coalesce((select w.balance from public.wallets w where w.user_id = v_participant.user_id),0) into v_balance;
  end if;

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
    reward_coins_granted=v_coins, dc_block_reason=v_dc_block_reason,
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
  v_dc_block_reason text;
  v_dc_ok boolean;
  v_granted_coins bigint := 0;
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

    v_dc_block_reason := null;
  v_granted_coins := 0;
  if v_coins > 0 then
    select gated.block_reason, gated.new_balance, gated.granted into v_dc_block_reason, v_balance, v_dc_ok
      from public.eco4c_grant_dc(v_participant.user_id,
    v_coins,
    'squad_battle_reward',
    v_challenge.id,
    format('Batalla de Squad completada: %s', v_challenge.exercise_name),
    format('group-challenge:%s:coins', p_participant_id)) gated;
    if v_dc_ok then
      v_granted_coins := v_coins;
    end if;
    v_coins := v_granted_coins;
  else
    select coalesce((select w.balance from public.wallets w where w.user_id = v_participant.user_id),0) into v_balance;
  end if;

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
    reward_coins_granted=v_coins, dc_block_reason=v_dc_block_reason,
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


-- Rebuild review so each configured reward dimension may legally be zero.
create or replace function public.review_organization_challenge(
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
  v_dc_block_reason text;
  v_dc_ok boolean;
  v_granted_coins bigint := 0;
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_balance bigint := 0;
  v_xp bigint := 0;
  v_level integer := 1;
  v_coins bigint := 0;
  v_reward_xp bigint := 0;
  v_gym_points integer := 0;
  v_has_reward boolean := false;
  v_reward_block_reason text := null;
  v_last_pair_reward timestamptz;
  v_user_rewards_last_24h integer := 0;
  v_pair_cooldown_hours constant integer := 24;
  v_daily_reward_limit constant integer := 5;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;

  select * into v_participant from public.challenge_participants where id=p_participant_id for update;
  if not found then raise exception 'organization challenge participant not found'; end if;

  select * into v_challenge from public.challenges where id=v_participant.challenge_id;
  if v_challenge.challenge_type<>'organization' or v_challenge.metadata->>'reward_policy'<>'v12-organization-member' then
    raise exception 'not a V12 organization challenge';
  end if;

  if not public.is_organization_manager(v_challenge.creator_organization_id) then
    raise exception 'only organization owners, admins or coaches can review evidence';
  end if;
  if v_participant.user_id=v_actor then raise exception 'you cannot review your own evidence'; end if;

  if v_participant.status='approved' then
    return jsonb_build_object(
      'status','approved','already_rewarded',v_participant.rewarded_at is not null,
      'reward_blocked',v_participant.reward_block_reason is not null,
      'reward_block_reason',v_participant.reward_block_reason,
      'coins_granted',v_participant.reward_coins_granted,
      'xp_granted',v_participant.reward_xp_granted,
      'sponsor_points',v_participant.sponsor_points_granted,
      'gym_points',v_participant.sponsor_points_granted,
      'rewarded_at',v_participant.rewarded_at
    );
  end if;

  if v_participant.status<>'submitted' then raise exception 'evidence can only be reviewed after submission'; end if;

  insert into public.challenge_reviews(participant_id,reviewer_user_id,decision,notes)
  values(p_participant_id,v_actor,p_decision,nullif(btrim(p_notes),''));

  if p_decision='rejected' then
    update public.challenge_participants set status='rejected' where id=p_participant_id;
    insert into public.notifications(user_id,notification_type,title,body,data)
    values(v_participant.user_id,'organization_challenge_evidence_rejected','Tu evidencia necesita otro intento',
      coalesce(nullif(btrim(p_notes),''),'Sube una nueva evidencia y vuelve a enviarla.'),
      jsonb_build_object('organization_id',v_challenge.creator_organization_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id));
    return jsonb_build_object('status','rejected','reward_blocked',false,'coins_granted',0,'xp_granted',0,'sponsor_points',0,'gym_points',0);
  end if;

  v_coins := least(greatest(v_challenge.reward_coins,0),25);
  v_reward_xp := least(greatest(v_challenge.reward_xp,0),50);
  v_gym_points := least(greatest(v_challenge.sponsor_points,0),100);
  v_has_reward := (v_coins>0 or v_reward_xp>0 or v_gym_points>0);

  if v_has_reward then
    perform pg_advisory_xact_lock(hashtextextended('dadofit:organization-reward:user:'||v_participant.user_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended('dadofit:organization-reward:pair:'||v_challenge.creator_organization_id::text||':'||v_participant.user_id::text,0));

    select max(cp.rewarded_at) into v_last_pair_reward
    from public.challenge_participants cp
    join public.challenges c on c.id=cp.challenge_id
    where cp.user_id=v_participant.user_id
      and cp.id<>p_participant_id
      and cp.status='approved'
      and cp.rewarded_at is not null
      and cp.rewarded_at>now()-interval '24 hours'
      and c.challenge_type='organization'
      and c.creator_organization_id=v_challenge.creator_organization_id
      and c.metadata->>'reward_policy'='v12-organization-member'
      and (cp.reward_coins_granted>0 or cp.reward_xp_granted>0 or cp.sponsor_points_granted>0);

    if v_last_pair_reward is not null then v_reward_block_reason:='organization_pair_cooldown'; end if;

    if v_reward_block_reason is null then
      select count(*)::integer into v_user_rewards_last_24h
      from public.challenge_participants cp
      join public.challenges c on c.id=cp.challenge_id
      where cp.user_id=v_participant.user_id
        and cp.id<>p_participant_id
        and cp.status='approved'
        and cp.rewarded_at is not null
        and cp.rewarded_at>now()-interval '24 hours'
        and c.challenge_type='organization'
        and c.metadata->>'reward_policy'='v12-organization-member'
        and (cp.reward_coins_granted>0 or cp.reward_xp_granted>0 or cp.sponsor_points_granted>0);
      if v_user_rewards_last_24h>=v_daily_reward_limit then v_reward_block_reason:='organization_daily_limit'; end if;
    end if;
  end if;

  if v_reward_block_reason is not null then
    update public.user_progress set challenges_completed=challenges_completed+1 where user_id=v_participant.user_id;
    update public.challenge_participants
    set status='approved',completed_at=now(),rewarded_at=null,reward_coins_granted=0,reward_xp_granted=0,sponsor_points_granted=0,reward_block_reason=v_reward_block_reason
    where id=p_participant_id;

    insert into public.notifications(user_id,notification_type,title,body,data)
    values(v_participant.user_id,'organization_challenge_approved_no_reward','¡Reto de Gym aprobado!',
      case v_reward_block_reason
        when 'organization_pair_cooldown' then 'Reto completado. Este Gym ya te otorgó una recompensa durante las últimas 24 horas.'
        when 'organization_daily_limit' then 'Reto completado. Alcanzaste el límite de 5 recompensas de organizaciones en 24 horas.'
        else 'Reto completado sin recompensa adicional por política anti-farming.' end,
      jsonb_build_object('organization_id',v_challenge.creator_organization_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id,'reward_blocked',true,'reward_block_reason',v_reward_block_reason));

    perform public.maybe_complete_organization_challenge(v_challenge.id);
    return jsonb_build_object('status','approved','reward_blocked',true,'reward_block_reason',v_reward_block_reason,
      'coins_granted',0,'xp_granted',0,'sponsor_points',0,'gym_points',0,
      'pair_cooldown_hours',v_pair_cooldown_hours,'daily_reward_limit',v_daily_reward_limit);
  end if;

  -- Read current values first so zero-valued dimensions remain safe.
  select coalesce((select w.balance from public.wallets w where w.user_id=v_participant.user_id),0) into v_balance;
  select
    coalesce((select up.xp from public.user_progress up where up.user_id=v_participant.user_id),0),
    coalesce((select up.level from public.user_progress up where up.user_id=v_participant.user_id),1)
  into v_xp,v_level;

  if v_coins>0 then
      v_dc_block_reason := null;
  v_granted_coins := 0;
  if v_coins > 0 then
    select gated.block_reason, gated.new_balance, gated.granted into v_dc_block_reason, v_balance, v_dc_ok
      from public.eco4c_grant_dc(v_participant.user_id,v_coins,'organization_challenge_reward',v_challenge.id,
      format('Reto de Gym completado: %s',v_challenge.exercise_name),format('organization-challenge:%s:coins',p_participant_id)) gated;
    if v_dc_ok then
      v_granted_coins := v_coins;
    end if;
    v_coins := v_granted_coins;
  else
    select coalesce((select w.balance from public.wallets w where w.user_id = v_participant.user_id),0) into v_balance;
  end if;
  end if;

  if v_reward_xp>0 then
    select new_xp,new_level into v_xp,v_level
    from public.grant_user_xp(v_participant.user_id,v_reward_xp,'organization_challenge_reward',v_challenge.id,
      format('Reto de Gym completado: %s',v_challenge.exercise_name),format('organization-challenge:%s:xp',p_participant_id));
  end if;

  update public.user_progress set challenges_completed=challenges_completed+1 where user_id=v_participant.user_id;

  update public.challenge_participants
  set status='approved',completed_at=now(),rewarded_at=case when v_has_reward then now() else null end,
      reward_coins_granted=v_coins, dc_block_reason=v_dc_block_reason,reward_xp_granted=v_reward_xp,sponsor_points_granted=v_gym_points,reward_block_reason=null
  where id=p_participant_id;

  if v_gym_points>0 then
    insert into public.score_events(season_id,challenge_id,participant_id,group_id,organization_id,team_points,sponsor_points)
    values(v_challenge.season_id,v_challenge.id,p_participant_id,null,v_challenge.creator_organization_id,0,v_gym_points)
    on conflict(participant_id) do nothing;
  end if;

  insert into public.notifications(user_id,notification_type,title,body,data)
  values(v_participant.user_id,'organization_challenge_approved','¡Reto de Gym aprobado!',
    format('Recompensa aplicada: +%s DC · +%s XP · +%s GP',v_coins,v_reward_xp,v_gym_points),
    jsonb_build_object('organization_id',v_challenge.creator_organization_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id,
      'coins',v_coins,'xp',v_reward_xp,'sponsor_points',v_gym_points,'gym_points',v_gym_points,'balance',v_balance,'level',v_level,'reward_blocked',false));

  perform public.maybe_complete_organization_challenge(v_challenge.id);

  return jsonb_build_object('status','approved','reward_blocked',false,'reward_block_reason',null,
    'coins_granted',v_coins,'xp_granted',v_reward_xp,'sponsor_points',v_gym_points,'gym_points',v_gym_points,
    'new_balance',v_balance,'new_xp',v_xp,'new_level',v_level,
    'pair_cooldown_hours',v_pair_cooldown_hours,'daily_reward_limit',v_daily_reward_limit);
end;
$$;


create or replace function public.review_organization_battle(
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
  v_dc_block_reason text;
  v_dc_ok boolean;
  v_granted_coins bigint := 0;
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_battle public.organization_battles%rowtype;
  v_review_organization_id uuid;
  v_balance bigint;
  v_xp bigint;
  v_level integer;
  v_coins bigint;
  v_reward_xp bigint;
  v_sponsor_points integer;
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
    raise exception 'Gym battle participant not found';
  end if;

  select * into v_challenge from public.challenges where id = v_participant.challenge_id;
  select * into v_battle from public.organization_battles where challenge_id = v_participant.challenge_id;

  if v_challenge.metadata ->> 'reward_policy' <> 'v12.1-gym-battle'
     or v_battle.status <> 'active'
     or v_participant.organization_id is null then
    raise exception 'not an active V12.1 Gym battle';
  end if;

  v_review_organization_id := case
    when v_participant.organization_id = v_battle.challenger_organization_id then v_battle.challenged_organization_id
    when v_participant.organization_id = v_battle.challenged_organization_id then v_battle.challenger_organization_id
    else null
  end;

  if v_review_organization_id is null or not public.is_organization_manager(v_review_organization_id) then
    raise exception 'only an opposing Gym manager can review this evidence';
  end if;

  if v_participant.user_id = v_actor then
    raise exception 'you cannot review your own evidence';
  end if;

  if v_participant.status = 'approved' then
    return jsonb_build_object(
      'status', 'approved',
      'already_rewarded', v_participant.rewarded_at is not null,
      'reward_blocked', v_participant.reward_block_reason is not null,
      'reward_block_reason', v_participant.reward_block_reason,
      'coins_granted', v_participant.reward_coins_granted,
      'xp_granted', v_participant.reward_xp_granted,
      'sponsor_points', v_participant.sponsor_points_granted,
      'rewarded_at', v_participant.rewarded_at
    );
  end if;

  if v_participant.status <> 'submitted' then
    raise exception 'evidence can only be reviewed after submission';
  end if;

  insert into public.challenge_reviews (participant_id, reviewer_user_id, decision, notes)
  values (p_participant_id, v_actor, p_decision, nullif(btrim(p_notes), ''));

  if p_decision = 'rejected' then
    update public.challenge_participants set status = 'rejected' where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'gym_battle_evidence_rejected',
      'Tu evidencia necesita otro intento',
      coalesce(nullif(btrim(p_notes), ''), 'Sube una nueva evidencia y vuelve a enviarla.'),
      jsonb_build_object('organization_battle_id', v_battle.id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id)
    );

    return jsonb_build_object('status', 'rejected', 'reward_blocked', false, 'coins_granted', 0, 'xp_granted', 0, 'sponsor_points', 0);
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('dadofit:gym-battle-reward:user:' || v_participant.user_id::text, 0)
  );

  v_pair_key :=
    least(v_battle.challenger_organization_id::text, v_battle.challenged_organization_id::text)
    || ':' ||
    greatest(v_battle.challenger_organization_id::text, v_battle.challenged_organization_id::text);

  perform pg_advisory_xact_lock(
    hashtextextended('dadofit:gym-battle-reward:pair:' || v_pair_key, 0)
  );

  select max(se.created_at)
    into v_last_pair_reward
  from public.score_events se
  join public.organization_battles ob on ob.challenge_id = se.challenge_id
  where ob.id <> v_battle.id
    and se.sponsor_points > 0
    and se.created_at > now() - interval '24 hours'
    and (
      (ob.challenger_organization_id = v_battle.challenger_organization_id and ob.challenged_organization_id = v_battle.challenged_organization_id)
      or
      (ob.challenger_organization_id = v_battle.challenged_organization_id and ob.challenged_organization_id = v_battle.challenger_organization_id)
    );

  if v_last_pair_reward is not null then
    v_reward_block_reason := 'gym_pair_cooldown';
  end if;

  if v_reward_block_reason is null then
    select count(*)::integer
      into v_user_rewards_last_24h
    from public.challenge_participants cp
    join public.challenges c on c.id = cp.challenge_id
    where cp.user_id = v_participant.user_id
      and cp.id <> p_participant_id
      and cp.status = 'approved'
      and cp.rewarded_at is not null
      and cp.rewarded_at > now() - interval '24 hours'
      and c.metadata ->> 'reward_policy' = 'v12.1-gym-battle'
      and (cp.reward_coins_granted > 0 or cp.reward_xp_granted > 0 or cp.sponsor_points_granted > 0);

    if v_user_rewards_last_24h >= v_daily_reward_limit then
      v_reward_block_reason := 'gym_daily_limit';
    end if;
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
        sponsor_points_granted = 0,
        reward_block_reason = v_reward_block_reason
    where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'gym_battle_approved_no_reward',
      '¡Aporte Gym aprobado!',
      case v_reward_block_reason
        when 'gym_pair_cooldown' then 'Aporte completado. Estos Gyms ya generaron recompensas entre sí durante las últimas 24 horas.'
        when 'gym_daily_limit' then 'Aporte completado. Alcanzaste el límite de 5 recompensas Gym vs Gym en 24 horas.'
        else 'Aporte completado sin recompensa adicional por política anti-farming.'
      end,
      jsonb_build_object(
        'organization_battle_id', v_battle.id,
        'challenge_id', v_challenge.id,
        'participant_id', p_participant_id,
        'reward_blocked', true,
        'reward_block_reason', v_reward_block_reason
      )
    );

    perform public.maybe_complete_organization_battle(v_battle.id);

    return jsonb_build_object(
      'status', 'approved',
      'reward_blocked', true,
      'reward_block_reason', v_reward_block_reason,
      'coins_granted', 0,
      'xp_granted', 0,
      'sponsor_points', 0,
      'pair_cooldown_hours', v_pair_cooldown_hours,
      'daily_reward_limit', v_daily_reward_limit
    );
  end if;

  v_coins := least(v_challenge.reward_coins, 25);
  v_reward_xp := least(v_challenge.reward_xp, 50);
  v_sponsor_points := least(v_challenge.sponsor_points, 100);

    v_dc_block_reason := null;
  v_granted_coins := 0;
  if v_coins > 0 then
    select gated.block_reason, gated.new_balance, gated.granted into v_dc_block_reason, v_balance, v_dc_ok
      from public.eco4c_grant_dc(v_participant.user_id,
    v_coins,
    'gym_battle_reward',
    v_challenge.id,
    format('Gym vs Gym completado: %s', v_challenge.exercise_name),
    format('gym-battle:%s:coins', p_participant_id)) gated;
    if v_dc_ok then
      v_granted_coins := v_coins;
    end if;
    v_coins := v_granted_coins;
  else
    select coalesce((select w.balance from public.wallets w where w.user_id = v_participant.user_id),0) into v_balance;
  end if;

  select new_xp, new_level into v_xp, v_level
  from public.grant_user_xp(
    v_participant.user_id,
    v_reward_xp,
    'gym_battle_reward',
    v_challenge.id,
    format('Gym vs Gym completado: %s', v_challenge.exercise_name),
    format('gym-battle:%s:xp', p_participant_id)
  );

  update public.user_progress
  set challenges_completed = challenges_completed + 1
  where user_id = v_participant.user_id;

  update public.challenge_participants
  set status = 'approved',
      completed_at = now(),
      rewarded_at = now(),
      reward_coins_granted=v_coins, dc_block_reason=v_dc_block_reason,
      reward_xp_granted = v_reward_xp,
      sponsor_points_granted = v_sponsor_points,
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
    null,
    v_participant.organization_id,
    0,
    v_sponsor_points
  )
  on conflict (participant_id) do nothing;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_participant.user_id,
    'gym_battle_approved',
    '¡Aporte Gym aprobado!',
    format('+%s DadoCoins, +%s XP y +%s Sponsor Points', v_coins, v_reward_xp, v_sponsor_points),
    jsonb_build_object(
      'organization_battle_id', v_battle.id,
      'challenge_id', v_challenge.id,
      'participant_id', p_participant_id,
      'organization_id', v_participant.organization_id,
      'coins', v_coins,
      'xp', v_reward_xp,
      'sponsor_points', v_sponsor_points,
      'balance', v_balance,
      'level', v_level,
      'reward_blocked', false
    )
  );

  perform public.maybe_complete_organization_battle(v_battle.id);

  return jsonb_build_object(
    'status', 'approved',
    'reward_blocked', false,
    'reward_block_reason', null,
    'coins_granted', v_coins,
    'xp_granted', v_reward_xp,
    'sponsor_points', v_sponsor_points,
    'new_balance', v_balance,
    'new_xp', v_xp,
    'new_level', v_level,
    'pair_cooldown_hours', v_pair_cooldown_hours,
    'daily_reward_limit', v_daily_reward_limit
  );
end;
$$;


-- Reward finalizer: sponsored challenges grant SP to a sponsor-specific wallet.
create or replace function public.complete_sponsored_approval_v133(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dc_block_reason text;
  v_dc_ok boolean;
  v_granted_coins bigint := 0;
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_campaign_name text;
  v_sponsor_name text;
  v_daily_rewards integer := 0;
  v_daily_limit constant integer := 3;
  v_coins bigint := 0;
  v_reward_xp bigint := 0;
  v_reward_sp bigint := 0;
  v_balance bigint := 0;
  v_sp_balance bigint := 0;
  v_xp bigint := 0;
  v_level integer := 1;
  v_reward_block_reason text := null;
begin
  select * into v_participant from public.challenge_participants where id=p_participant_id for update;
  if not found then raise exception 'participant not found'; end if;
  select * into v_challenge from public.challenges where id=v_participant.challenge_id;
  if not found or v_challenge.challenge_type<>'sponsored' or v_challenge.metadata->>'reward_policy'<>'v13-sponsored' then
    raise exception 'participant does not belong to a sponsored challenge';
  end if;

  if v_participant.rewarded_at is not null then
    return jsonb_build_object('status','approved','already_rewarded',true,'reward_blocked',false,
      'coins_granted',v_participant.reward_coins_granted,'xp_granted',v_participant.reward_xp_granted,
      'sp_granted',v_participant.sponsor_reward_points_granted);
  end if;

  select sc.name,o.name into v_campaign_name,v_sponsor_name
  from public.sponsor_campaigns sc join public.organizations o on o.id=sc.organization_id
  where sc.id=v_challenge.sponsor_campaign_id;

  perform pg_advisory_xact_lock(hashtextextended('dadofit:sponsored-reward:user:'||v_participant.user_id::text,0));

  select count(*)::integer into v_daily_rewards
  from public.challenge_participants cp
  join public.challenges c on c.id=cp.challenge_id
  where cp.user_id=v_participant.user_id and cp.id<>p_participant_id and cp.status='approved' and cp.rewarded_at is not null
    and (cp.reward_coins_granted>0 or cp.reward_xp_granted>0 or cp.sponsor_reward_points_granted>0)
    and c.challenge_type='sponsored' and c.metadata->>'reward_policy'='v13-sponsored'
    and cp.rewarded_at>now()-interval '24 hours';

  if v_daily_rewards>=v_daily_limit then v_reward_block_reason:='sponsored_daily_limit'; end if;

  if v_reward_block_reason is not null then
    update public.user_progress set challenges_completed=challenges_completed+1 where user_id=v_participant.user_id;
    update public.challenge_participants
    set status='approved',completed_at=now(),rewarded_at=null,reward_coins_granted=0,reward_xp_granted=0,
        sponsor_reward_points_granted=0,reward_block_reason=v_reward_block_reason,updated_at=now()
    where id=p_participant_id;
    insert into public.notifications(user_id,notification_type,title,body,data)
    values(v_participant.user_id,'sponsored_approved_no_reward','¡Branded Challenge aprobado!',
      'Reto completado. Alcanzaste el límite de 3 recompensas patrocinadas en una ventana de 24 horas.',
      jsonb_build_object('campaign_id',v_challenge.sponsor_campaign_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id,
        'reward_blocked',true,'reward_block_reason',v_reward_block_reason,'coins',0,'xp',0,'sp',0));
    return jsonb_build_object('status','approved','reward_blocked',true,'reward_block_reason',v_reward_block_reason,
      'coins_granted',0,'xp_granted',0,'sp_granted',0,'daily_reward_limit',v_daily_limit);
  end if;

  v_coins := least(v_challenge.reward_coins,50);
  v_reward_xp := least(v_challenge.reward_xp,100);
  v_reward_sp := least(v_challenge.sponsor_reward_points,500);

  if v_coins>0 then
      v_dc_block_reason := null;
  v_granted_coins := 0;
  if v_coins > 0 then
    select gated.block_reason, gated.new_balance, gated.granted into v_dc_block_reason, v_balance, v_dc_ok
      from public.eco4c_grant_dc(v_participant.user_id,v_coins,'sponsored_challenge_reward',v_challenge.id,
      format('Branded Challenge completado: %s',coalesce(v_campaign_name,v_challenge.exercise_name)),format('sponsored-challenge:%s:coins',p_participant_id)) gated;
    if v_dc_ok then
      v_granted_coins := v_coins;
    end if;
    v_coins := v_granted_coins;
  else
    select coalesce((select w.balance from public.wallets w where w.user_id = v_participant.user_id),0) into v_balance;
  end if;
  else
    select coalesce(w.balance,0) into v_balance from public.wallets w where w.user_id=v_participant.user_id;
  end if;

  if v_reward_xp>0 then
    select new_xp,new_level into v_xp,v_level from public.grant_user_xp(v_participant.user_id,v_reward_xp,'sponsored_challenge_reward',v_challenge.id,
      format('Branded Challenge completado: %s',coalesce(v_campaign_name,v_challenge.exercise_name)),format('sponsored-challenge:%s:xp',p_participant_id));
  else
    select coalesce(up.xp,0),coalesce(up.level,1) into v_xp,v_level from public.user_progress up where up.user_id=v_participant.user_id;
  end if;

  if v_reward_sp>0 then
    select new_balance into v_sp_balance from public.grant_sponsor_points(v_participant.user_id,v_challenge.creator_organization_id,v_reward_sp,
      'sponsored_challenge_reward',v_challenge.id,
      format('Sponsor Points por %s',coalesce(v_campaign_name,v_challenge.exercise_name)),format('sponsored-challenge:%s:sp',p_participant_id));
  else
    select coalesce(w.balance,0) into v_sp_balance from public.sponsor_point_wallets w
    where w.user_id=v_participant.user_id and w.sponsor_organization_id=v_challenge.creator_organization_id;
  end if;

  update public.user_progress set challenges_completed=challenges_completed+1 where user_id=v_participant.user_id;
  update public.challenge_participants
  set status='approved',completed_at=now(),rewarded_at=now(),reward_coins_granted=v_coins, dc_block_reason=v_dc_block_reason,reward_xp_granted=v_reward_xp,
      sponsor_reward_points_granted=v_reward_sp,reward_block_reason=null,updated_at=now()
  where id=p_participant_id;

  insert into public.notifications(user_id,notification_type,title,body,data)
  values(v_participant.user_id,'sponsored_approved','¡Branded Challenge aprobado!',
    format('+%s DadoCoins · +%s XP · +%s SP %s',v_coins,v_reward_xp,v_reward_sp,coalesce(v_sponsor_name,'Sponsor')),
    jsonb_build_object('campaign_id',v_challenge.sponsor_campaign_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id,
      'coins',v_coins,'xp',v_reward_xp,'sp',v_reward_sp,'sponsor_organization_id',v_challenge.creator_organization_id,
      'sponsor_name',v_sponsor_name,'balance',v_balance,'sp_balance',v_sp_balance,'level',v_level,'reward_blocked',false));

  return jsonb_build_object('status','approved','reward_blocked',false,'coins_granted',v_coins,'xp_granted',v_reward_xp,
    'sp_granted',v_reward_sp,'sponsor_name',v_sponsor_name,'balance',v_balance,'sp_balance',v_sp_balance,'xp',v_xp,'level',v_level,
    'daily_reward_limit',v_daily_limit);
end;
$$;
