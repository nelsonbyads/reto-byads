-- DadoFit V14.3 — Rotating billboard inventory
-- Multiple active advertising campaigns may share one placement.
-- The client rotates them at the placement-configured interval.

alter table public.ad_placements
  add column if not exists rotation_seconds integer not null default 12;

alter table public.ad_placements
  drop constraint if exists ad_placements_rotation_seconds_check;
alter table public.ad_placements
  add constraint ad_placements_rotation_seconds_check
  check (rotation_seconds between 5 and 120);

update public.ad_placements
set rotation_seconds = 12
where rotation_seconds is null;

create or replace function public.admin_set_ad_placement_rotation(
  p_placement_key text,
  p_rotation_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform public.require_platform_admin();

  if p_rotation_seconds < 5 or p_rotation_seconds > 120 then
    raise exception 'rotation must be between 5 and 120 seconds';
  end if;

  select to_jsonb(p) into v_before
  from public.ad_placements p
  where p.placement_key = p_placement_key;

  if v_before is null then
    raise exception 'ad placement not found';
  end if;

  update public.ad_placements
  set rotation_seconds = p_rotation_seconds
  where placement_key = p_placement_key;

  select to_jsonb(p) into v_after
  from public.ad_placements p
  where p.placement_key = p_placement_key;

  perform public.write_admin_audit_v14(
    'ad_placement.rotation.change',
    'ad_placement',
    p_placement_key,
    v_before,
    v_after,
    jsonb_build_object('rotation_seconds', p_rotation_seconds)
  );

  return p_rotation_seconds;
end;
$$;

revoke all on function public.admin_set_ad_placement_rotation(text, integer) from public;
grant execute on function public.admin_set_ad_placement_rotation(text, integer) to authenticated;

-- V14 originally prevented overlapping active campaigns in the same placement.
-- V14.3 intentionally removes that conflict: overlap is now the rotation pool.
create or replace function public.admin_set_ad_campaign_status(p_campaign_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_campaign public.ad_campaigns%rowtype;
begin
  perform public.require_platform_admin();

  if p_status not in ('draft','active','paused','completed','cancelled') then
    raise exception 'invalid ad campaign status';
  end if;

  select * into v_campaign
  from public.ad_campaigns
  where id = p_campaign_id
  for update;

  if not found then
    raise exception 'ad campaign not found';
  end if;

  v_before := to_jsonb(v_campaign);

  if p_status = 'active' and not exists (
    select 1 from public.ad_campaign_placements where campaign_id = p_campaign_id
  ) then
    raise exception 'assign at least one placement before activation';
  end if;

  update public.ad_campaigns
  set status = p_status,
      updated_at = now()
  where id = p_campaign_id;

  select to_jsonb(ac) into v_after
  from public.ad_campaigns ac
  where ac.id = p_campaign_id;

  perform public.write_admin_audit_v14(
    'ad_campaign.status.change',
    'ad_campaign',
    p_campaign_id::text,
    v_before,
    v_after,
    jsonb_build_object('rotation_enabled', true)
  );

  return p_status;
end;
$$;

revoke all on function public.admin_set_ad_campaign_status(uuid, text) from public;
grant execute on function public.admin_set_ad_campaign_status(uuid, text) to authenticated;

create or replace function public.get_active_ads(p_placement_key text)
returns table (
  campaign_id uuid,
  brand_name text,
  campaign_name text,
  image_url text,
  target_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  rotation_seconds integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ac.id,
    ac.brand_name,
    ac.campaign_name,
    ac.image_url,
    ac.target_url,
    ac.starts_at,
    ac.ends_at,
    p.rotation_seconds
  from public.ad_campaigns ac
  join public.ad_campaign_placements ap on ap.campaign_id = ac.id
  join public.ad_placements p on p.placement_key = ap.placement_key
  where ap.placement_key = p_placement_key
    and p.enabled = true
    and ac.status = 'active'
    and coalesce(ac.starts_at, '-infinity'::timestamptz) <= now()
    and coalesce(ac.ends_at, 'infinity'::timestamptz) > now()
  order by ac.created_at asc, ac.id asc;
$$;

revoke all on function public.get_active_ads(text) from public;
grant execute on function public.get_active_ads(text) to anon, authenticated;

-- Backward compatibility for any older component still calling get_active_ad.
create or replace function public.get_active_ad(p_placement_key text)
returns table (
  campaign_id uuid,
  brand_name text,
  campaign_name text,
  image_url text,
  target_url text,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ga.campaign_id,
    ga.brand_name,
    ga.campaign_name,
    ga.image_url,
    ga.target_url,
    ga.starts_at,
    ga.ends_at
  from public.get_active_ads(p_placement_key) ga
  limit 1;
$$;

revoke all on function public.get_active_ad(text) from public;
grant execute on function public.get_active_ad(text) to anon, authenticated;
