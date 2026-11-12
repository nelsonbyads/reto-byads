-- DadoFit self-hosted backend - least-privilege login role for the API.
--
-- The API never connects as the database owner. It can only:
--   * switch to anon / authenticated for every user request (RLS applies), and
--   * read/write the auth.* tables it owns as the authentication service.
-- Its password is set by the migration runner from DADOFIT_API_DB_PASSWORD.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dadofit_api') then
    create role dadofit_api login noinherit;
  end if;
end
$$;

grant anon, authenticated to dadofit_api;

grant usage on schema auth to dadofit_api;
grant select, insert, update on table auth.users to dadofit_api;
grant select, insert, update, delete on table auth.refresh_tokens, auth.one_time_tokens to dadofit_api;
grant select, insert, delete on table auth.login_attempts to dadofit_api;

-- Read-only access for the auth service to build the session user.
grant usage on schema public to dadofit_api;
grant select (id, display_name, username, avatar_url, signup_intent, platform_status)
  on table public.profiles to dadofit_api;
