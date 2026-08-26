-- DadoFit V12.1 - Gym vs Gym
-- Organization-level battles for organizations of type "gym".
-- Roster is frozen on acceptance, opposing managers review evidence,
-- and approved contributions award personal rewards + Sponsor Points.

alter table public.challenge_participants
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists challenge_participants_organization_idx
  on public.challenge_participants (organization_id, status, updated_at desc);

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
      'gym_daily_limit'
    )
  );

create table if not exists public.organization_battles (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references public.challenges(id) on delete cascade,
  challenger_organization_id uuid not null references public.organizations(id) on delete cascade,
  challenged_organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  accepted_by_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'active', 'completed', 'declined', 'expired', 'cancelled')),
  response_expires_at timestamptz not null default (now() + interval '24 hours'),
  starts_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  winner_organization_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_battles_different_organizations check (challenger_organization_id <> challenged_organization_id)
);

create index if not exists organization_battles_challenger_idx
  on public.organization_battles (challenger_organization_id, status, created_at desc);
create index if not exists organization_battles_challenged_idx
  on public.organization_battles (challenged_organization_id, status, created_at desc);
create index if not exists organization_battles_pair_recent_idx
  on public.organization_battles (challenger_organization_id, challenged_organization_id, created_at desc);

drop trigger if exists organization_battles_set_updated_at on public.organization_battles;
create trigger organization_battles_set_updated_at
before update on public.organization_battles
for each row execute function public.set_updated_at();

alter table public.organization_battles enable row level security;
revoke all privileges on table public.organization_battles from anon, authenticated;
grant select on table public.organization_battles to authenticated;

create or replace function public.can_access_organization_battle(p_battle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_battles ob
    where ob.id = p_battle_id
      and (
        public.is_organization_member(ob.challenger_organization_id)
        or public.is_organization_member(ob.challenged_organization_id)
      )
  );
$$;

create or replace function public.can_access_organization_battle_challenge(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_battles ob
    where ob.challenge_id = p_challenge_id
      and (
        public.is_organization_member(ob.challenger_organization_id)
        or public.is_organization_member(ob.challenged_organization_id)
      )
  );
$$;

revoke all on function public.can_access_organization_battle(uuid) from public;
revoke all on function public.can_access_organization_battle_challenge(uuid) from public;
grant execute on function public.can_access_organization_battle(uuid) to authenticated;
grant execute on function public.can_access_organization_battle_challenge(uuid) to authenticated;

create policy organization_battles_read_related_v121
on public.organization_battles for select
to authenticated
using (
  public.is_organization_member(challenger_organization_id)
  or public.is_organization_member(challenged_organization_id)
);

create policy challenges_read_organization_battle_v121
on public.challenges for select
to authenticated
using (public.can_access_organization_battle_challenge(id));

create policy challenge_participants_read_organization_battle_v121
on public.challenge_participants for select
to authenticated
using (public.can_access_organization_battle_challenge(challenge_id));

-- Extend evidence visibility so opposing Gym managers can inspect submissions.
create or replace function public.can_access_challenge_participant(p_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenge_participants cp
    where cp.id = p_participant_id
      and (
        cp.user_id = auth.uid()
        or public.is_challenge_creator(cp.challenge_id)
        or public.can_access_group_battle_challenge(cp.challenge_id)
        or public.can_access_organization_battle_challenge(cp.challenge_id)
      )
  );
$$;

revoke all on function public.can_access_challenge_participant(uuid) from public;
grant execute on function public.can_access_challenge_participant(uuid) to authenticated;

create or replace function public.create_organization_battle(
  p_challenger_organization_id uuid,
  p_challenged_organization_id uuid,
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
  v_battle_id uuid;
  v_challenger_name text;
  v_challenged_name text;
  v_challenger_type text;
  v_challenged_type text;
  v_challenger_count integer;
  v_challenged_count integer;
  v_manager record;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if p_challenger_organization_id is null
     or p_challenged_organization_id is null
     or p_challenger_organization_id = p_challenged_organization_id then
    raise exception 'invalid gyms';
  end if;

  if not public.is_organization_manager(p_challenger_organization_id) then
    raise exception 'only an owner, admin or coach can challenge another Gym';
  end if;

  select name, organization_type
    into v_challenger_name, v_challenger_type
  from public.organizations
  where id = p_challenger_organization_id;

  select name, organization_type
    into v_challenged_name, v_challenged_type
  from public.organizations
  where id = p_challenged_organization_id;

  if v_challenger_type <> 'gym' or v_challenged_type <> 'gym' then
    raise exception 'Gym vs Gym only supports organizations of type gym';
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

  if exists (
    select 1
    from public.organization_members a
    join public.organization_members b on b.user_id = a.user_id
    where a.organization_id = p_challenger_organization_id
      and b.organization_id = p_challenged_organization_id
      and a.status = 'active'
      and b.status = 'active'
  ) then
    raise exception 'these Gyms share active members and cannot battle each other';
  end if;

  select count(*)::integer into v_challenger_count
  from public.organization_members
  where organization_id = p_challenger_organization_id and status = 'active';

  select count(*)::integer into v_challenged_count
  from public.organization_members
  where organization_id = p_challenged_organization_id and status = 'active';

  if v_challenger_count = 0 or v_challenged_count = 0 then
    raise exception 'both Gyms need at least one active member';
  end if;

  if exists (
    select 1
    from public.organization_battles ob
    where ob.status in ('pending', 'active')
      and (
        (ob.challenger_organization_id = p_challenger_organization_id and ob.challenged_organization_id = p_challenged_organization_id)
        or
        (ob.challenger_organization_id = p_challenged_organization_id and ob.challenged_organization_id = p_challenger_organization_id)
      )
  ) then
    raise exception 'there is already a pending or active battle between these Gyms';
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
    max_participants,
    metadata
  ) values (
    'organization',
    p_challenger_organization_id,
    'organization',
    'draft',
    left(btrim(p_exercise_name), 160),
    format('%s vs %s', v_challenger_name, v_challenged_name),
    left(btrim(p_exercise_id), 160),
    left(btrim(p_exercise_name), 160),
    p_reps,
    p_dice_level,
    now(),
    null,
    true,
    25,
    50,
    0,
    100,
    v_challenger_count + v_challenged_count,
    jsonb_build_object(
      'reward_policy', 'v12.1-gym-battle',
      'source', 'dice-roll',
      'challenged_organization_id', p_challenged_organization_id,
      'published_by_user_id', v_actor
    )
  )
  returning id into v_challenge_id;

  insert into public.organization_battles (
    challenge_id,
    challenger_organization_id,
    challenged_organization_id,
    created_by_user_id,
    status,
    response_expires_at
  ) values (
    v_challenge_id,
    p_challenger_organization_id,
    p_challenged_organization_id,
    v_actor,
    'pending',
    now() + interval '24 hours'
  )
  returning id into v_battle_id;

  for v_manager in
    select om.user_id
    from public.organization_members om
    where om.organization_id = p_challenged_organization_id
      and om.status = 'active'
      and om.role in ('owner', 'admin', 'coach')
  loop
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_manager.user_id,
      'gym_battle_invited',
      'Tu Gym fue retado',
      format('%s reta a %s: %s repeticiones de %s', v_challenger_name, v_challenged_name, p_reps, left(btrim(p_exercise_name), 160)),
      jsonb_build_object(
        'organization_battle_id', v_battle_id,
        'challenge_id', v_challenge_id,
        'challenger_organization_id', p_challenger_organization_id,
        'challenged_organization_id', p_challenged_organization_id
      )
    );
  end loop;

  return v_battle_id;
end;
$$;

revoke all on function public.create_organization_battle(uuid, uuid, text, text, integer, text) from public;
grant execute on function public.create_organization_battle(uuid, uuid, text, text, integer, text) to authenticated;

create or replace function public.respond_organization_battle(
  p_battle_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_battle public.organization_battles%rowtype;
  v_challenge public.challenges%rowtype;
  v_challenger_name text;
  v_challenged_name text;
  v_challenger_count integer;
  v_challenged_count integer;
  v_expires_at timestamptz;
  v_manager record;
  v_participant record;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_battle
  from public.organization_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Gym battle not found';
  end if;

  if not public.is_organization_manager(v_battle.challenged_organization_id) then
    raise exception 'only a manager of the challenged Gym can respond';
  end if;

  if v_battle.status <> 'pending' then
    return v_battle.status;
  end if;

  select * into v_challenge from public.challenges where id = v_battle.challenge_id for update;
  select name into v_challenger_name from public.organizations where id = v_battle.challenger_organization_id;
  select name into v_challenged_name from public.organizations where id = v_battle.challenged_organization_id;

  if v_battle.response_expires_at <= now() then
    update public.organization_battles set status = 'expired' where id = p_battle_id;
    update public.challenges set status = 'expired' where id = v_battle.challenge_id;
    return 'expired';
  end if;

  if not p_accept then
    update public.organization_battles
    set status = 'declined', accepted_by_user_id = v_actor
    where id = p_battle_id;
    update public.challenges set status = 'cancelled' where id = v_battle.challenge_id;

    for v_manager in
      select om.user_id
      from public.organization_members om
      where om.organization_id = v_battle.challenger_organization_id
        and om.status = 'active'
        and om.role in ('owner', 'admin', 'coach')
    loop
      insert into public.notifications (user_id, notification_type, title, body, data)
      values (
        v_manager.user_id,
        'gym_battle_declined',
        'Batalla Gym rechazada',
        format('%s rechazó el reto de %s', v_challenged_name, v_challenger_name),
        jsonb_build_object('organization_battle_id', p_battle_id, 'challenge_id', v_battle.challenge_id)
      );
    end loop;
    return 'declined';
  end if;

  if exists (
    select 1
    from public.organization_members a
    join public.organization_members b on b.user_id = a.user_id
    where a.organization_id = v_battle.challenger_organization_id
      and b.organization_id = v_battle.challenged_organization_id
      and a.status = 'active'
      and b.status = 'active'
  ) then
    raise exception 'these Gyms now share active members and cannot battle each other';
  end if;

  select count(*)::integer into v_challenger_count
  from public.organization_members
  where organization_id = v_battle.challenger_organization_id and status = 'active';
  select count(*)::integer into v_challenged_count
  from public.organization_members
  where organization_id = v_battle.challenged_organization_id and status = 'active';

  if v_challenger_count = 0 or v_challenged_count = 0 then
    raise exception 'both Gyms need at least one active member';
  end if;

  v_expires_at := now() + interval '72 hours';

  update public.organization_battles
  set status = 'active',
      accepted_by_user_id = v_actor,
      starts_at = now(),
      expires_at = v_expires_at
  where id = p_battle_id;

  update public.challenges
  set status = 'active',
      starts_at = now(),
      expires_at = v_expires_at,
      max_participants = v_challenger_count + v_challenged_count
  where id = v_battle.challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, organization_id, status, accepted_at)
  select v_battle.challenge_id, om.user_id, om.organization_id, 'accepted', now()
  from public.organization_members om
  where om.status = 'active'
    and om.organization_id in (v_battle.challenger_organization_id, v_battle.challenged_organization_id);

  for v_participant in
    select cp.id, cp.user_id, cp.organization_id
    from public.challenge_participants cp
    where cp.challenge_id = v_battle.challenge_id
  loop
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'gym_battle_started',
      '¡Gym vs Gym comenzó!',
      format('%s vs %s · %s repeticiones de %s', v_challenger_name, v_challenged_name, v_challenge.reps, v_challenge.exercise_name),
      jsonb_build_object(
        'organization_battle_id', p_battle_id,
        'challenge_id', v_battle.challenge_id,
        'participant_id', v_participant.id,
        'organization_id', v_participant.organization_id
      )
    );
  end loop;

  return 'active';
end;
$$;

revoke all on function public.respond_organization_battle(uuid, boolean) from public;
grant execute on function public.respond_organization_battle(uuid, boolean) to authenticated;

create or replace function public.maybe_complete_organization_battle(p_battle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle public.organization_battles%rowtype;
  v_challenger_points bigint := 0;
  v_challenged_points bigint := 0;
  v_winner uuid := null;
  v_challenger_name text;
  v_challenged_name text;
  v_user record;
begin
  select * into v_battle
  from public.organization_battles
  where id = p_battle_id
  for update;

  if not found or v_battle.status <> 'active' then
    return;
  end if;

  if exists (
    select 1
    from public.challenge_participants cp
    where cp.challenge_id = v_battle.challenge_id
      and cp.status not in ('approved', 'declined', 'expired')
  ) then
    return;
  end if;

  select coalesce(sum(cp.sponsor_points_granted), 0)
    into v_challenger_points
  from public.challenge_participants cp
  where cp.challenge_id = v_battle.challenge_id
    and cp.organization_id = v_battle.challenger_organization_id;

  select coalesce(sum(cp.sponsor_points_granted), 0)
    into v_challenged_points
  from public.challenge_participants cp
  where cp.challenge_id = v_battle.challenge_id
    and cp.organization_id = v_battle.challenged_organization_id;

  if v_challenger_points > v_challenged_points then
    v_winner := v_battle.challenger_organization_id;
  elsif v_challenged_points > v_challenger_points then
    v_winner := v_battle.challenged_organization_id;
  end if;

  update public.organization_battles
  set status = 'completed',
      completed_at = now(),
      winner_organization_id = v_winner
  where id = p_battle_id;

  update public.challenges
  set status = 'completed'
  where id = v_battle.challenge_id;

  select name into v_challenger_name from public.organizations where id = v_battle.challenger_organization_id;
  select name into v_challenged_name from public.organizations where id = v_battle.challenged_organization_id;

  for v_user in
    select distinct cp.user_id
    from public.challenge_participants cp
    where cp.challenge_id = v_battle.challenge_id
  loop
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_user.user_id,
      'gym_battle_completed',
      'Batalla Gym finalizada',
      case
        when v_winner is null then format('Empate: %s %s SP · %s %s SP', v_challenger_name, v_challenger_points, v_challenged_name, v_challenged_points)
        when v_winner = v_battle.challenger_organization_id then format('%s gana %s SP a %s SP', v_challenger_name, v_challenger_points, v_challenged_points)
        else format('%s gana %s SP a %s SP', v_challenged_name, v_challenged_points, v_challenger_points)
      end,
      jsonb_build_object(
        'organization_battle_id', p_battle_id,
        'challenge_id', v_battle.challenge_id,
        'winner_organization_id', v_winner,
        'challenger_points', v_challenger_points,
        'challenged_points', v_challenged_points
      )
    );
  end loop;
end;
$$;

revoke all on function public.maybe_complete_organization_battle(uuid) from public;
revoke all on function public.maybe_complete_organization_battle(uuid) from authenticated;
grant execute on function public.maybe_complete_organization_battle(uuid) to service_role;

create or replace function public.decline_organization_battle_participation(p_participant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_battle_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_participant
  from public.challenge_participants
  where id = p_participant_id
  for update;

  if not found or v_participant.user_id <> v_actor then
    raise exception 'Gym battle participant not found';
  end if;

  select ob.id into v_battle_id
  from public.organization_battles ob
  join public.challenges c on c.id = ob.challenge_id
  where ob.challenge_id = v_participant.challenge_id
    and ob.status = 'active'
    and c.metadata ->> 'reward_policy' = 'v12.1-gym-battle';

  if v_battle_id is null then
    raise exception 'Gym battle is not active';
  end if;

  if v_participant.status not in ('accepted', 'rejected') then
    return v_participant.status;
  end if;

  update public.challenge_participants
  set status = 'declined'
  where id = p_participant_id;

  perform public.maybe_complete_organization_battle(v_battle_id);
  return 'declined';
end;
$$;

revoke all on function public.decline_organization_battle_participation(uuid) from public;
grant execute on function public.decline_organization_battle_participation(uuid) to authenticated;

create or replace function public.submit_organization_battle(p_participant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_battle public.organization_battles%rowtype;
  v_latest_evidence timestamptz;
  v_latest_rejection timestamptz;
  v_review_organization_id uuid;
  v_manager record;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_participant
  from public.challenge_participants
  where id = p_participant_id
  for update;

  if not found or v_participant.user_id <> v_actor then
    raise exception 'Gym battle participant not found';
  end if;

  select * into v_challenge from public.challenges where id = v_participant.challenge_id;
  select * into v_battle from public.organization_battles where challenge_id = v_participant.challenge_id;

  if v_challenge.metadata ->> 'reward_policy' <> 'v12.1-gym-battle'
     or v_challenge.status <> 'active'
     or v_battle.status <> 'active' then
    raise exception 'Gym battle is not active';
  end if;

  if v_participant.status not in ('accepted', 'rejected') then
    raise exception 'battle cannot be submitted from status %', v_participant.status;
  end if;

  if v_battle.expires_at is not null and v_battle.expires_at <= now() then
    update public.challenge_participants set status = 'expired' where id = p_participant_id;
    perform public.maybe_complete_organization_battle(v_battle.id);
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

  v_review_organization_id := case
    when v_participant.organization_id = v_battle.challenger_organization_id then v_battle.challenged_organization_id
    else v_battle.challenger_organization_id
  end;

  for v_manager in
    select om.user_id
    from public.organization_members om
    where om.organization_id = v_review_organization_id
      and om.status = 'active'
      and om.role in ('owner', 'admin', 'coach')
      and om.user_id <> v_actor
  loop
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_manager.user_id,
      'gym_battle_submitted',
      'Evidencia rival por revisar',
      format('%s repeticiones de %s', v_challenge.reps, v_challenge.exercise_name),
      jsonb_build_object(
        'organization_battle_id', v_battle.id,
        'challenge_id', v_challenge.id,
        'participant_id', p_participant_id,
        'organization_id', v_participant.organization_id
      )
    );
  end loop;

  return 'submitted';
end;
$$;

revoke all on function public.submit_organization_battle(uuid) from public;
grant execute on function public.submit_organization_battle(uuid) to authenticated;

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

  select new_balance into v_balance
  from public.grant_wallet_coins(
    v_participant.user_id,
    v_coins,
    'gym_battle_reward',
    v_challenge.id,
    format('Gym vs Gym completado: %s', v_challenge.exercise_name),
    format('gym-battle:%s:coins', p_participant_id)
  );

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
      reward_coins_granted = v_coins,
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

revoke all on function public.review_organization_battle(uuid, text, text) from public;
grant execute on function public.review_organization_battle(uuid, text, text) to authenticated;

create or replace function public.finalize_organization_battle(p_battle_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle public.organization_battles%rowtype;
begin
  select * into v_battle
  from public.organization_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Gym battle not found';
  end if;

  if not (
    public.is_organization_manager(v_battle.challenger_organization_id)
    or public.is_organization_manager(v_battle.challenged_organization_id)
  ) then
    raise exception 'only Gym managers can finalize this battle';
  end if;

  if v_battle.status = 'pending' and v_battle.response_expires_at <= now() then
    update public.organization_battles set status = 'expired' where id = p_battle_id;
    update public.challenges set status = 'expired' where id = v_battle.challenge_id;
    return 'expired';
  end if;

  if v_battle.status = 'active' then
    if v_battle.expires_at is not null and v_battle.expires_at <= now() then
      update public.challenge_participants
      set status = 'expired'
      where challenge_id = v_battle.challenge_id
        and status in ('accepted', 'rejected');
    end if;

    perform public.maybe_complete_organization_battle(p_battle_id);
  end if;

  select * into v_battle from public.organization_battles where id = p_battle_id;
  return v_battle.status;
end;
$$;

revoke all on function public.finalize_organization_battle(uuid) from public;
grant execute on function public.finalize_organization_battle(uuid) to authenticated;

-- Dashboard: separate regular organization challenges from Gym vs Gym battles.
create or replace function public.get_dadofit_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_xp bigint := 0;
  v_level integer := 1;
  v_challenges_completed integer := 0;
  v_coins bigint := 0;
  v_squad_contribution_points bigint := 0;
  v_organization_contribution_points bigint := 0;
  v_direct_pending integer := 0;
  v_squad_pending integer := 0;
  v_organization_pending integer := 0;
  v_gym_battle_pending integer := 0;
  v_unread_notifications integer := 0;
  v_active_squads integer := 0;
  v_active_organizations integer := 0;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select coalesce(up.xp, 0), coalesce(up.level, 1), coalesce(up.challenges_completed, 0)
    into v_xp, v_level, v_challenges_completed
  from public.user_progress up
  where up.user_id = v_actor;

  select coalesce(w.balance, 0) into v_coins
  from public.wallets w where w.user_id = v_actor;

  select coalesce(sum(se.team_points), 0)
    into v_squad_contribution_points
  from public.score_events se
  join public.challenge_participants cp on cp.id = se.participant_id
  where cp.user_id = v_actor;

  select coalesce(sum(se.sponsor_points), 0)
    into v_organization_contribution_points
  from public.score_events se
  join public.challenge_participants cp on cp.id = se.participant_id
  where cp.user_id = v_actor;

  select count(*)::integer into v_direct_pending
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where cp.user_id = v_actor
    and c.challenge_type = 'direct'
    and c.status = 'active'
    and cp.status in ('invited', 'accepted', 'submitted', 'rejected');

  select count(distinct gb.id)::integer into v_squad_pending
  from public.group_battles gb
  join public.group_members gm on gm.group_id in (gb.challenger_group_id, gb.challenged_group_id)
  where gm.user_id = v_actor
    and gm.status = 'active'
    and gb.status in ('pending', 'active');

  select count(*)::integer into v_organization_pending
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where cp.user_id = v_actor
    and c.challenge_type = 'organization'
    and c.status = 'active'
    and c.metadata ->> 'reward_policy' = 'v12-organization-member'
    and cp.status in ('invited', 'accepted', 'submitted', 'rejected');

  select count(distinct ob.id)::integer into v_gym_battle_pending
  from public.organization_battles ob
  join public.organization_members om
    on om.organization_id in (ob.challenger_organization_id, ob.challenged_organization_id)
  where om.user_id = v_actor
    and om.status = 'active'
    and ob.status in ('pending', 'active');

  select count(*)::integer into v_unread_notifications
  from public.notifications n
  where n.user_id = v_actor and n.read_at is null;

  select count(*)::integer into v_active_squads
  from public.group_members gm
  where gm.user_id = v_actor and gm.status = 'active';

  select count(*)::integer into v_active_organizations
  from public.organization_members om
  where om.user_id = v_actor and om.status = 'active';

  return jsonb_build_object(
    'xp', v_xp,
    'level', v_level,
    'coins', v_coins,
    'challenges_completed', v_challenges_completed,
    'squad_contribution_points', v_squad_contribution_points,
    'organization_contribution_points', v_organization_contribution_points,
    'direct_pending', v_direct_pending,
    'squad_pending', v_squad_pending,
    'organization_pending', v_organization_pending,
    'gym_battle_pending', v_gym_battle_pending,
    'unread_notifications', v_unread_notifications,
    'active_squads', v_active_squads,
    'active_organizations', v_active_organizations
  );
end;
$$;

revoke all on function public.get_dadofit_dashboard_summary() from public;
revoke all on function public.get_dadofit_dashboard_summary() from anon;
grant execute on function public.get_dadofit_dashboard_summary() to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v12.1-gym-vs-gym',
    'direct_pair_cooldown_hours', 24,
    'direct_daily_limit', 5,
    'squad_pair_cooldown_hours', 24,
    'squad_daily_limit', 5,
    'organization_pair_cooldown_hours', 24,
    'organization_daily_limit', 5,
    'gym_pair_cooldown_hours', 24,
    'gym_daily_limit', 5,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
