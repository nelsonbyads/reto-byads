-- DadoFit self-hosted backend - fixes from the 2026-11 technical audit.

-- SEC-03: external URLs rendered as links must be http(s). NOT VALID keeps
-- historical rows readable while blocking new unsafe values.
alter table public.organizations drop constraint if exists organizations_website_url_scheme_check;
alter table public.organizations add constraint organizations_website_url_scheme_check
  check (website_url is null or website_url ~* '^https?://[^\s]+$') not valid;

alter table public.ad_campaigns drop constraint if exists ad_campaigns_target_url_scheme_check;
alter table public.ad_campaigns add constraint ad_campaigns_target_url_scheme_check
  check (target_url is null or target_url ~* '^https?://[^\s]+$') not valid;

-- PERF-01: authorised Partner Points presentation for several organizations in
-- one call (same projection as get_partner_point_config).
create or replace function public.get_partner_point_configs_batch(p_organization_ids uuid[])
returns table(organization_id uuid, points_name text, points_short_name text, points_icon text, points_color text, enabled boolean)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select o.id, coalesce(c.points_name, 'Partner Points'), coalesce(c.points_short_name, 'PP'),
         case when c.points_icon ~ '^[a-z0-9][a-z0-9_-]{0,63}$' then c.points_icon end,
         coalesce(c.points_color, '#64748B'), coalesce(c.enabled, false)
  from public.organizations o
  left join public.partner_point_configs c on c.organization_id = o.id
  where o.id = any((coalesce(p_organization_ids, '{}'::uuid[]))[1:200])
    and o.organization_type in ('gym', 'brand', 'company')
$$;
revoke all on function public.get_partner_point_configs_batch(uuid[]) from public, anon;
grant execute on function public.get_partner_point_configs_batch(uuid[]) to authenticated;
