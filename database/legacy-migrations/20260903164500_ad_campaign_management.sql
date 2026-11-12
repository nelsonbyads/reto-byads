-- DadoFit V14.5 — Advertising campaign management
-- Adds secure SuperAdmin editing for existing ad campaigns while preserving
-- analytics history and writing a full before/after audit record.

create or replace function public.admin_update_ad_campaign(
  p_campaign_id uuid,
  p_brand_name text,
  p_campaign_name text,
  p_image_url text default null,
  p_target_url text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_placement_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.ad_campaigns%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_before_placements jsonb;
  v_after_placements jsonb;
begin
  perform public.require_platform_admin();

  select * into v_campaign
  from public.ad_campaigns
  where id = p_campaign_id
  for update;

  if not found then
    raise exception 'ad campaign not found';
  end if;

  if v_campaign.status in ('completed','cancelled') then
    raise exception 'completed or cancelled campaigns are read-only; duplicate it to create a new campaign';
  end if;

  if length(btrim(coalesce(p_brand_name,''))) < 2 or length(btrim(p_brand_name)) > 120 then
    raise exception 'invalid brand name';
  end if;

  if length(btrim(coalesce(p_campaign_name,''))) < 2 or length(btrim(p_campaign_name)) > 160 then
    raise exception 'invalid campaign name';
  end if;

  if p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at then
    raise exception 'invalid campaign window';
  end if;

  if p_placement_key is null or not exists (
    select 1 from public.ad_placements
    where placement_key = p_placement_key and enabled = true
  ) then
    raise exception 'ad placement not found or disabled';
  end if;

  v_before := to_jsonb(v_campaign);
  select coalesce(jsonb_agg(ap.placement_key order by ap.placement_key),'[]'::jsonb)
  into v_before_placements
  from public.ad_campaign_placements ap
  where ap.campaign_id = p_campaign_id;

  update public.ad_campaigns
  set brand_name = left(btrim(p_brand_name),120),
      campaign_name = left(btrim(p_campaign_name),160),
      image_url = nullif(left(btrim(coalesce(p_image_url,'')),1000),''),
      target_url = nullif(left(btrim(coalesce(p_target_url,'')),1000),''),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      updated_at = now()
  where id = p_campaign_id;

  -- Current Backoffice manages one commercial placement per campaign.
  -- Replace the old assignment atomically so an active campaign never needs
  -- to be deleted/recreated and its ad_events history remains intact.
  delete from public.ad_campaign_placements
  where campaign_id = p_campaign_id
    and placement_key <> p_placement_key;

  insert into public.ad_campaign_placements(campaign_id,placement_key)
  values(p_campaign_id,p_placement_key)
  on conflict do nothing;

  select to_jsonb(ac) into v_after
  from public.ad_campaigns ac
  where ac.id = p_campaign_id;

  select coalesce(jsonb_agg(ap.placement_key order by ap.placement_key),'[]'::jsonb)
  into v_after_placements
  from public.ad_campaign_placements ap
  where ap.campaign_id = p_campaign_id;

  perform public.write_admin_audit_v14(
    'ad_campaign.update',
    'ad_campaign',
    p_campaign_id::text,
    v_before || jsonb_build_object('placements',v_before_placements),
    v_after || jsonb_build_object('placements',v_after_placements),
    jsonb_build_object('live_update',v_campaign.status='active')
  );

  return p_campaign_id;
end;
$$;

revoke all on function public.admin_update_ad_campaign(uuid,text,text,text,text,timestamptz,timestamptz,text) from public;
grant execute on function public.admin_update_ad_campaign(uuid,text,text,text,text,timestamptz,timestamptz,text) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'v14.5-ad-campaign-management'::text;
$$;

revoke all on function public.get_dadofit_schema_version() from public;
grant execute on function public.get_dadofit_schema_version() to anon, authenticated;
