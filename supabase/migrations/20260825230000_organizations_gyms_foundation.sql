-- DadoFit V12.0 - Organizations / Gyms Foundation
-- Adds secure organization membership, organization-wide challenges,
-- Sponsor Points and anti-farming rules for Gym/Organization rewards.

alter table public.challenge_participants
  add column if not exists sponsor_points_granted integer not null default 0 check (sponsor_points_granted >= 0);

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
      'organization_daily_limit'
    )
  );

-- Organization writes are server-owned. Authenticated clients use RPCs below.
revoke insert, update, delete on table public.organizations from authenticated;
revoke insert, update, delete on table public.organization_members from authenticated;

create or replace function public.is_organization_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_organization_manager(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('owner', 'admin', 'coach')
  );
$$;

revoke all on function public.is_organization_admin(uuid) from public;
revoke all on function public.is_organization_manager(uuid) from public;
grant execute on function public.is_organization_admin(uuid) to authenticated;
grant execute on function public.is_organization_manager(uuid) to authenticated;

create or replace function public.create_organization(
  p_name text,
  p_organization_type text default 'gym',
  p_description text default null,
  p_website_url text default null,
  p_country_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_slug_base text;
  v_slug text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if length(btrim(coalesce(p_name, ''))) < 3 or length(btrim(p_name)) > 80 then
    raise exception 'organization name must have between 3 and 80 characters';
  end if;

  if p_organization_type not in ('gym', 'brand', 'sponsor', 'company', 'other') then
    raise exception 'invalid organization type';
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then
    v_slug_base := 'organization';
  end if;
  v_slug := left(v_slug_base, 52) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.organizations (
    owner_user_id,
    name,
    slug,
    organization_type,
    description,
    website_url,
    country_code
  ) values (
    v_actor,
    left(btrim(p_name), 80),
    v_slug,
    p_organization_type,
    nullif(left(btrim(coalesce(p_description, '')), 500), ''),
    nullif(left(btrim(coalesce(p_website_url, '')), 300), ''),
    nullif(upper(left(btrim(coalesce(p_country_code, '')), 2)), '')
  )
  returning id into v_organization_id;

  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (v_organization_id, v_actor, 'owner', 'active', now());

  return v_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text, text, text, text) from public;
grant execute on function public.create_organization(text, text, text, text, text) to authenticated;

create or replace function public.invite_organization_member(
  p_organization_id uuid,
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
  v_name text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if not public.is_organization_admin(p_organization_id) then
    raise exception 'only organization owners or admins can invite members';
  end if;

  if p_user_id is null or p_user_id = v_actor then
    raise exception 'invalid member';
  end if;

  if not public.are_gymbros(v_actor, p_user_id) then
    raise exception 'you can only invite an accepted Gymbro';
  end if;

  select status into v_existing_status
  from public.organization_members
  where organization_id = p_organization_id
    and user_id = p_user_id;

  if v_existing_status = 'active' then
    return 'active';
  end if;
  if v_existing_status = 'invited' then
    return 'invited';
  end if;

  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (p_organization_id, p_user_id, 'member', 'invited', now())
  on conflict (organization_id, user_id) do update
  set role = 'member', status = 'invited', joined_at = now();

  select name into v_name from public.organizations where id = p_organization_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    p_user_id,
    'organization_invited',
    'Te invitaron a una organización',
    coalesce(v_name, 'DadoFit Organization'),
    jsonb_build_object('organization_id', p_organization_id)
  );

  return 'invited';
end;
$$;

revoke all on function public.invite_organization_member(uuid, uuid) from public;
grant execute on function public.invite_organization_member(uuid, uuid) to authenticated;

create or replace function public.respond_organization_invite(
  p_organization_id uuid,
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
  v_name text;
  v_status text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select o.owner_user_id, o.name
    into v_owner, v_name
  from public.organizations o
  join public.organization_members om on om.organization_id = o.id
  where o.id = p_organization_id
    and om.user_id = v_actor
    and om.status = 'invited'
  for update of om;

  if not found then
    raise exception 'organization invitation not found';
  end if;

  v_status := case when p_accept then 'active' else 'left' end;

  update public.organization_members
  set status = v_status,
      joined_at = case when p_accept then now() else joined_at end
  where organization_id = p_organization_id
    and user_id = v_actor;

  if v_owner is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_owner,
      case when p_accept then 'organization_invite_accepted' else 'organization_invite_declined' end,
      case when p_accept then 'Aceptaron tu invitación' else 'Rechazaron tu invitación' end,
      v_name,
      jsonb_build_object('organization_id', p_organization_id, 'user_id', v_actor)
    );
  end if;

  return v_status;
end;
$$;

revoke all on function public.respond_organization_invite(uuid, boolean) from public;
grant execute on function public.respond_organization_invite(uuid, boolean) to authenticated;

create or replace function public.leave_organization(p_organization_id uuid)
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
  from public.organization_members
  where organization_id = p_organization_id
    and user_id = v_actor
    and status = 'active'
  for update;

  if not found then
    raise exception 'active organization membership not found';
  end if;

  if v_role = 'owner' then
    raise exception 'the organization owner cannot leave';
  end if;

  update public.organization_members
  set status = 'left'
  where organization_id = p_organization_id
    and user_id = v_actor;

  return 'left';
end;
$$;

revoke all on function public.leave_organization(uuid) from public;
grant execute on function public.leave_organization(uuid) to authenticated;

create or replace function public.remove_organization_member(
  p_organization_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_owner uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if not public.is_organization_admin(p_organization_id) then
    raise exception 'only organization owners or admins can remove members';
  end if;

  select owner_user_id into v_owner
  from public.organizations
  where id = p_organization_id;

  if p_user_id = v_owner then
    raise exception 'the organization owner cannot be removed';
  end if;

  select role into v_actor_role
  from public.organization_members
  where organization_id = p_organization_id
    and user_id = v_actor
    and status = 'active';

  select role into v_target_role
  from public.organization_members
  where organization_id = p_organization_id
    and user_id = p_user_id
    and status in ('active', 'invited')
  for update;

  if not found then
    raise exception 'member not found';
  end if;

  if v_actor_role = 'admin' and v_target_role in ('owner', 'admin') then
    raise exception 'only the owner can remove an admin';
  end if;

  update public.organization_members
  set status = 'removed'
  where organization_id = p_organization_id
    and user_id = p_user_id;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    p_user_id,
    'organization_removed',
    'Ya no perteneces a la organización',
    null,
    jsonb_build_object('organization_id', p_organization_id)
  );

  return 'removed';
end;
$$;

revoke all on function public.remove_organization_member(uuid, uuid) from public;
grant execute on function public.remove_organization_member(uuid, uuid) to authenticated;

create or replace function public.set_organization_member_role(
  p_organization_id uuid,
  p_user_id uuid,
  p_role text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select owner_user_id into v_owner
  from public.organizations
  where id = p_organization_id;

  if v_owner <> v_actor then
    raise exception 'only the organization owner can change roles';
  end if;

  if p_user_id = v_owner then
    raise exception 'owner role cannot be changed';
  end if;

  if p_role not in ('admin', 'coach', 'member') then
    raise exception 'invalid role';
  end if;

  update public.organization_members
  set role = p_role
  where organization_id = p_organization_id
    and user_id = p_user_id
    and status = 'active';

  if not found then
    raise exception 'active member not found';
  end if;

  return p_role;
end;
$$;

revoke all on function public.set_organization_member_role(uuid, uuid, text) from public;
grant execute on function public.set_organization_member_role(uuid, uuid, text) to authenticated;

-- Complete an organization challenge automatically when every participant is terminal.
create or replace function public.maybe_complete_organization_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id
      and cp.status not in ('approved', 'declined', 'expired')
  ) then
    return;
  end if;

  update public.challenges
  set status = 'completed'
  where id = p_challenge_id
    and challenge_type = 'organization'
    and status = 'active';
end;
$$;

revoke all on function public.maybe_complete_organization_challenge(uuid) from public;
revoke all on function public.maybe_complete_organization_challenge(uuid) from authenticated;
grant execute on function public.maybe_complete_organization_challenge(uuid) to service_role;

create or replace function public.create_organization_challenge(
  p_organization_id uuid,
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
  v_org_name text;
  v_participant_count integer;
  v_participant record;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if not public.is_organization_manager(p_organization_id) then
    raise exception 'only owners, admins or coaches can publish organization challenges';
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

  select name into v_org_name
  from public.organizations
  where id = p_organization_id;

  select count(*)::integer into v_participant_count
  from public.organization_members om
  where om.organization_id = p_organization_id
    and om.status = 'active'
    and om.user_id <> v_actor;

  if v_participant_count = 0 then
    raise exception 'organization needs at least one other active member';
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
    p_organization_id,
    'organization',
    'active',
    left(btrim(p_exercise_name), 160),
    format('Reto para miembros de %s', coalesce(v_org_name, 'DadoFit Organization')),
    left(btrim(p_exercise_id), 160),
    left(btrim(p_exercise_name), 160),
    p_reps,
    p_dice_level,
    now(),
    now() + interval '72 hours',
    true,
    25,
    50,
    0,
    100,
    v_participant_count,
    jsonb_build_object(
      'reward_policy', 'v12-organization-member',
      'source', 'dice-roll',
      'published_by_user_id', v_actor
    )
  )
  returning id into v_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, status)
  select v_challenge_id, om.user_id, 'invited'
  from public.organization_members om
  where om.organization_id = p_organization_id
    and om.status = 'active'
    and om.user_id <> v_actor;

  for v_participant in
    select cp.id, cp.user_id
    from public.challenge_participants cp
    where cp.challenge_id = v_challenge_id
  loop
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'organization_challenge_invited',
      'Nuevo reto de tu organización',
      format('%s: %s repeticiones de %s', coalesce(v_org_name, 'Tu organización'), p_reps, left(btrim(p_exercise_name), 160)),
      jsonb_build_object(
        'organization_id', p_organization_id,
        'challenge_id', v_challenge_id,
        'participant_id', v_participant.id
      )
    );
  end loop;

  return v_challenge_id;
end;
$$;

revoke all on function public.create_organization_challenge(uuid, text, text, integer, text) from public;
grant execute on function public.create_organization_challenge(uuid, text, text, integer, text) to authenticated;

create or replace function public.respond_organization_challenge(
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
  v_status text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_participant
  from public.challenge_participants
  where id = p_participant_id
  for update;

  if not found or v_participant.user_id <> v_actor then
    raise exception 'organization challenge participant not found';
  end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'organization'
     or v_challenge.metadata ->> 'reward_policy' <> 'v12-organization-member' then
    raise exception 'not a V12 organization challenge';
  end if;

  if v_participant.status <> 'invited' then
    return v_participant.status;
  end if;

  if v_challenge.expires_at is not null and v_challenge.expires_at <= now() then
    update public.challenge_participants set status = 'expired' where id = p_participant_id;
    perform public.maybe_complete_organization_challenge(v_challenge.id);
    return 'expired';
  end if;

  v_status := case when p_accept then 'accepted' else 'declined' end;

  update public.challenge_participants
  set status = v_status,
      accepted_at = case when p_accept then now() else accepted_at end
  where id = p_participant_id;

  if not p_accept then
    perform public.maybe_complete_organization_challenge(v_challenge.id);
  end if;

  return v_status;
end;
$$;

revoke all on function public.respond_organization_challenge(uuid, boolean) from public;
grant execute on function public.respond_organization_challenge(uuid, boolean) to authenticated;

create or replace function public.submit_organization_challenge(p_participant_id uuid)
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
    raise exception 'organization challenge participant not found';
  end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'organization'
     or v_challenge.metadata ->> 'reward_policy' <> 'v12-organization-member'
     or v_challenge.status <> 'active' then
    raise exception 'organization challenge is not active';
  end if;

  if v_participant.status not in ('accepted', 'rejected') then
    raise exception 'challenge cannot be submitted from status %', v_participant.status;
  end if;

  if v_challenge.expires_at is not null and v_challenge.expires_at <= now() then
    update public.challenge_participants set status = 'expired' where id = p_participant_id;
    perform public.maybe_complete_organization_challenge(v_challenge.id);
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

  for v_manager in
    select om.user_id
    from public.organization_members om
    where om.organization_id = v_challenge.creator_organization_id
      and om.status = 'active'
      and om.role in ('owner', 'admin', 'coach')
      and om.user_id <> v_actor
  loop
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_manager.user_id,
      'organization_challenge_submitted',
      'Hay evidencia de organización por revisar',
      format('%s repeticiones de %s', v_challenge.reps, v_challenge.exercise_name),
      jsonb_build_object(
        'organization_id', v_challenge.creator_organization_id,
        'challenge_id', v_challenge.id,
        'participant_id', p_participant_id
      )
    );
  end loop;

  return 'submitted';
end;
$$;

revoke all on function public.submit_organization_challenge(uuid) from public;
grant execute on function public.submit_organization_challenge(uuid) to authenticated;

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
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
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
    raise exception 'organization challenge participant not found';
  end if;

  select * into v_challenge
  from public.challenges
  where id = v_participant.challenge_id;

  if v_challenge.challenge_type <> 'organization'
     or v_challenge.metadata ->> 'reward_policy' <> 'v12-organization-member' then
    raise exception 'not a V12 organization challenge';
  end if;

  if not public.is_organization_manager(v_challenge.creator_organization_id) then
    raise exception 'only organization owners, admins or coaches can review evidence';
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
    update public.challenge_participants
    set status = 'rejected'
    where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'organization_challenge_evidence_rejected',
      'Tu evidencia necesita otro intento',
      coalesce(nullif(btrim(p_notes), ''), 'Sube una nueva evidencia y vuelve a enviarla.'),
      jsonb_build_object(
        'organization_id', v_challenge.creator_organization_id,
        'challenge_id', v_challenge.id,
        'participant_id', p_participant_id
      )
    );

    return jsonb_build_object(
      'status', 'rejected',
      'reward_blocked', false,
      'coins_granted', 0,
      'xp_granted', 0,
      'sponsor_points', 0
    );
  end if;

  -- Serialize reward decisions for this user and organization/user pair.
  perform pg_advisory_xact_lock(
    hashtextextended('dadofit:organization-reward:user:' || v_participant.user_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'dadofit:organization-reward:pair:' || v_challenge.creator_organization_id::text || ':' || v_participant.user_id::text,
      0
    )
  );

  select max(cp.rewarded_at)
    into v_last_pair_reward
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where cp.user_id = v_participant.user_id
    and cp.id <> p_participant_id
    and cp.status = 'approved'
    and cp.rewarded_at is not null
    and cp.rewarded_at > now() - interval '24 hours'
    and c.challenge_type = 'organization'
    and c.creator_organization_id = v_challenge.creator_organization_id
    and c.metadata ->> 'reward_policy' = 'v12-organization-member'
    and (cp.reward_coins_granted > 0 or cp.reward_xp_granted > 0 or cp.sponsor_points_granted > 0);

  if v_last_pair_reward is not null then
    v_reward_block_reason := 'organization_pair_cooldown';
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
      and c.challenge_type = 'organization'
      and c.metadata ->> 'reward_policy' = 'v12-organization-member'
      and (cp.reward_coins_granted > 0 or cp.reward_xp_granted > 0 or cp.sponsor_points_granted > 0);

    if v_user_rewards_last_24h >= v_daily_reward_limit then
      v_reward_block_reason := 'organization_daily_limit';
    end if;
  end if;

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
      sponsor_points_granted = 0,
      reward_block_reason = v_reward_block_reason
    where id = p_participant_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_participant.user_id,
      'organization_challenge_approved_no_reward',
      '¡Reto de organización aprobado!',
      case v_reward_block_reason
        when 'organization_pair_cooldown' then 'Reto completado. Esta organización ya te otorgó una recompensa durante las últimas 24 horas.'
        when 'organization_daily_limit' then 'Reto completado. Alcanzaste el límite de 5 recompensas de organizaciones en 24 horas.'
        else 'Reto completado sin recompensa adicional por política anti-farming.'
      end,
      jsonb_build_object(
        'organization_id', v_challenge.creator_organization_id,
        'challenge_id', v_challenge.id,
        'participant_id', p_participant_id,
        'reward_blocked', true,
        'reward_block_reason', v_reward_block_reason
      )
    );

    perform public.maybe_complete_organization_challenge(v_challenge.id);

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
    'organization_challenge_reward',
    v_challenge.id,
    format('Reto de organización completado: %s', v_challenge.exercise_name),
    format('organization-challenge:%s:coins', p_participant_id)
  );

  select new_xp, new_level into v_xp, v_level
  from public.grant_user_xp(
    v_participant.user_id,
    v_reward_xp,
    'organization_challenge_reward',
    v_challenge.id,
    format('Reto de organización completado: %s', v_challenge.exercise_name),
    format('organization-challenge:%s:xp', p_participant_id)
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
    v_challenge.creator_organization_id,
    0,
    v_sponsor_points
  )
  on conflict (participant_id) do nothing;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    v_participant.user_id,
    'organization_challenge_approved',
    '¡Reto de organización aprobado!',
    format('+%s DadoCoins, +%s XP y +%s Sponsor Points', v_coins, v_reward_xp, v_sponsor_points),
    jsonb_build_object(
      'organization_id', v_challenge.creator_organization_id,
      'challenge_id', v_challenge.id,
      'participant_id', p_participant_id,
      'coins', v_coins,
      'xp', v_reward_xp,
      'sponsor_points', v_sponsor_points,
      'balance', v_balance,
      'level', v_level,
      'reward_blocked', false
    )
  );

  perform public.maybe_complete_organization_challenge(v_challenge.id);

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

revoke all on function public.review_organization_challenge(uuid, text, text) from public;
grant execute on function public.review_organization_challenge(uuid, text, text) to authenticated;

create or replace function public.finalize_organization_challenge(p_challenge_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge public.challenges%rowtype;
begin
  select * into v_challenge
  from public.challenges
  where id = p_challenge_id
  for update;

  if not found
     or v_challenge.challenge_type <> 'organization'
     or v_challenge.metadata ->> 'reward_policy' <> 'v12-organization-member' then
    raise exception 'organization challenge not found';
  end if;

  if not public.is_organization_manager(v_challenge.creator_organization_id) then
    raise exception 'only organization managers can finalize this challenge';
  end if;

  if v_challenge.expires_at is not null and v_challenge.expires_at <= now() then
    update public.challenge_participants
    set status = 'expired'
    where challenge_id = p_challenge_id
      and status in ('invited', 'accepted', 'rejected');
  end if;

  perform public.maybe_complete_organization_challenge(p_challenge_id);

  select * into v_challenge from public.challenges where id = p_challenge_id;
  return v_challenge.status;
end;
$$;

revoke all on function public.finalize_organization_challenge(uuid) from public;
grant execute on function public.finalize_organization_challenge(uuid) to authenticated;

-- Extend the main dashboard with organization activity and Sponsor Points.
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

  select coalesce(w.balance, 0)
    into v_coins
  from public.wallets w
  where w.user_id = v_actor;

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

  select count(*)::integer
    into v_direct_pending
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where cp.user_id = v_actor
    and c.challenge_type = 'direct'
    and c.status = 'active'
    and cp.status in ('invited', 'accepted', 'submitted', 'rejected');

  select count(distinct gb.id)::integer
    into v_squad_pending
  from public.group_battles gb
  join public.group_members gm
    on gm.group_id in (gb.challenger_group_id, gb.challenged_group_id)
  where gm.user_id = v_actor
    and gm.status = 'active'
    and gb.status in ('pending', 'active');

  select count(*)::integer
    into v_organization_pending
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where cp.user_id = v_actor
    and c.challenge_type = 'organization'
    and c.status = 'active'
    and cp.status in ('invited', 'accepted', 'submitted', 'rejected');

  select count(*)::integer
    into v_unread_notifications
  from public.notifications n
  where n.user_id = v_actor
    and n.read_at is null;

  select count(*)::integer
    into v_active_squads
  from public.group_members gm
  where gm.user_id = v_actor
    and gm.status = 'active';

  select count(*)::integer
    into v_active_organizations
  from public.organization_members om
  where om.user_id = v_actor
    and om.status = 'active';

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
    'schema_version', 'v12.0-organizations-gyms',
    'direct_pair_cooldown_hours', 24,
    'direct_daily_limit', 5,
    'squad_pair_cooldown_hours', 24,
    'squad_daily_limit', 5,
    'organization_pair_cooldown_hours', 24,
    'organization_daily_limit', 5,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
