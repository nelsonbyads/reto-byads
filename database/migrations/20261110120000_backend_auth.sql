-- DadoFit self-hosted backend - authentication storage (M4).
-- Applied after supabase/migrations/. Only the API (connected as the migration
-- owner) touches these tables; API roles have no access.

create table if not exists auth.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null,
  token_hash text not null unique,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references auth.refresh_tokens(id) on delete set null
);
create index if not exists refresh_tokens_user_idx on auth.refresh_tokens (user_id) where revoked_at is null;
create index if not exists refresh_tokens_family_idx on auth.refresh_tokens (family_id);

create table if not exists auth.one_time_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('email_confirmation', 'password_recovery')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists one_time_tokens_user_purpose_idx on auth.one_time_tokens (user_id, purpose) where used_at is null;

create table if not exists auth.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip text,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_email_time_idx on auth.login_attempts (lower(email), created_at desc);

revoke all on table auth.refresh_tokens, auth.one_time_tokens, auth.login_attempts from public, anon, authenticated;

-- Account suspension is enforced by the auth service (SEC-01): suspending a
-- profile bans the auth user and revokes every refresh token; reactivating
-- lifts the ban.
create or replace function auth.sync_platform_status_ban()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.platform_status is distinct from old.platform_status then
    if new.platform_status = 'suspended' then
      update auth.users set banned_until = 'infinity', updated_at = now() where id = new.id;
      update auth.refresh_tokens set revoked_at = now() where user_id = new.id and revoked_at is null;
    else
      update auth.users set banned_until = null, updated_at = now() where id = new.id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function auth.sync_platform_status_ban() from public, anon, authenticated;

drop trigger if exists profiles_platform_status_ban_sync on public.profiles;
create trigger profiles_platform_status_ban_sync
after update of platform_status on public.profiles
for each row execute function auth.sync_platform_status_ban();
