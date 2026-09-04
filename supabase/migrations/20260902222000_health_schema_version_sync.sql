-- DadoFit V14.4.2 — Health/schema version synchronization
-- Fixes an old hardcoded schema_version inside dadofit_health().
-- From now on the health endpoint reads the canonical schema marker from
-- get_dadofit_schema_version(), so future version bumps only need to update
-- that canonical function.

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', public.get_dadofit_schema_version(),
    'workspace_model', 'personal+organization',
    'brand_double_validation', true,
    'brand_audit_trail', true,
    'platform_superadmin', true,
    'support_requests', true,
    'ad_inventory', 7,
    'ad_rotation', true,
    'ad_analytics', true,
    'ad_click_tracking', true,
    'admin_audit_log', true,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
