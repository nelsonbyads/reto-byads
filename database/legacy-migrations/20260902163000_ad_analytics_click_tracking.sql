-- DadoFit V14.4 — Ad analytics & click tracking
-- First-party measurement for the advertising inventory.
-- Stores impressions/clicks, authenticated user when available, session id,
-- route and coarse device class. No IP address or raw user-agent is stored.

create table if not exists public.ad_events (
  id bigserial primary key,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  placement_key text not null references public.ad_placements(placement_key) on delete restrict,
  event_type text not null,
  user_id uuid references auth.users(id) on delete set null,
  session_id text not null,
  route_path text not null,
  device_type text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint ad_events_type_check check (event_type in ('impression','click')),
  constraint ad_events_device_check check (device_type in ('desktop','tablet','mobile','unknown')),
  constraint ad_events_session_check check (char_length(session_id) between 8 and 120),
  constraint ad_events_route_check check (char_length(route_path) between 1 and 240)
);

create index if not exists ad_events_campaign_type_time_v144_idx
  on public.ad_events(campaign_id, event_type, occurred_at desc);
create index if not exists ad_events_placement_time_v144_idx
  on public.ad_events(placement_key, occurred_at desc);
create index if not exists ad_events_user_time_v144_idx
  on public.ad_events(user_id, occurred_at desc)
  where user_id is not null;
create index if not exists ad_events_session_time_v144_idx
  on public.ad_events(session_id, occurred_at desc);

alter table public.ad_events enable row level security;
revoke all on table public.ad_events from public, anon, authenticated;

create or replace function public.record_ad_event(
  p_campaign_id uuid,
  p_placement_key text,
  p_event_type text,
  p_session_id text,
  p_route_path text,
  p_device_type text default 'unknown'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_existing bigint;
  v_window interval;
begin
  if p_event_type not in ('impression','click') then
    raise exception 'invalid ad event type';
  end if;

  if char_length(btrim(coalesce(p_session_id,''))) < 8 then
    raise exception 'invalid ad session';
  end if;

  if not exists (
    select 1
    from public.ad_campaigns ac
    join public.ad_campaign_placements ap on ap.campaign_id = ac.id
    join public.ad_placements p on p.placement_key = ap.placement_key
    where ac.id = p_campaign_id
      and ap.placement_key = p_placement_key
      and p.enabled = true
      and ac.status = 'active'
      and coalesce(ac.starts_at, '-infinity'::timestamptz) <= now()
      and coalesce(ac.ends_at, 'infinity'::timestamptz) > now()
  ) then
    raise exception 'ad campaign is not active in this placement';
  end if;

  -- Prevent rerenders/double-clicks from inflating analytics while still
  -- allowing a billboard to earn another impression when it rotates back in.
  v_window := case when p_event_type = 'impression' then interval '20 seconds' else interval '2 seconds' end;

  select e.id into v_existing
  from public.ad_events e
  where e.campaign_id = p_campaign_id
    and e.placement_key = p_placement_key
    and e.event_type = p_event_type
    and e.session_id = left(btrim(p_session_id),120)
    and e.route_path = left(coalesce(nullif(btrim(p_route_path),''),'/'),240)
    and e.occurred_at >= now() - v_window
  order by e.occurred_at desc
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.ad_events(
    campaign_id,
    placement_key,
    event_type,
    user_id,
    session_id,
    route_path,
    device_type
  ) values (
    p_campaign_id,
    p_placement_key,
    p_event_type,
    auth.uid(),
    left(btrim(p_session_id),120),
    left(coalesce(nullif(btrim(p_route_path),''),'/'),240),
    case when p_device_type in ('desktop','tablet','mobile') then p_device_type else 'unknown' end
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_ad_event(uuid,text,text,text,text,text) from public;
grant execute on function public.record_ad_event(uuid,text,text,text,text,text) to anon, authenticated;

create or replace function public.admin_ad_analytics_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days,30), 365));
  v_result jsonb;
begin
  perform public.require_platform_admin();

  select jsonb_build_object(
    'days', v_days,
    'impressions', count(*) filter (where event_type='impression'),
    'clicks', count(*) filter (where event_type='click'),
    'identified_clickers', count(distinct user_id) filter (where event_type='click' and user_id is not null),
    'unique_click_sessions', count(distinct session_id) filter (where event_type='click'),
    'ctr', round(
      (count(*) filter (where event_type='click'))::numeric * 100
      / nullif((count(*) filter (where event_type='impression'))::numeric, 0),
      2
    )
  ) into v_result
  from public.ad_events
  where occurred_at >= now() - make_interval(days => v_days);

  return coalesce(v_result, jsonb_build_object(
    'days', v_days,
    'impressions', 0,
    'clicks', 0,
    'identified_clickers', 0,
    'unique_click_sessions', 0,
    'ctr', 0
  ));
end;
$$;

revoke all on function public.admin_ad_analytics_summary(integer) from public;
grant execute on function public.admin_ad_analytics_summary(integer) to authenticated;

create or replace function public.admin_ad_campaign_metrics(p_days integer default 30)
returns table (
  campaign_id uuid,
  brand_name text,
  campaign_name text,
  status text,
  impressions bigint,
  clicks bigint,
  identified_clickers bigint,
  unique_click_sessions bigint,
  ctr numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days,30), 365));
begin
  perform public.require_platform_admin();

  return query
  select
    ac.id::uuid,
    ac.brand_name::text,
    ac.campaign_name::text,
    ac.status::text,
    count(e.id) filter (where e.event_type='impression')::bigint,
    count(e.id) filter (where e.event_type='click')::bigint,
    count(distinct e.user_id) filter (where e.event_type='click' and e.user_id is not null)::bigint,
    count(distinct e.session_id) filter (where e.event_type='click')::bigint,
    coalesce(round(
      (count(e.id) filter (where e.event_type='click'))::numeric * 100
      / nullif((count(e.id) filter (where e.event_type='impression'))::numeric, 0),
      2
    ),0)::numeric
  from public.ad_campaigns ac
  left join public.ad_events e
    on e.campaign_id = ac.id
   and e.occurred_at >= now() - make_interval(days => v_days)
  group by ac.id, ac.brand_name, ac.campaign_name, ac.status, ac.created_at
  order by count(e.id) filter (where e.event_type='click') desc,
           count(e.id) filter (where e.event_type='impression') desc,
           ac.created_at desc;
end;
$$;

revoke all on function public.admin_ad_campaign_metrics(integer) from public;
grant execute on function public.admin_ad_campaign_metrics(integer) to authenticated;

create or replace function public.admin_recent_ad_clicks(
  p_days integer default 30,
  p_limit integer default 100
)
returns table (
  event_id bigint,
  occurred_at timestamptz,
  campaign_id uuid,
  brand_name text,
  campaign_name text,
  placement_key text,
  route_path text,
  device_type text,
  user_id uuid,
  display_name text,
  username text,
  email text,
  session_id text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days,30), 365));
  v_limit integer := greatest(1, least(coalesce(p_limit,100), 500));
begin
  perform public.require_platform_admin();

  return query
  select
    e.id::bigint,
    e.occurred_at::timestamptz,
    e.campaign_id::uuid,
    ac.brand_name::text,
    ac.campaign_name::text,
    e.placement_key::text,
    e.route_path::text,
    e.device_type::text,
    e.user_id::uuid,
    p.display_name::text,
    p.username::text,
    u.email::text,
    e.session_id::text
  from public.ad_events e
  join public.ad_campaigns ac on ac.id = e.campaign_id
  left join public.profiles p on p.id = e.user_id
  left join auth.users u on u.id = e.user_id
  where e.event_type = 'click'
    and e.occurred_at >= now() - make_interval(days => v_days)
  order by e.occurred_at desc
  limit v_limit;
end;
$$;

revoke all on function public.admin_recent_ad_clicks(integer,integer) from public;
grant execute on function public.admin_recent_ad_clicks(integer,integer) to authenticated;

-- Deployment health marker.
create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'v14.4-ad-analytics-click-tracking'::text;
$$;

revoke all on function public.get_dadofit_schema_version() from public;
grant execute on function public.get_dadofit_schema_version() to anon, authenticated;
