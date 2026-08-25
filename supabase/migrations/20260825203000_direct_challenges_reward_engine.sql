-- DadoFit V10.0 - Direct Challenges + Reward Engine
-- 1v1 challenges between accepted Gymbros, private evidence and single-use rewards.

alter table public.challenge_participants
  add column if not exists rewarded_at timestamptz,
  add column if not exists reward_coins_granted bigint not null default 0 check (reward_coins_granted >= 0),
  add column if not exists reward_xp_granted bigint not null default 0 check (reward_xp_granted >= 0);

-- Reviews are history. A rejected submission may be corrected and reviewed again.
alter table public.challenge_reviews
  drop constraint if exists challenge_reviews_participant_id_key;

create index if not exists challenge_reviews_participant_created_idx
  on public.challenge_reviews (participant_id, created_at desc);

create or replace function public.are_gymbros(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = p_user_a and f.addressee_id = p_user_b)
        or (f.requester_id = p_user_b and f.addressee_id = p_user_a)
      )
  );
$$;

revoke all on function public.are_gymbros(uuid, uuid) from public;
grant execute on function public.are_gymbros(uuid, uuid) to authenticated;

create or replace function public.grant_user_xp(
  p_user_id uuid,
  p_amount bigint,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_idempotency_key text
)
returns table(transaction_id uuid, new_xp bigint, new_level integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
  v_xp bigint;
  v_level integer;
begin
  if p_amount <= 0 then
    raise exception 'p_amount must be greater than zero';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'p_idempotency_key is required';
  end if;

  select xp, level
    into v_xp, v_level
  from public.user_progress
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'progress not found for user %', p_user_id;
  end if;

  insert into public.progress_transactions (
    user_id,
    xp_amount,
    source_type,
    source_id,
    description,
    idempotency_key
  ) values (
    p_user_id,
    p_amount,
    p_source_type,
    p_source_id,
    p_description,
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select id into v_transaction_id
    from public.progress_transactions
    where idempotency_key = p_idempotency_key;

    select xp, level into v_xp, v_level
    from public.user_progress
    where user_id = p_user_id;

    return query select v_transaction_id, v_xp, v_level;
    return;
  end if;

  update public.user_progress
  set
    xp = xp + p_amount,
    level = greatest(level, 1 + ((xp + p_amount) / 500)::integer)
  where user_id = p_user_id
  returning xp, level into v_xp, v_level;

  return query select v_transaction_id, v_xp, v_level;
end;
$$;

revoke all on function public.grant_user_xp(uuid, bigint, text, uuid, text, text) from public;
revoke all on function public.grant_user_xp(uuid, bigint, text, uuid, text, text) from anon;
revoke all on function public.grant_user_xp(uuid, bigint, text, uuid, text, text) from authenticated;
grant execute on function public.grant_user_xp(uuid, bigint, text, uuid, text, text) to service_role;

-- Direct writes to challenge lifecycle tables are now server-owned.
-- Authenticated clients use the audited RPCs below instead.
revoke insert, update, delete on table public.challenges from authenticated;
revoke insert, update, delete on table public.challenge_participants from authenticated;

create or replace function public.create_direct_challenge(
  p_recipient_id uuid,
  p_exercise_id text,
  p_exercise_name text,
  p_reps integer,
  p_dice_level text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_challenge_id uuid;
  v_participant_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if p_recipient_id is null or p_recipient_id = v_actor then
    raise exception 'invalid recipient';
  end if;

  if not public.are_gymbros(v_actor, p_recipient_id) then
    raise exception 'recipient must be an accepted Gymbro';
  end if;

  if p_reps is null or p_reps < 1 or p_reps > 1000 then
    raise exception 'invalid repetitions';
  end if;

  if p_dice_level not in ('amateur', 'beginner', 'intermediate', 'advanced') then
    raise exception 'invalid dice level';
  end if;

  if nullif(btrim(p_exercise_id), '') is null or nullif(btrim(p_exercise_name), '') is null then
    raise exception 'exercise is required';
  end if;

  insert into public.challenges (
    creator_kind,
    creator_user_id,
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
    max_participants,
    metadata
  ) values (
    'user',
    v_actor,
    'direct',
    'active',
    left(btrim(p_exercise_name), 160),
    'Reto directo entre Gymbros',
    left(btrim(p_exercise_id), 160),
    left(btrim(p_exercise_name), 160),
    p_reps,
    p_dice_level,
    now(),
    now() + interval '48 hours',
    true,
    25,
    50,
    0,
    0,
    1,
    jsonb_build_object('reward_policy', 'v10-direct-1v1', 'source', 'dice-roll')
  )
  returning id into v_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, status)
  values (v_challenge_id, p_recipient_id, 'invited')
  returning id into v_participant_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    p_recipient_id,
    'challenge_invited',
    'Nuevo reto de un Gymbro',
    format('%s repeticiones de %s', p_reps, left(btrim(p_exercise_name), 160)),
    jsonb_build_object('challenge_id', v_challenge_id, 'participant_id', v_participant_id)
  );

  return v_challenge_id;
end;
$$;

revoke all on function public.create_direct_challenge(uuid, text, text, integer, text) from public;
grant execute on function public.create_direct_challenge(uuid, text, text, integer, text) to authenticated;

create or replace function public.respond_direct_challenge(
  p_participant_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_next_status text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_participant
  from public.challenge_participants
  where id = p_participant_id
  for update;

  if not found or v_participant.user_id <> v_actor then
    raise exception 'challenge participant not found';
  end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'direct' then
    raise exception 'not a direct challenge';
  end if;

  if v_participant.status <> 'invited' then
    return v_participant.status;
  end if;

  if v_challenge.expires_at is not null and v_challenge.expires_at <= now() then
    update public.challenge_participants
    set status = 'expired'
    where id = p_participant_id;

    update public.challenges
    set status = 'expired'
    where id = v_challenge.id;

    return 'expired';
  end if;

  v_next_status := case when p_accept then 'accepted' else 'declined' end;

  update public.challenge_participants
  set
    status = v_next_status,
    accepted_at = case when p_accept then now() else accepted_at end
  where id = p_participant_id;

  if not p_accept then
    update public.challenges set status = 'cancelled' where id = v_challenge.id;
  end if;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_challenge.creator_user_id,
    case when p_accept then 'challenge_accepted' else 'challenge_declined' end,
    case when p_accept then 'Tu reto fue aceptado' else 'Tu reto fue rechazado' end,
    format('%s repeticiones de %s', v_challenge.reps, v_challenge.exercise_name),
    jsonb_build_object('challenge_id', v_challenge.id, 'participant_id', p_participant_id)
  );

  return v_next_status;
end;
$$;

revoke all on function public.respond_direct_challenge(uuid, boolean) from public;
grant execute on function public.respond_direct_challenge(uuid, boolean) to authenticated;

create or replace function public.can_manage_challenge_evidence(p_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenge_participants cp
    join public.challenges c on c.id = cp.challenge_id
    where cp.id = p_participant_id
      and cp.user_id = auth.uid()
      and cp.status in ('accepted', 'rejected')
      and c.status = 'active'
      and (c.expires_at is null or c.expires_at > now())
  );
$$;

revoke all on function public.can_manage_challenge_evidence(uuid) from public;
grant execute on function public.can_manage_challenge_evidence(uuid) to authenticated;

-- Evidence can only be added/removed while preparing a submission.
drop policy if exists challenge_evidence_create_own on public.challenge_evidence;
drop policy if exists challenge_evidence_delete_own on public.challenge_evidence;

create policy challenge_evidence_create_own_v10
on public.challenge_evidence for insert
to authenticated
with check (
  public.can_manage_challenge_evidence(participant_id)
);

create policy challenge_evidence_delete_own_v10
on public.challenge_evidence for delete
to authenticated
using (
  public.can_manage_challenge_evidence(participant_id)
);

create or replace function public.challenge_participant_id_from_storage_name(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  v_part text;
begin
  v_part := split_part(p_name, '/', 2);
  if v_part is null or v_part = '' then
    return null;
  end if;
  return v_part::uuid;
exception when others then
  return null;
end;
$$;

-- Tighten the private evidence bucket. File paths are:
--   <user_id>/<participant_id>/<generated-file-name>
drop policy if exists challenge_evidence_insert_own_folder on storage.objects;
drop policy if exists challenge_evidence_delete_own_folder on storage.objects;

create policy challenge_evidence_insert_participant_v10
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'challenge-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.can_manage_challenge_evidence(public.challenge_participant_id_from_storage_name(name))
);

create policy challenge_evidence_delete_participant_v10
on storage.objects for delete
to authenticated
using (
  bucket_id = 'challenge-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.can_manage_challenge_evidence(public.challenge_participant_id_from_storage_name(name))
);

create policy challenge_evidence_read_creator_v10
on storage.objects for select
to authenticated
using (
  bucket_id = 'challenge-evidence'
  and public.can_access_challenge_participant(
    public.challenge_participant_id_from_storage_name(name)
  )
);

create or replace function public.submit_direct_challenge(p_participant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_latest_evidence timestamptz;
  v_latest_rejection timestamptz;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_participant
  from public.challenge_participants
  where id = p_participant_id
  for update;

  if not found or v_participant.user_id <> v_actor then
    raise exception 'challenge participant not found';
  end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'direct' or v_challenge.status <> 'active' then
    raise exception 'challenge is not active';
  end if;

  if v_participant.status not in ('accepted', 'rejected') then
    raise exception 'challenge cannot be submitted from status %', v_participant.status;
  end if;

  if v_challenge.expires_at is not null and v_challenge.expires_at <= now() then
    update public.challenge_participants set status = 'expired' where id = p_participant_id;
    update public.challenges set status = 'expired' where id = v_challenge.id;
    return 'expired';
  end if;

  select max(created_at) into v_latest_evidence
  from public.challenge_evidence
  where participant_id = p_participant_id;

  if v_latest_evidence is null then
    raise exception 'at least one evidence file is required';
  end if;

  select max(created_at) into v_latest_rejection
  from public.challenge_reviews
  where participant_id = p_participant_id
    and decision = 'rejected';

  if v_latest_rejection is not null and v_latest_evidence <= v_latest_rejection then
    raise exception 'new evidence is required after a rejection';
  end if;

  update public.challenge_participants
  set status = 'submitted', submitted_at = now()
  where id = p_participant_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_challenge.creator_user_id,
    'challenge_submitted',
    'Tu Gymbro envió evidencia',
    format('%s repeticiones de %s', v_challenge.reps, v_challenge.exercise_name),
    jsonb_build_object('challenge_id', v_challenge.id, 'participant_id', p_participant_id)
  );

  return 'submitted';
end;
$$;

revoke all on function public.submit_direct_challenge(uuid) from public;
grant execute on function public.submit_direct_challenge(uuid) to authenticated;

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

  -- Idempotent approval: once rewarded, repeated calls return the recorded result.
  if v_participant.status = 'approved' then
    return jsonb_build_object(
      'status', 'approved',
      'already_rewarded', true,
      'coins_granted', v_participant.reward_coins_granted,
      'xp_granted', v_participant.reward_xp_granted,
      'rewarded_at', v_participant.rewarded_at
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
      'coins_granted', 0,
      'xp_granted', 0
    );
  end if;

  -- The reward policy is fixed by the trusted creation RPC; the client cannot choose it.
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
    reward_xp_granted = v_reward_xp
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
      'level', v_level
    )
  );

  return jsonb_build_object(
    'status', 'approved',
    'already_rewarded', false,
    'coins_granted', v_coins,
    'xp_granted', v_reward_xp,
    'new_balance', v_balance,
    'new_xp', v_xp,
    'new_level', v_level
  );
end;
$$;

revoke all on function public.review_direct_challenge(uuid, text, text) from public;
grant execute on function public.review_direct_challenge(uuid, text, text) to authenticated;

-- Health endpoint now exposes the current functional milestone.
create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v10.0-direct-challenges',
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
