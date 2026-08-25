-- DadoFit V11.2.1 - Restore latest health marker after out-of-order V11.1 application
-- V11.1 was applied after V11.2, so its dadofit_health() definition temporarily
-- replaced the newer V11.2 schema marker. No domain data or reward state is changed.

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v11.2-social-dashboard-notifications',
    'direct_pair_cooldown_hours', 24,
    'direct_daily_limit', 5,
    'squad_pair_cooldown_hours', 24,
    'squad_daily_limit', 5,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
