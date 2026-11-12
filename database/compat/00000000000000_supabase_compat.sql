-- DadoFit self-hosted backend - Supabase compatibility layer.
--
-- Applied once, before every file in supabase/migrations/, on a plain
-- PostgreSQL 17 server. It recreates only the pieces of the Supabase platform
-- that the existing migrations, RLS policies and SECURITY DEFINER functions
-- rely on (see docs/SPEC_MIGRACION_BACKEND_PROPIO.md, section 3.2):
--
--   * roles anon / authenticated / service_role
--   * the default privileges Supabase grants on schema public
--   * schema auth: auth.users (+ own auth tables come in M4) and auth.uid()
--   * schema storage: buckets, objects and storage.foldername()
--   * schema extensions (used by the pgTAP suite)
--
-- No Supabase software is involved; this file is plain SQL.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Schema public: same baseline privileges Supabase applies. The migrations were
-- written (and their REVOKEs tuned) against this baseline; RLS remains the
-- access boundary for every table.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schema extensions (pgTAP and future extensions live here, as in Supabase)
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schema auth
-- ---------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Columns used by the migrations (id, email, created_at, raw_user_meta_data),
-- by the pgTAP suite (encrypted_password, aud, role) and by the M4 auth service.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text not null default 'authenticated',
  role text not null default 'authenticated',
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists auth_users_email_lower_key
  on auth.users (lower(email)) where email is not null;

-- auth.users is never exposed to API roles; only SECURITY DEFINER functions
-- (owned by the migration superuser) read it.
revoke all on table auth.users from public, anon, authenticated;

-- Identity of the current request. The API sets it per transaction with
--   select set_config('request.jwt.claim.sub', '<user uuid>', true);
-- which is the same setting Supabase uses, so the existing pgTAP suite works
-- unchanged.
create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

revoke all on function auth.uid() from public;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schema storage (metadata only; file bytes live in MinIO from M5 on)
-- ---------------------------------------------------------------------------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on table storage.objects to authenticated;
grant select on table storage.buckets to anon, authenticated;

-- Same semantics as Supabase: path segments of an object name, without the
-- file name. 'user/participant/file.jpg' -> {user,participant}
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)];
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;
