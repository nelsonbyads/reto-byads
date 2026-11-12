-- Enable the explicitly configured Nike Partner economy.
-- This targets the verified organization currently used by the Nike workspace;
-- the other historical organization with the same display name is untouched.
--
-- Environment data, not schema: on a clean database (local reset, CI, staging)
-- the organization does not exist, so the migration is a no-op there instead of
-- aborting the whole migration chain.

do $$
declare
  v_organization_id constant uuid := 'e981c006-41b6-4db3-946b-53184938d488';
begin
  if not exists (
    select 1
    from public.organizations o
    where o.id = v_organization_id
      and o.organization_type = 'brand'
      and o.verification_status = 'verified'
  ) then
    raise notice 'verified Nike Partner organization not found; skipping environment-specific enablement';
    return;
  end if;

  update public.partner_point_configs
  set enabled = true,
      governance_source = 'EXPLICIT',
      explicitly_managed_at = coalesce(explicitly_managed_at, now()),
      updated_at = now()
  where organization_id = v_organization_id;

  if not found then
    raise exception 'Nike Partner Points configuration not found';
  end if;
end;
$$;
