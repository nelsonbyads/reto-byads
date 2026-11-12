-- DadoFit 2.1 - ECO-4A Partner Economy Foundation
-- Adds per-organization Partner Points naming/config without touching wallets or score_events.

create table if not exists public.partner_point_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  points_name text not null,
  points_short_name text not null,
  points_icon text,
  points_color text,
  enabled boolean not null default true,
  competitive_score_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint partner_point_configs_org_unique unique (organization_id),
  constraint partner_point_configs_name_len check (char_length(btrim(points_name)) between 2 and 60),
  constraint partner_point_configs_short_len check (char_length(btrim(points_short_name)) between 1 and 8),
  -- GP/SP are allowed as legacy-compatible defaults during ECO-4A; DC/TP/XP always reserved.
  constraint partner_point_configs_short_reserved check (
    upper(btrim(points_short_name)) not in ('DC','TP','XP')
  ),
  constraint partner_point_configs_color check (
    points_color is null or points_color ~ '^#[0-9a-fA-F]{6}$'
  )
);

create index if not exists partner_point_configs_org_idx on public.partner_point_configs(organization_id);

alter table public.partner_point_configs enable row level security;

revoke all on table public.partner_point_configs from anon, authenticated;
grant select on table public.partner_point_configs to authenticated;

-- Readable by any authenticated user (contains only naming/branding, no balances).
drop policy if exists partner_point_configs_read on public.partner_point_configs;
create policy partner_point_configs_read
on public.partner_point_configs for select
to authenticated
using (true);

-- Backfill defaults for existing organizations by organization_type.
insert into public.partner_point_configs (organization_id, points_name, points_short_name, points_icon, points_color, enabled, competitive_score_name)
select
  o.id,
  case
    when o.organization_type = 'gym' then 'Gym Points'
    when o.organization_type in ('brand','sponsor') then 'Sponsor Points'
    else 'Partner Points'
  end,
  case
    when o.organization_type = 'gym' then 'GP'
    when o.organization_type in ('brand','sponsor') then 'SP'
    else 'PP'
  end,
  null,
  null,
  true,
  null
from public.organizations o
on conflict (organization_id) do nothing;

-- RPC: read config (or a deterministic default if missing; does not create rows).
create or replace function public.get_partner_point_config(p_organization_id uuid)
returns table (
  organization_id uuid,
  points_name text,
  points_short_name text,
  points_icon text,
  points_color text,
  enabled boolean,
  competitive_score_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_organization_id is null then
    raise exception 'organization_id required';
  end if;

  return query
    select
      c.organization_id,
      c.points_name,
      c.points_short_name,
      c.points_icon,
      c.points_color,
      c.enabled,
      c.competitive_score_name
    from public.partner_point_configs c
    where c.organization_id = p_organization_id;

  if not found then
    return query
      select
        o.id,
        case
          when o.organization_type = 'gym' then 'Gym Points'
          when o.organization_type in ('brand','sponsor') then 'Sponsor Points'
          else 'Partner Points'
        end,
        case
          when o.organization_type = 'gym' then 'GP'
          when o.organization_type in ('brand','sponsor') then 'SP'
          else 'PP'
        end,
        null::text,
        null::text,
        true,
        null::text
      from public.organizations o
      where o.id = p_organization_id;
  end if;
end;
$$;

revoke all on function public.get_partner_point_config(uuid) from public;
grant execute on function public.get_partner_point_config(uuid) to authenticated;

-- RPC: upsert config with RBAC (Owner/Admin of the org or platform admin).
create or replace function public.upsert_partner_point_config(
  p_organization_id uuid,
  p_points_name text,
  p_points_short_name text,
  p_points_icon text default null,
  p_points_color text default null,
  p_enabled boolean default true,
  p_competitive_score_name text default null
)
returns public.partner_point_configs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_short text := upper(btrim(p_points_short_name));
  v_config public.partner_point_configs;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if not public.can_manage_rewards_for_org(p_organization_id, v_actor) then
    raise exception 'only Owner/Admin of this organization or platform admin can manage Partner Points config';
  end if;

  if p_points_name is null or char_length(btrim(p_points_name)) < 2 or char_length(btrim(p_points_name)) > 60 then
    raise exception 'points_name must be 2-60 characters';
  end if;

  if v_short is null or char_length(v_short) < 1 or char_length(v_short) > 8 then
    raise exception 'points_short_name must be 1-8 characters';
  end if;

  if v_short in ('DC','TP','XP','GP','SP') then
    -- Legacy defaults GP/SP remain readable; only block reuse when the org's own config no longer uses it.
    if not exists (
      select 1 from public.partner_point_configs c
      where c.organization_id = p_organization_id and upper(c.points_short_name) = v_short
    ) and v_short in ('GP','SP') then
      raise exception 'points_short_name reserved: %', v_short;
    elsif v_short in ('DC','TP','XP') then
      raise exception 'points_short_name reserved: %', v_short;
    end if;
  end if;

  if p_points_color is not null and p_points_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'points_color must be #RRGGBB';
  end if;

  insert into public.partner_point_configs (
    organization_id, points_name, points_short_name, points_icon, points_color, enabled, competitive_score_name, updated_by
  ) values (
    p_organization_id, btrim(p_points_name), v_short, p_points_icon, p_points_color, coalesce(p_enabled, true), p_competitive_score_name, v_actor
  )
  on conflict (organization_id) do update set
    points_name = excluded.points_name,
    points_short_name = excluded.points_short_name,
    points_icon = excluded.points_icon,
    points_color = excluded.points_color,
    enabled = excluded.enabled,
    competitive_score_name = excluded.competitive_score_name,
    updated_at = now(),
    updated_by = excluded.updated_by
  returning * into v_config;

  return v_config;
end;
$$;

revoke all on function public.upsert_partner_point_config(uuid,text,text,text,text,boolean,text) from public;
grant execute on function public.upsert_partner_point_config(uuid,text,text,text,text,boolean,text) to authenticated;

-- Version marker.
create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
as $$ select 'v15.7.16-eco4a-partner-economy-foundation'::text; $$;
