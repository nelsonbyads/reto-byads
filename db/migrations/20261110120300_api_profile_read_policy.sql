-- The auth service (dadofit_api) reads the session user's profile and
-- platform status. profiles has RLS enabled, so the column grant from
-- 20261110120200 needs a matching policy for that role.
drop policy if exists profiles_read_auth_service on public.profiles;
create policy profiles_read_auth_service
on public.profiles for select
to dadofit_api
using (true);
