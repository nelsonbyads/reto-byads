-- DadoFit V15.7.8 - Gym / Organization verification hotfix
-- SuperAdmin can approve/reject/suspend Gyms from Admin > Organizaciones.

create or replace function public.admin_set_organization_verification(
  p_organization_id uuid,
  p_status text,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_type text;
begin
  perform public.require_platform_admin();

  if p_status not in ('pending_verification','verified','rejected','suspended') then
    raise exception 'invalid verification status';
  end if;

  select o.organization_type, to_jsonb(o)
    into v_type, v_before
  from public.organizations o
  where o.id = p_organization_id;

  if v_before is null then
    raise exception 'organization not found';
  end if;

  if v_type not in ('gym','brand','sponsor','company','other') then
    raise exception 'unsupported organization type';
  end if;

  if p_status in ('rejected','suspended')
     and nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception 'reason is required for rejected or suspended organizations';
  end if;

  update public.organizations
  set verification_status = p_status,
      updated_at = now()
  where id = p_organization_id;

  select to_jsonb(o)
    into v_after
  from public.organizations o
  where o.id = p_organization_id;

  perform public.write_admin_audit_v14(
    'organization.verification.change',
    'organization',
    p_organization_id::text,
    v_before,
    v_after,
    jsonb_build_object(
      'organization_type', v_type,
      'reason', nullif(btrim(coalesce(p_reason,'')), '')
    )
  );

  return p_status;
end;
$$;

revoke all on function public.admin_set_organization_verification(uuid,text,text) from public;
grant execute on function public.admin_set_organization_verification(uuid,text,text) to authenticated;

-- Keep the old Brand RPC as a compatibility wrapper for existing clients.
create or replace function public.admin_set_brand_verification(
  p_organization_id uuid,
  p_status text,
  p_reason text default null
)
returns text
language sql
security definer
set search_path = public
as $$
  select public.admin_set_organization_verification(p_organization_id, p_status, p_reason);
$$;

revoke all on function public.admin_set_brand_verification(uuid,text,text) from public;
grant execute on function public.admin_set_brand_verification(uuid,text,text) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
as $$
  select 'v15.7.8-gym-organization-verification';
$$;

grant execute on function public.get_dadofit_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';
