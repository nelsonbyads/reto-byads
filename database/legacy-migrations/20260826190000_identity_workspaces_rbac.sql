-- DadoFit V12.2 - Identity, Workspaces & RBAC
-- One auth identity can operate in a personal context and in organization workspaces.
-- Creation rights are separated from organization membership roles.

alter table public.profiles
  add column if not exists signup_intent text not null default 'personal';

alter table public.profiles
  drop constraint if exists profiles_signup_intent_check;
alter table public.profiles
  add constraint profiles_signup_intent_check
  check (signup_intent in ('personal', 'gym', 'brand'));

alter table public.organizations
  add column if not exists verification_status text not null default 'pending_verification';

alter table public.organizations
  drop constraint if exists organizations_verification_status_check;
alter table public.organizations
  add constraint organizations_verification_status_check
  check (verification_status in ('draft', 'pending_verification', 'verified', 'rejected', 'suspended'));

-- Existing organizations predate the verification workflow, so keep them operational.
update public.organizations
set verification_status = 'verified'
where verification_status = 'pending_verification';

create table if not exists public.account_capabilities (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  can_create_gym boolean not null default false,
  can_create_brand boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.account_capabilities enable row level security;
revoke all privileges on table public.account_capabilities from anon, authenticated;

-- Backfill the onboarding intent for existing owners without changing ordinary Gymbros.
update public.profiles p
set signup_intent = 'gym'
where p.signup_intent = 'personal'
  and exists (
    select 1 from public.organizations o
    where o.owner_user_id = p.id and o.organization_type = 'gym'
  );

update public.profiles p
set signup_intent = 'brand'
where p.signup_intent = 'personal'
  and exists (
    select 1 from public.organizations o
    where o.owner_user_id = p.id and o.organization_type in ('brand', 'sponsor', 'company')
  );

insert into public.account_capabilities (user_id, can_create_gym, can_create_brand)
select
  p.id,
  (
    p.signup_intent = 'gym'
    or exists (select 1 from public.organizations o where o.owner_user_id = p.id and o.organization_type = 'gym')
  ),
  (
    p.signup_intent = 'brand'
    or exists (select 1 from public.organizations o where o.owner_user_id = p.id and o.organization_type in ('brand', 'sponsor', 'company'))
  )
from public.profiles p
on conflict (user_id) do update
set
  can_create_gym = public.account_capabilities.can_create_gym or excluded.can_create_gym,
  can_create_brand = public.account_capabilities.can_create_brand or excluded.can_create_brand,
  updated_at = now();

-- New auth users persist their registration intent and receive only the matching
-- organization-creation capability. Every account still gets a personal workspace.
create or replace function public.handle_new_dadofit_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_base text;
  generated_username text;
  generated_name text;
  v_signup_intent text;
begin
  clean_base := lower(regexp_replace(split_part(coalesce(new.email, 'gymbro'), '@', 1), '[^a-z0-9_.]+', '', 'g'));
  if length(clean_base) < 3 then clean_base := 'gymbro'; end if;

  generated_username := left(clean_base, 20) || '_' || substr(replace(new.id::text, '-', ''), 1, 8);
  generated_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Gymbro'
  );

  v_signup_intent := case
    when new.raw_user_meta_data ->> 'account_type' = 'gym' then 'gym'
    when new.raw_user_meta_data ->> 'account_type' = 'brand' then 'brand'
    else 'personal'
  end;

  insert into public.profiles (id, username, display_name, signup_intent)
  values (new.id, generated_username, generated_name, v_signup_intent)
  on conflict (id) do nothing;

  insert into public.user_progress (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.account_capabilities (user_id, can_create_gym, can_create_brand)
  values (new.id, v_signup_intent = 'gym', v_signup_intent = 'brand')
  on conflict (user_id) do update
  set
    can_create_gym = excluded.can_create_gym,
    can_create_brand = excluded.can_create_brand,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.handle_new_dadofit_user() from public, anon, authenticated;

-- A personal Gymbro can create Squads, but organization creation requires a
-- business capability established by registration/admin flow.
create or replace function public.enforce_organization_creation_capability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_can_gym boolean := false;
  v_can_brand boolean := false;
begin
  -- Service-role/admin migrations have no end-user auth context.
  if v_actor is null then return new; end if;

  if new.owner_user_id is distinct from v_actor then
    raise exception 'organization owner must match authenticated user';
  end if;

  select ac.can_create_gym, ac.can_create_brand
    into v_can_gym, v_can_brand
  from public.account_capabilities ac
  where ac.user_id = v_actor;

  v_can_gym := coalesce(v_can_gym, false);
  v_can_brand := coalesce(v_can_brand, false);

  if new.organization_type = 'gym' and not v_can_gym then
    raise exception 'your account is not enabled to create a Gym workspace';
  end if;

  if new.organization_type in ('brand', 'sponsor', 'company') and not v_can_brand then
    raise exception 'your account is not enabled to create a Brand workspace';
  end if;

  if new.organization_type = 'other' then
    raise exception 'generic organizations cannot be created from the user onboarding flow';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_organization_creation_capability() from public, anon, authenticated;

drop trigger if exists organizations_creation_capability_v122 on public.organizations;
create trigger organizations_creation_capability_v122
before insert on public.organizations
for each row execute function public.enforce_organization_creation_capability();

-- Regular organization challenges are Gym features. Brand/Sponsor challenge types
-- are intentionally reserved for V13 and must use the sponsored flow later.
create or replace function public.enforce_organization_challenge_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  if new.challenge_type <> 'organization' then return new; end if;
  if new.creator_organization_id is null then
    raise exception 'organization challenge requires creator organization';
  end if;

  select organization_type into v_type
  from public.organizations
  where id = new.creator_organization_id;

  if v_type <> 'gym' then
    raise exception 'organization challenges are currently available only to Gym workspaces';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_organization_challenge_kind() from public, anon, authenticated;

drop trigger if exists challenges_organization_kind_v122 on public.challenges;
create trigger challenges_organization_kind_v122
before insert or update of challenge_type, creator_organization_id on public.challenges
for each row execute function public.enforce_organization_challenge_kind();

-- Single source of truth used by the frontend workspace switcher and route guards.
create or replace function public.get_dadofit_workspace_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_signup_intent text := 'personal';
  v_can_create_gym boolean := false;
  v_can_create_brand boolean := false;
  v_org_workspaces jsonb := '[]'::jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select coalesce(p.signup_intent, 'personal')
    into v_signup_intent
  from public.profiles p
  where p.id = v_actor;

  select coalesce(ac.can_create_gym, false), coalesce(ac.can_create_brand, false)
    into v_can_create_gym, v_can_create_brand
  from public.account_capabilities ac
  where ac.user_id = v_actor;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', 'org:' || o.id::text,
        'kind', case when o.organization_type = 'gym' then 'gym' else 'brand' end,
        'label', o.name,
        'organization_id', o.id,
        'organization_type', o.organization_type,
        'role', om.role,
        'verification_status', o.verification_status
      ) order by o.name
    ),
    '[]'::jsonb
  ) into v_org_workspaces
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = v_actor
    and om.status = 'active';

  return jsonb_build_object(
    'signup_intent', coalesce(v_signup_intent, 'personal'),
    'capabilities', jsonb_build_object(
      'can_create_gym', coalesce(v_can_create_gym, false),
      'can_create_brand', coalesce(v_can_create_brand, false)
    ),
    'workspaces',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'personal',
          'kind', 'personal',
          'label', 'Mi perfil',
          'organization_id', null,
          'organization_type', null,
          'role', null,
          'verification_status', null
        )
      ) || v_org_workspaces
  );
end;
$$;

revoke all on function public.get_dadofit_workspace_context() from public;
revoke all on function public.get_dadofit_workspace_context() from anon;
grant execute on function public.get_dadofit_workspace_context() to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v12.2-identity-workspaces-rbac',
    'workspace_model', 'personal+organization',
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
