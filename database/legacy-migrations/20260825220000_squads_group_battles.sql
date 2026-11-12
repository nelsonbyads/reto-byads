-- DadoFit V11 - Squads + Group vs Group
-- Secure squad membership, group battles, evidence review, single-use rewards and Team Points.

create table if not exists public.group_battles (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references public.challenges(id) on delete cascade,
  challenger_group_id uuid not null references public.groups(id) on delete cascade,
  challenged_group_id uuid not null references public.groups(id) on delete cascade,
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  accepted_by_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'active', 'completed', 'declined', 'expired', 'cancelled')),
  response_expires_at timestamptz not null default (now() + interval '24 hours'),
  starts_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  winner_group_id uuid references public.groups(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_battles_different_groups check (challenger_group_id <> challenged_group_id)
);

create index if not exists group_battles_challenger_idx
  on public.group_battles (challenger_group_id, status, created_at desc);
create index if not exists group_battles_challenged_idx
  on public.group_battles (challenged_group_id, status, created_at desc);

create trigger group_battles_set_updated_at
before update on public.group_battles
for each row execute function public.set_updated_at();

alter table public.group_battles enable row level security;
revoke all privileges on table public.group_battles from anon, authenticated;
grant select on table public.group_battles to authenticated;

-- From V11 onward, squad writes are server-owned so membership and ownership
-- cannot be bypassed from the browser.
revoke insert, update, delete on table public.groups from authenticated;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.status = 'active'
      and gm.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_group_invited(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.status = 'invited'
  );
$$;

create or replace function public.can_access_group_battle(p_battle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_battles gb
    where gb.id = p_battle_id
      and (
        public.is_group_member(gb.challenger_group_id)
        or public.is_group_member(gb.challenged_group_id)
      )
  );
$$;

create or replace function public.can_access_group_battle_challenge(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_battles gb
    where gb.challenge_id = p_challenge_id
      and (
        public.is_group_member(gb.challenger_group_id)
        or public.is_group_member(gb.challenged_group_id)
      )
  );
$$;

revoke all on function public.is_group_admin(uuid) from public;
revoke all on function public.is_group_invited(uuid) from public;
revoke all on function public.can_access_group_battle(uuid) from public;
revoke all on function public.can_access_group_battle_challenge(uuid) from public;
grant execute on function public.is_group_admin(uuid) to authenticated;
grant execute on function public.is_group_invited(uuid) to authenticated;
grant execute on function public.can_access_group_battle(uuid) to authenticated;
grant execute on function public.can_access_group_battle_challenge(uuid) to authenticated;

create policy group_battles_read_related_v11
on public.group_battles for select
to authenticated
using (
  public.is_group_member(challenger_group_id)
  or public.is_group_member(challenged_group_id)
);

-- A private squad invitation must still reveal the squad card to the invited user.
create policy groups_read_invited_v11
on public.groups for select
to authenticated
using (public.is_group_invited(id));

-- Group battle members can read the battle challenge and all participants.
create policy challenges_read_group_battle_v11
on public.challenges for select
to authenticated
using (public.can_access_group_battle_challenge(id));

create policy challenge_participants_read_group_battle_v11
on public.challenge_participants for select
to authenticated
using (public.can_access_group_battle_challenge(challenge_id));

-- Extend evidence access so members in the same battle can inspect evidence.
-- Only an opposing captain/admin can approve or reject through the RPC below.
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
      )
  );
$$;

revoke all on function public.can_access_challenge_participant(uuid) from public;
grant execute on function public.can_access_challenge_participant(uuid) to authenticated;

create or replace function public.create_squad(
  p_name text,
  p_visibility text default 'public'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_group_id uuid;
  v_slug_base text;
  v_slug text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if length(btrim(coalesce(p_name, ''))) < 3 or length(btrim(p_name)) > 60 then
    raise exception 'squad name must have between 3 and 60 characters';
  end if;

  if p_visibility not in ('private', 'public') then
    raise exception 'invalid visibility';
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then
    v_slug_base := 'squad';
  end if;
  v_slug := left(v_slug_base, 48) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.groups (owner_user_id, name, slug, visibility)
  values (v_actor, left(btrim(p_name), 60), v_slug, p_visibility)
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role, status, joined_at)
  values (v_group_id, v_actor, 'owner', 'active', now());

  return v_group_id;
end;
$$;

revoke all on function public.create_squad(text, text) from public;
grant execute on function public.create_squad(text, text) to authenticated;

create or replace function public.invite_squad_member(
  p_group_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_existing_status text;
  v_group_name text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'only squad captains can invite members';
  end if;

  if p_user_id is null or p_user_id = v_actor then
    raise exception 'invalid member';
  end if;

  if not public.are_gymbros(v_actor, p_user_id) then
    raise exception 'you can only invite an accepted Gymbro';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'profile not found';
  end if;

  select status into v_existing_status
  from public.group_members
  where group_id = p_group_id and user_id = p_user_id;

  if v_existing_status = 'active' then
    return 'active';
  end if;

  if v_existing_status = 'invited' then
    return 'invited';
  end if;

  insert into public.group_members (group_id, user_id, role, status, joined_at)
  values (p_group_id, p_user_id, 'member', 'invited', now())
  on conflict (group_id, user_id) do update
  set role = 'member', status = 'invited', joined_at = now();

  select name into v_group_name from public.groups where id = p_group_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    p_user_id,
    'squad_invited',
    'Te invitaron a un Squad',
    coalesce(v_group_name, 'Nuevo Squad'),
    jsonb_build_object('group_id', p_group_id)
  );

  return 'invited';
end;
$$;

revoke all on function public.invite_squad_member(uuid, uuid) from public;
grant execute on function public.invite_squad_member(uuid, uuid) to authenticated;

create or replace function public.respond_squad_invite(
  p_group_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_group_name text;
  v_status text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select g.owner_user_id, g.name
    into v_owner, v_group_name
  from public.groups g
  join public.group_members gm on gm.group_id = g.id
  where g.id = p_group_id
    and gm.user_id = v_actor
    and gm.status = 'invited'
  for update of gm;

  if not found then
    raise exception 'squad invitation not found';
  end if;

  v_status := case when p_accept then 'active' else 'left' end;

  update public.group_members
  set status = v_status, joined_at = case when p_accept then now() else joined_at end
  where group_id = p_group_id and user_id = v_actor;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_owner,
    case when p_accept then 'squad_invite_accepted' else 'squad_invite_declined' end,
    case when p_accept then 'Aceptaron tu invitacion al Squad' else 'Rechazaron tu invitacion al Squad' end,
    v_group_name,
    jsonb_build_object('group_id', p_group_id, 'user_id', v_actor)
  );

  return v_status;
end;
$$;

revoke all on function public.respond_squad_invite(uuid, boolean) from public;
grant execute on function public.respond_squad_invite(uuid, boolean) to authenticated;

create or replace function public.leave_squad(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select role into v_role
  from public.group_members
  where group_id = p_group_id and user_id = v_actor and status = 'active'
  for update;

  if not found then
    raise exception 'active squad membership not found';
  end if;

  if v_role = 'owner' then
    raise exception 'the squad owner cannot leave the squad';
  end if;

  update public.group_members
  set status = 'left'
  where group_id = p_group_id and user_id = v_actor;

  return 'left';
end;
$$;

revoke all on function public.leave_squad(uuid) from public;
grant execute on function public.leave_squad(uuid) to authenticated;

create or replace function public.remove_squad_member(
  p_group_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_target_role text;
  v_actor_role text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'only squad captains can remove members';
  end if;

  select owner_user_id into v_owner from public.groups where id = p_group_id;
  if p_user_id = v_owner then
    raise exception 'the squad owner cannot be removed';
  end if;

  select role into v_actor_role
  from public.group_members
  where group_id = p_group_id and user_id = v_actor and status = 'active';

  select role into v_target_role
  from public.group_members
  where group_id = p_group_id and user_id = p_user_id and status in ('active', 'invited')
  for update;

  if not found then
    raise exception 'member not found';
  end if;

  if v_actor_role = 'admin' and v_target_role = 'admin' then
    raise exception 'only the owner can remove another admin';
  end if;

  update public.group_members
  set status = 'removed'
  where group_id = p_group_id and user_id = p_user_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    p_user_id,
    'squad_removed',
    'Ya no perteneces al Squad',
    null,
    jsonb_build_object('group_id', p_group_id)
  );

  return 'removed';
end;
$$;

revoke all on function public.remove_squad_member(uuid, uuid) from public;
grant execute on function public.remove_squad_member(uuid, uuid) to authenticated;

create or replace function public.create_group_challenge(
  p_challenger_group_id uuid,
  p_challenged_group_id uuid,
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
  v_challenger_count integer;
  v_challenged_count integer;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if p_challenger_group_id is null or p_challenged_group_id is null or p_challenger_group_id = p_challenged_group_id then
    raise exception 'invalid squads';
  end if;

  if not public.is_group_admin(p_challenger_group_id) then
    raise exception 'only a challenger squad captain can create a battle';
  end if;

  select name into v_challenger_name from public.groups where id = p_challenger_group_id;
  select name into v_challenged_name
  from public.groups
  where id = p_challenged_group_id and visibility = 'public';

  if v_challenged_name is null then
    raise exception 'challenged squad must be public';
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
    from public.group_members a
    join public.group_members b on b.user_id = a.user_id
    where a.group_id = p_challenger_group_id
      and b.group_id = p_challenged_group_id
      and a.status = 'active'
      and b.status = 'active'
  ) then
    raise exception 'squads with overlapping active members cannot battle each other';
  end if;

  if exists (
    select 1
    from public.group_battles gb
    where (gb.status = 'active' or (gb.status = 'pending' and gb.response_expires_at > now()))
      and (
        (gb.challenger_group_id = p_challenger_group_id and gb.challenged_group_id = p_challenged_group_id)
        or (gb.challenger_group_id = p_challenged_group_id and gb.challenged_group_id = p_challenger_group_id)
      )
  ) then
    raise exception 'there is already a pending or active battle between these squads';
  end if;

  select count(*) into v_challenger_count
  from public.group_members
  where group_id = p_challenger_group_id and status = 'active';

  select count(*) into v_challenged_count
  from public.group_members
  where group_id = p_challenged_group_id and status = 'active';

  if v_challenger_count < 1 or v_challenged_count < 1 then
    raise exception 'both squads need active members';
  end if;

  insert into public.challenges (
    creator_kind,
    creator_group_id,
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
    'group',
    p_challenger_group_id,
    'group',
    'draft',
    left(format('%s vs %s', v_challenger_name, v_challenged_name), 160),
    'Batalla entre Squads',
    left(btrim(p_exercise_id), 160),
    left(btrim(p_exercise_name), 160),
    p_reps,
    p_dice_level,
    now(),
    now() + interval '24 hours',
    true,
    25,
    50,
    100,
    0,
    v_challenger_count + v_challenged_count,
    jsonb_build_object('reward_policy', 'v11-squad-battle', 'source', 'dice-roll')
  )
  returning id into v_challenge_id;

  insert into public.group_battles (
    challenge_id,
    challenger_group_id,
    challenged_group_id,
    created_by_user_id,
    status,
    response_expires_at
  ) values (
    v_challenge_id,
    p_challenger_group_id,
    p_challenged_group_id,
    v_actor,
    'pending',
    now() + interval '24 hours'
  )
  returning id into v_battle_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  select
    gm.user_id,
    'squad_battle_invited',
    'Tu Squad fue retado',
    format('%s reto a %s: %s rep de %s', v_challenger_name, v_challenged_name, p_reps, left(btrim(p_exercise_name), 160)),
    jsonb_build_object('battle_id', v_battle_id, 'challenge_id', v_challenge_id)
  from public.group_members gm
  where gm.group_id = p_challenged_group_id
    and gm.status = 'active'
    and gm.role in ('owner', 'admin');

  return v_battle_id;
end;
$$;

revoke all on function public.create_group_challenge(uuid, uuid, text, text, integer, text) from public;
grant execute on function public.create_group_challenge(uuid, uuid, text, text, integer, text) to authenticated;

create or replace function public.respond_group_challenge(
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
  v_battle public.group_battles%rowtype;
  v_challenge public.challenges%rowtype;
  v_next_status text;
  v_member_count integer;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_battle
  from public.group_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'group battle not found';
  end if;

  if not public.is_group_admin(v_battle.challenged_group_id) then
    raise exception 'only the challenged squad captain can respond';
  end if;

  if v_battle.status <> 'pending' then
    return v_battle.status;
  end if;

  select * into v_challenge
  from public.challenges
  where id = v_battle.challenge_id
  for update;

  if v_battle.response_expires_at <= now() then
    update public.group_battles set status = 'expired' where id = p_battle_id;
    update public.challenges set status = 'expired' where id = v_battle.challenge_id;
    return 'expired';
  end if;

  if not p_accept then
    update public.group_battles
    set status = 'declined', accepted_by_user_id = v_actor
    where id = p_battle_id;

    update public.challenges set status = 'cancelled' where id = v_battle.challenge_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    select gm.user_id, 'squad_battle_declined', 'El reto entre Squads fue rechazado', v_challenge.exercise_name,
      jsonb_build_object('battle_id', p_battle_id, 'challenge_id', v_battle.challenge_id)
    from public.group_members gm
    where gm.group_id = v_battle.challenger_group_id
      and gm.status = 'active'
      and gm.role in ('owner', 'admin');

    return 'declined';
  end if;

  update public.group_battles
  set
    status = 'active',
    accepted_by_user_id = v_actor,
    starts_at = now(),
    expires_at = now() + interval '72 hours'
  where id = p_battle_id;

  select count(*) into v_member_count
  from public.group_members
  where group_id in (v_battle.challenger_group_id, v_battle.challenged_group_id)
    and status = 'active';

  update public.challenges
  set
    status = 'active',
    starts_at = now(),
    expires_at = now() + interval '72 hours',
    max_participants = v_member_count
  where id = v_battle.challenge_id;

  insert into public.challenge_participants (
    challenge_id,
    user_id,
    group_id,
    status,
    accepted_at
  )
  select
    v_battle.challenge_id,
    gm.user_id,
    gm.group_id,
    'accepted',
    now()
  from public.group_members gm
  where gm.group_id in (v_battle.challenger_group_id, v_battle.challenged_group_id)
    and gm.status = 'active'
  on conflict (challenge_id, user_id) do nothing;

  insert into public.notifications (user_id, notification_type, title, body, data)
  select
    cp.user_id,
    'squad_battle_started',
    'La batalla de Squads comenzo',
    format('%s repeticiones de %s', v_challenge.reps, v_challenge.exercise_name),
    jsonb_build_object('battle_id', p_battle_id, 'challenge_id', v_battle.challenge_id, 'participant_id', cp.id)
  from public.challenge_participants cp
  where cp.challenge_id = v_battle.challenge_id;

  v_next_status := 'active';
  return v_next_status;
end;
$$;

revoke all on function public.respond_group_challenge(uuid, boolean) from public;
grant execute on function public.respond_group_challenge(uuid, boolean) to authenticated;

create or replace function public.submit_group_challenge(p_participant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_battle public.group_battles%rowtype;
  v_latest_evidence timestamptz;
  v_latest_rejection timestamptz;
  v_opponent_group_id uuid;
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

  select * into v_challenge from public.challenges where id = v_participant.challenge_id;
  select * into v_battle from public.group_battles where challenge_id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'group'
     or v_challenge.metadata ->> 'reward_policy' <> 'v11-squad-battle'
     or v_battle.status <> 'active'
     or v_challenge.status <> 'active' then
    raise exception 'group battle is not active';
  end if;

  if v_participant.status not in ('accepted', 'rejected') then
    raise exception 'battle cannot be submitted from status %', v_participant.status;
  end if;

  if v_battle.expires_at is not null and v_battle.expires_at <= now() then
    update public.challenge_participants set status = 'expired' where id = p_participant_id;
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
  where participant_id = p_participant_id and decision = 'rejected';

  if v_latest_rejection is not null and v_latest_evidence <= v_latest_rejection then
    raise exception 'new evidence is required after a rejection';
  end if;

  update public.challenge_participants
  set status = 'submitted', submitted_at = now()
  where id = p_participant_id;

  v_opponent_group_id := case
    when v_participant.group_id = v_battle.challenger_group_id then v_battle.challenged_group_id
    else v_battle.challenger_group_id
  end;

  insert into public.notifications (user_id, notification_type, title, body, data)
  select
    gm.user_id,
    'squad_battle_evidence_submitted',
    'Hay evidencia rival para revisar',
    format('%s repeticiones de %s', v_challenge.reps, v_challenge.exercise_name),
    jsonb_build_object('battle_id', v_battle.id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id)
  from public.group_members gm
  where gm.group_id = v_opponent_group_id
    and gm.status = 'active'
    and gm.role in ('owner', 'admin');

  return 'submitted';
end;
$$;

revoke all on function public.submit_group_challenge(uuid) from public;
grant execute on function public.submit_group_challenge(uuid) to authenticated;

create or replace function public.decline_group_challenge_participation(p_participant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_battle_status text;
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

  select gb.status into v_battle_status
  from public.group_battles gb
  where gb.challenge_id = v_participant.challenge_id;

  if v_battle_status <> 'active' then
    raise exception 'group battle is not active';
  end if;

  if v_participant.status not in ('accepted', 'rejected') then
    raise exception 'participation cannot be declined from status %', v_participant.status;
  end if;

  update public.challenge_participants
  set status = 'declined'
  where id = p_participant_id;

  return 'declined';
end;
$$;

revoke all on function public.decline_group_challenge_participation(uuid) from public;
grant execute on function public.decline_group_challenge_participation(uuid) to authenticated;

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

  select * into v_challenge from public.challenges where id = v_participant.challenge_id;
  select * into v_battle from public.group_battles where challenge_id = v_participant.challenge_id;

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
      'already_rewarded', true,
      'coins_granted', v_participant.reward_coins_granted,
      'xp_granted', v_participant.reward_xp_granted,
      'team_points', v_challenge.team_points,
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
      'squad_battle_evidence_rejected',
      'Tu evidencia necesita otro intento',
      coalesce(nullif(btrim(p_notes), ''), 'Sube una nueva evidencia y vuelve a enviarla.'),
      jsonb_build_object('battle_id', v_battle.id, 'challenge_id', v_challenge.id, 'participant_id', p_participant_id)
    );

    return jsonb_build_object('status', 'rejected', 'already_rewarded', false, 'coins_granted', 0, 'xp_granted', 0, 'team_points', 0);
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
    reward_xp_granted = v_reward_xp
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
    'Aporte aprobado para tu Squad',
    format('+%s DadoCoins, +%s XP y +%s Team Points', v_coins, v_reward_xp, v_team_points),
    jsonb_build_object(
      'battle_id', v_battle.id,
      'challenge_id', v_challenge.id,
      'participant_id', p_participant_id,
      'coins', v_coins,
      'xp', v_reward_xp,
      'team_points', v_team_points,
      'balance', v_balance,
      'level', v_level
    )
  );

  return jsonb_build_object(
    'status', 'approved',
    'already_rewarded', false,
    'coins_granted', v_coins,
    'xp_granted', v_reward_xp,
    'team_points', v_team_points,
    'new_balance', v_balance,
    'new_xp', v_xp,
    'new_level', v_level
  );
end;
$$;

revoke all on function public.review_group_challenge(uuid, text, text) from public;
grant execute on function public.review_group_challenge(uuid, text, text) to authenticated;

create or replace function public.finalize_group_battle(p_battle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_battle public.group_battles%rowtype;
  v_challenger_points bigint := 0;
  v_challenged_points bigint := 0;
  v_challenger_approved integer := 0;
  v_challenged_approved integer := 0;
  v_winner uuid;
  v_has_pending boolean;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_battle
  from public.group_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'group battle not found';
  end if;

  if not (public.is_group_admin(v_battle.challenger_group_id) or public.is_group_admin(v_battle.challenged_group_id)) then
    raise exception 'only a squad captain can finalize the battle';
  end if;

  if v_battle.status = 'completed' then
    select coalesce(sum(se.team_points), 0), count(*)
      into v_challenger_points, v_challenger_approved
    from public.score_events se
    where se.challenge_id = v_battle.challenge_id and se.group_id = v_battle.challenger_group_id;

    select coalesce(sum(se.team_points), 0), count(*)
      into v_challenged_points, v_challenged_approved
    from public.score_events se
    where se.challenge_id = v_battle.challenge_id and se.group_id = v_battle.challenged_group_id;

    return jsonb_build_object(
      'status', 'completed',
      'already_finalized', true,
      'challenger_points', v_challenger_points,
      'challenged_points', v_challenged_points,
      'challenger_approved', v_challenger_approved,
      'challenged_approved', v_challenged_approved,
      'winner_group_id', v_battle.winner_group_id,
      'tie', v_battle.winner_group_id is null
    );
  end if;

  if v_battle.status <> 'active' then
    raise exception 'battle is not active';
  end if;

  if v_battle.expires_at is not null and v_battle.expires_at <= now() then
    -- Members who never submitted are closed at the deadline. Evidence that was
    -- submitted on time must still be reviewed before the battle can close.
    update public.challenge_participants
    set status = 'expired'
    where challenge_id = v_battle.challenge_id
      and status in ('accepted', 'rejected');

    select exists (
      select 1
      from public.challenge_participants cp
      where cp.challenge_id = v_battle.challenge_id
        and cp.status = 'submitted'
    ) into v_has_pending;

    if v_has_pending then
      raise exception 'battle has submitted evidence pending review';
    end if;
  else
    select exists (
      select 1
      from public.challenge_participants cp
      where cp.challenge_id = v_battle.challenge_id
        and cp.status not in ('approved', 'declined', 'expired')
    ) into v_has_pending;

    if v_has_pending then
      raise exception 'battle still has pending participants';
    end if;
  end if;

  select coalesce(sum(se.team_points), 0), count(*)
    into v_challenger_points, v_challenger_approved
  from public.score_events se
  where se.challenge_id = v_battle.challenge_id and se.group_id = v_battle.challenger_group_id;

  select coalesce(sum(se.team_points), 0), count(*)
    into v_challenged_points, v_challenged_approved
  from public.score_events se
  where se.challenge_id = v_battle.challenge_id and se.group_id = v_battle.challenged_group_id;

  v_winner := case
    when v_challenger_points > v_challenged_points then v_battle.challenger_group_id
    when v_challenged_points > v_challenger_points then v_battle.challenged_group_id
    else null
  end;

  update public.group_battles
  set status = 'completed', completed_at = now(), winner_group_id = v_winner
  where id = p_battle_id;

  update public.challenges
  set status = 'completed'
  where id = v_battle.challenge_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  select distinct
    gm.user_id,
    'squad_battle_completed',
    'Batalla de Squads finalizada',
    format('%s - %s Team Points', v_challenger_points, v_challenged_points),
    jsonb_build_object(
      'battle_id', p_battle_id,
      'challenge_id', v_battle.challenge_id,
      'winner_group_id', v_winner,
      'challenger_points', v_challenger_points,
      'challenged_points', v_challenged_points
    )
  from public.group_members gm
  where gm.group_id in (v_battle.challenger_group_id, v_battle.challenged_group_id)
    and gm.status = 'active';

  return jsonb_build_object(
    'status', 'completed',
    'already_finalized', false,
    'challenger_points', v_challenger_points,
    'challenged_points', v_challenged_points,
    'challenger_approved', v_challenger_approved,
    'challenged_approved', v_challenged_approved,
    'winner_group_id', v_winner,
    'tie', v_winner is null
  );
end;
$$;

revoke all on function public.finalize_group_battle(uuid) from public;
grant execute on function public.finalize_group_battle(uuid) to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v11.0-squads-group-battles',
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
