-- SuperAdmin controls for Partner Point economies.

create or replace function public.admin_list_partner_economies()
returns table(
  organization_id uuid,
  points_name text,
  points_short_name text,
  points_icon text,
  points_color text,
  enabled boolean,
  governance_source text,
  explicitly_managed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  perform public.require_platform_admin();
  return query
  select o.id,
    coalesce(c.points_name, case when o.organization_type='gym' then 'Gym Points' when o.organization_type='brand' then 'Sponsor Points' else 'Partner Points' end)::text,
    coalesce(c.points_short_name, case when o.organization_type='gym' then 'GP' when o.organization_type='brand' then 'SP' else 'PP' end)::text,
    c.points_icon::text,
    coalesce(c.points_color,'#64748B')::text,
    coalesce(c.enabled,false),
    c.governance_source::text,
    c.explicitly_managed_at
  from public.organizations o
  left join public.partner_point_configs c on c.organization_id=o.id
  where o.organization_type in ('gym','brand','company')
  order by o.name;
end;
$$;

revoke all on function public.admin_list_partner_economies() from public,anon;
grant execute on function public.admin_list_partner_economies() to authenticated;

create or replace function public.admin_update_partner_point_config(
  p_organization_id uuid,p_points_name text,p_points_short_name text,p_points_icon text default null,
  p_points_color text default null,p_enabled boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid(); v_row public.partner_point_configs; v_before jsonb; v_after jsonb;
begin
  perform public.require_platform_admin();
  if char_length(btrim(coalesce(p_points_name,''))) not between 2 and 60 then raise exception 'invalid points name'; end if;
  if char_length(upper(btrim(coalesce(p_points_short_name,'')))) not between 1 and 8
     or upper(btrim(p_points_short_name)) in ('DC','TP','XP') then raise exception 'invalid points short name'; end if;
  if p_points_icon is not null and p_points_icon !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then raise exception 'invalid points icon'; end if;
  if p_points_color is not null and p_points_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid points color'; end if;
  if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.organization_type in ('gym','brand','company')) then
    raise exception 'unsupported Partner organization';
  end if;
  if coalesce(p_enabled,false) and not exists(
    select 1 from public.organizations o where o.id=p_organization_id and o.verification_status='verified'
  ) then raise exception 'organization must be verified before enabling its Partner economy'; end if;
  select to_jsonb(c) into v_before from public.partner_point_configs c where c.organization_id=p_organization_id;
  insert into public.partner_point_configs(organization_id,points_name,points_short_name,points_icon,points_color,enabled,updated_by,governance_source,explicitly_managed_at)
  values(p_organization_id,btrim(p_points_name),upper(btrim(p_points_short_name)),nullif(p_points_icon,''),upper(coalesce(p_points_color,'#64748B')),coalesce(p_enabled,false),v_actor,'EXPLICIT',now())
  on conflict(organization_id) do update set points_name=excluded.points_name,points_short_name=excluded.points_short_name,
    points_icon=excluded.points_icon,points_color=excluded.points_color,enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now(),
    governance_source='EXPLICIT',explicitly_managed_at=now()
  returning * into v_row;
  v_after:=to_jsonb(v_row);
  perform public.write_admin_audit_v14('partner_economy.config.update','organization',p_organization_id::text,v_before,v_after,null);
  return jsonb_build_object('organization_id',v_row.organization_id,'points_name',v_row.points_name,
    'points_short_name',v_row.points_short_name,'points_icon',v_row.points_icon,'points_color',v_row.points_color,'enabled',v_row.enabled);
end $$;

revoke all on function public.admin_update_partner_point_config(uuid,text,text,text,text,boolean) from public,anon;
grant execute on function public.admin_update_partner_point_config(uuid,text,text,text,text,boolean) to authenticated;
