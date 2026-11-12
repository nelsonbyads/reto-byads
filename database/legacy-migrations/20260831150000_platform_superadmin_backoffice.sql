-- DadoFit V14 - Platform SuperAdmin Backoffice
-- Global platform administration, public support intake, advertising inventory,
-- user/brand administration and immutable platform audit trail.

alter table public.profiles
  add column if not exists platform_status text not null default 'active';

alter table public.profiles
  drop constraint if exists profiles_platform_status_check;
alter table public.profiles
  add constraint profiles_platform_status_check
  check (platform_status in ('active', 'suspended'));

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'superadmin' check (role in ('superadmin', 'support', 'auditor', 'commercial')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null,
  company text,
  request_type text not null,
  subject text not null,
  message text not null,
  status text not null default 'new',
  assigned_admin_id uuid references auth.users(id) on delete set null,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint support_requests_type_check check (request_type in ('support','commercial','advertising','gym_registration','brand_registration','report','other')),
  constraint support_requests_status_check check (status in ('new','reviewing','in_progress','responded','closed'))
);

create table if not exists public.ad_placements (
  placement_key text primary key,
  label text not null,
  format text not null,
  channel text not null check (channel in ('desktop','mobile')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  campaign_name text not null,
  image_url text,
  target_url text,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_campaigns_status_check check (status in ('draft','active','paused','completed','cancelled')),
  constraint ad_campaigns_window_check check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.ad_campaign_placements (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  placement_key text not null references public.ad_placements(placement_key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (campaign_id, placement_key)
);

create table if not exists public.admin_audit_log (
  id bigserial primary key,
  admin_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_requests_status_created_v14_idx on public.support_requests(status, created_at desc);
create index if not exists ad_campaigns_status_window_v14_idx on public.ad_campaigns(status, starts_at, ends_at);
create index if not exists admin_audit_created_v14_idx on public.admin_audit_log(created_at desc);
create index if not exists profiles_platform_status_v14_idx on public.profiles(platform_status);

insert into public.ad_placements (placement_key, label, format, channel)
values
  ('workout-left-top', 'Lateral izquierdo · superior', '300x600 / 160x600', 'desktop'),
  ('workout-left-middle', 'Lateral izquierdo · medio', '300x600 / 160x600', 'desktop'),
  ('workout-left-bottom', 'Lateral izquierdo · inferior', '300x600 / 160x600', 'desktop'),
  ('workout-right-top', 'Lateral derecho · superior', '300x600 / 160x600', 'desktop'),
  ('workout-right-middle', 'Lateral derecho · medio', '300x600 / 160x600', 'desktop'),
  ('workout-right-bottom', 'Lateral derecho · inferior', '300x600 / 160x600', 'desktop'),
  ('workout-mobile', 'Banner móvil inferior', '320x50', 'mobile')
on conflict (placement_key) do update
set label = excluded.label, format = excluded.format, channel = excluded.channel;

create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = coalesce(p_user_id, auth.uid())
      and pa.active = true
      and pa.role = 'superadmin'
  );
$$;

revoke all on function public.is_platform_admin(uuid) from public;
grant execute on function public.is_platform_admin(uuid) to authenticated;

create or replace function public.require_platform_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_platform_admin(auth.uid()) then
    raise exception 'platform superadmin required';
  end if;
end;
$$;

revoke all on function public.require_platform_admin() from public, anon, authenticated;

create or replace function public.get_my_platform_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.platform_status from public.profiles p where p.id = auth.uid()), 'active');
$$;

revoke all on function public.get_my_platform_status() from public;
grant execute on function public.get_my_platform_status() to authenticated;

create or replace function public.enforce_profile_platform_status_v14()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.platform_status is distinct from old.platform_status
     and not public.is_platform_admin(auth.uid()) then
    raise exception 'only platform superadmin can change platform status';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_platform_status_guard_v14 on public.profiles;
create trigger profiles_platform_status_guard_v14
before update of platform_status on public.profiles
for each row execute function public.enforce_profile_platform_status_v14();

create or replace function public.write_admin_audit_v14(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_log(admin_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.write_admin_audit_v14(text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;

create or replace function public.submit_support_request(
  p_name text,
  p_email text,
  p_company text,
  p_request_type text,
  p_subject text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if length(btrim(coalesce(p_name, ''))) < 2 or length(btrim(p_name)) > 100 then raise exception 'invalid name'; end if;
  if length(btrim(coalesce(p_email, ''))) < 5 or position('@' in p_email) = 0 or length(btrim(p_email)) > 200 then raise exception 'invalid email'; end if;
  if p_request_type not in ('support','commercial','advertising','gym_registration','brand_registration','report','other') then raise exception 'invalid request type'; end if;
  if length(btrim(coalesce(p_subject, ''))) < 3 or length(btrim(p_subject)) > 160 then raise exception 'invalid subject'; end if;
  if length(btrim(coalesce(p_message, ''))) < 10 or length(btrim(p_message)) > 4000 then raise exception 'message must have between 10 and 4000 characters'; end if;

  insert into public.support_requests(requester_user_id, name, email, company, request_type, subject, message)
  values (
    auth.uid(), left(btrim(p_name),100), lower(left(btrim(p_email),200)), nullif(left(btrim(coalesce(p_company,'')),160),''),
    p_request_type, left(btrim(p_subject),160), left(btrim(p_message),4000)
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_support_request(text,text,text,text,text,text) from public;
grant execute on function public.submit_support_request(text,text,text,text,text,text) to anon, authenticated;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'active_users', (select count(*) from public.profiles where platform_status = 'active'),
    'suspended_users', (select count(*) from public.profiles where platform_status = 'suspended'),
    'gyms', (select count(*) from public.organizations where organization_type = 'gym'),
    'brands', (select count(*) from public.organizations where organization_type in ('brand','sponsor','company')),
    'pending_brands', (select count(*) from public.organizations where organization_type in ('brand','sponsor','company') and verification_status = 'pending_verification'),
    'campaigns', (select count(*) from public.sponsor_campaigns),
    'sponsored_challenges', (select count(*) from public.challenges where challenge_type = 'sponsored'),
    'pending_evidence', (select count(*) from public.challenge_participants where status in ('submitted','pending_audit')),
    'coins_granted', (select coalesce(sum(reward_coins_granted),0) from public.challenge_participants),
    'xp_granted', (select coalesce(sum(reward_xp_granted),0) from public.challenge_participants),
    'new_requests', (select count(*) from public.support_requests where status = 'new'),
    'active_ads', (select count(*) from public.ad_campaigns where status = 'active' and coalesce(starts_at, now()) <= now() and coalesce(ends_at, now() + interval '100 years') > now())
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public;
grant execute on function public.admin_dashboard_stats() to authenticated;

create or replace function public.admin_list_users(p_search text default null)
returns table (
  user_id uuid,
  email text,
  display_name text,
  username text,
  platform_status text,
  created_at timestamptz,
  xp bigint,
  level integer,
  dadocoins bigint,
  organizations integer,
  squads integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  return query
  select
    p.id,
    u.email::text,
    p.display_name::text,
    p.username::text,
    p.platform_status::text,
    u.created_at,
    coalesce(up.xp,0)::bigint,
    coalesce(up.level,1)::integer,
    coalesce(w.balance,0)::bigint,
    (select count(*)::integer from public.organization_members om where om.user_id = p.id and om.status = 'active'),
    (select count(*)::integer from public.group_members gm where gm.user_id = p.id and gm.status = 'active')
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.user_progress up on up.user_id = p.id
  left join public.wallets w on w.user_id = p.id
  where p_search is null
     or btrim(p_search) = ''
     or lower(coalesce(u.email,'')) like '%' || lower(btrim(p_search)) || '%'
     or lower(coalesce(p.username,'')) like '%' || lower(btrim(p_search)) || '%'
     or lower(coalesce(p.display_name,'')) like '%' || lower(btrim(p_search)) || '%'
     or p.id::text = btrim(p_search)
  order by u.created_at desc
  limit 250;
end;
$$;

revoke all on function public.admin_list_users(text) from public;
grant execute on function public.admin_list_users(text) to authenticated;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform public.require_platform_admin();
  if p_status not in ('active','suspended') then raise exception 'invalid platform status'; end if;
  if p_user_id = auth.uid() and p_status = 'suspended' then raise exception 'you cannot suspend your own superadmin account'; end if;

  select to_jsonb(p) into v_before from public.profiles p where p.id = p_user_id;
  if v_before is null then raise exception 'user profile not found'; end if;

  update public.profiles set platform_status = p_status where id = p_user_id;
  select to_jsonb(p) into v_after from public.profiles p where p.id = p_user_id;
  perform public.write_admin_audit_v14('user.status.change','user',p_user_id::text,v_before,v_after,jsonb_build_object('reason',nullif(btrim(coalesce(p_reason,'')),'')));
  return p_status;
end;
$$;

revoke all on function public.admin_set_user_status(uuid,text,text) from public;
grant execute on function public.admin_set_user_status(uuid,text,text) to authenticated;

create or replace function public.admin_list_organizations()
returns table (
  organization_id uuid,
  name text,
  organization_type text,
  verification_status text,
  owner_user_id uuid,
  owner_name text,
  owner_email text,
  members integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  return query
  select
    o.id, o.name::text, o.organization_type::text, o.verification_status::text, o.owner_user_id,
    coalesce(p.display_name,p.username,'Sin nombre')::text,
    u.email::text,
    (select count(*)::integer from public.organization_members om where om.organization_id = o.id and om.status = 'active'),
    o.created_at
  from public.organizations o
  left join public.profiles p on p.id = o.owner_user_id
  left join auth.users u on u.id = o.owner_user_id
  order by o.created_at desc;
end;
$$;

revoke all on function public.admin_list_organizations() from public;
grant execute on function public.admin_list_organizations() to authenticated;

create or replace function public.admin_set_brand_verification(p_organization_id uuid, p_status text, p_reason text default null)
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
  if p_status not in ('pending_verification','verified','rejected','suspended') then raise exception 'invalid verification status'; end if;

  select organization_type, to_jsonb(o) into v_type, v_before from public.organizations o where o.id = p_organization_id;
  if v_before is null then raise exception 'organization not found'; end if;
  if v_type not in ('brand','sponsor','company') then raise exception 'verification workflow applies only to Brand/Sponsor/Company'; end if;

  update public.organizations set verification_status = p_status, updated_at = now() where id = p_organization_id;
  select to_jsonb(o) into v_after from public.organizations o where o.id = p_organization_id;
  perform public.write_admin_audit_v14('brand.verification.change','organization',p_organization_id::text,v_before,v_after,jsonb_build_object('reason',nullif(btrim(coalesce(p_reason,'')),'')));
  return p_status;
end;
$$;

revoke all on function public.admin_set_brand_verification(uuid,text,text) from public;
grant execute on function public.admin_set_brand_verification(uuid,text,text) to authenticated;

create or replace function public.admin_list_campaigns()
returns table (
  campaign_id uuid,
  organization_id uuid,
  organization_name text,
  campaign_name text,
  status text,
  requires_double_validation boolean,
  max_participants integer,
  default_reward_coins integer,
  default_reward_xp integer,
  challenges integer,
  participants integer,
  approved integer,
  rejected integer,
  coins_granted bigint,
  xp_granted bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  return query
  select
    sc.id, sc.organization_id, o.name::text, sc.name::text, sc.status::text,
    coalesce(sc.requires_double_validation,false), sc.max_participants,
    sc.default_reward_coins, sc.default_reward_xp,
    (select count(*)::integer from public.challenges c where c.sponsor_campaign_id = sc.id),
    (select count(*)::integer from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id where c.sponsor_campaign_id = sc.id),
    (select count(*)::integer from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id where c.sponsor_campaign_id = sc.id and cp.status = 'approved'),
    (select count(*)::integer from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id where c.sponsor_campaign_id = sc.id and cp.status = 'rejected'),
    (select coalesce(sum(cp.reward_coins_granted),0)::bigint from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id where c.sponsor_campaign_id = sc.id),
    (select coalesce(sum(cp.reward_xp_granted),0)::bigint from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id where c.sponsor_campaign_id = sc.id),
    sc.created_at
  from public.sponsor_campaigns sc
  join public.organizations o on o.id = sc.organization_id
  order by sc.created_at desc;
end;
$$;

revoke all on function public.admin_list_campaigns() from public;
grant execute on function public.admin_list_campaigns() to authenticated;

create or replace function public.admin_list_support_requests(p_status text default null)
returns setof public.support_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  return query
  select * from public.support_requests sr
  where p_status is null or sr.status = p_status
  order by sr.created_at desc
  limit 500;
end;
$$;

revoke all on function public.admin_list_support_requests(text) from public;
grant execute on function public.admin_list_support_requests(text) to authenticated;

create or replace function public.admin_update_support_request(
  p_request_id uuid,
  p_status text,
  p_admin_notes text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform public.require_platform_admin();
  if p_status not in ('new','reviewing','in_progress','responded','closed') then raise exception 'invalid request status'; end if;
  select to_jsonb(sr) into v_before from public.support_requests sr where sr.id = p_request_id;
  if v_before is null then raise exception 'request not found'; end if;

  update public.support_requests
  set status = p_status,
      assigned_admin_id = case when p_status = 'new' then assigned_admin_id else auth.uid() end,
      admin_notes = case when p_admin_notes is null then admin_notes else nullif(left(btrim(p_admin_notes),2000),'') end,
      updated_at = now(),
      closed_at = case when p_status = 'closed' then now() else null end
  where id = p_request_id;

  select to_jsonb(sr) into v_after from public.support_requests sr where sr.id = p_request_id;
  perform public.write_admin_audit_v14('support_request.status.change','support_request',p_request_id::text,v_before,v_after,'{}'::jsonb);
  return p_status;
end;
$$;

revoke all on function public.admin_update_support_request(uuid,text,text) from public;
grant execute on function public.admin_update_support_request(uuid,text,text) to authenticated;

create or replace function public.admin_create_ad_campaign(
  p_brand_name text,
  p_campaign_name text,
  p_image_url text default null,
  p_target_url text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_platform_admin();
  if length(btrim(coalesce(p_brand_name,''))) < 2 or length(btrim(p_brand_name)) > 120 then raise exception 'invalid brand name'; end if;
  if length(btrim(coalesce(p_campaign_name,''))) < 2 or length(btrim(p_campaign_name)) > 160 then raise exception 'invalid campaign name'; end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at then raise exception 'invalid campaign window'; end if;

  insert into public.ad_campaigns(brand_name,campaign_name,image_url,target_url,starts_at,ends_at,created_by)
  values (left(btrim(p_brand_name),120),left(btrim(p_campaign_name),160),nullif(left(btrim(coalesce(p_image_url,'')),1000),''),nullif(left(btrim(coalesce(p_target_url,'')),1000),''),p_starts_at,p_ends_at,auth.uid())
  returning id into v_id;

  perform public.write_admin_audit_v14('ad_campaign.create','ad_campaign',v_id::text,null,(select to_jsonb(ac) from public.ad_campaigns ac where ac.id=v_id),'{}'::jsonb);
  return v_id;
end;
$$;

revoke all on function public.admin_create_ad_campaign(text,text,text,text,timestamptz,timestamptz) from public;
grant execute on function public.admin_create_ad_campaign(text,text,text,text,timestamptz,timestamptz) to authenticated;

create or replace function public.admin_assign_ad_placement(p_campaign_id uuid, p_placement_key text, p_enabled boolean default true)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  if not exists(select 1 from public.ad_campaigns where id=p_campaign_id) then raise exception 'ad campaign not found'; end if;
  if not exists(select 1 from public.ad_placements where placement_key=p_placement_key and enabled) then raise exception 'ad placement not found or disabled'; end if;

  if coalesce(p_enabled,true) then
    insert into public.ad_campaign_placements(campaign_id,placement_key) values(p_campaign_id,p_placement_key)
    on conflict do nothing;
  else
    delete from public.ad_campaign_placements where campaign_id=p_campaign_id and placement_key=p_placement_key;
  end if;

  perform public.write_admin_audit_v14('ad_campaign.placement.change','ad_campaign',p_campaign_id::text,null,null,jsonb_build_object('placement',p_placement_key,'enabled',coalesce(p_enabled,true)));
  return coalesce(p_enabled,true);
end;
$$;

revoke all on function public.admin_assign_ad_placement(uuid,text,boolean) from public;
grant execute on function public.admin_assign_ad_placement(uuid,text,boolean) to authenticated;

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
  v_conflict text;
begin
  perform public.require_platform_admin();
  if p_status not in ('draft','active','paused','completed','cancelled') then raise exception 'invalid ad campaign status'; end if;

  select * into v_campaign from public.ad_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'ad campaign not found'; end if;
  v_before := to_jsonb(v_campaign);

  if p_status='active' then
    if not exists(select 1 from public.ad_campaign_placements where campaign_id=p_campaign_id) then raise exception 'assign at least one placement before activation'; end if;
    select acp.placement_key into v_conflict
    from public.ad_campaign_placements acp
    where acp.campaign_id=p_campaign_id
      and exists (
        select 1
        from public.ad_campaign_placements otherp
        join public.ad_campaigns otherc on otherc.id=otherp.campaign_id
        where otherp.placement_key=acp.placement_key
          and otherc.id<>p_campaign_id
          and otherc.status='active'
          and coalesce(otherc.starts_at,'-infinity'::timestamptz) < coalesce(v_campaign.ends_at,'infinity'::timestamptz)
          and coalesce(otherc.ends_at,'infinity'::timestamptz) > coalesce(v_campaign.starts_at,'-infinity'::timestamptz)
      )
    limit 1;
    if v_conflict is not null then raise exception 'placement % already has an overlapping active campaign',v_conflict; end if;
  end if;

  update public.ad_campaigns set status=p_status,updated_at=now() where id=p_campaign_id;
  select to_jsonb(ac) into v_after from public.ad_campaigns ac where ac.id=p_campaign_id;
  perform public.write_admin_audit_v14('ad_campaign.status.change','ad_campaign',p_campaign_id::text,v_before,v_after,'{}'::jsonb);
  return p_status;
end;
$$;

revoke all on function public.admin_set_ad_campaign_status(uuid,text) from public;
grant execute on function public.admin_set_ad_campaign_status(uuid,text) to authenticated;

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
  select ac.id, ac.brand_name, ac.campaign_name, ac.image_url, ac.target_url, ac.starts_at, ac.ends_at
  from public.ad_campaigns ac
  join public.ad_campaign_placements ap on ap.campaign_id=ac.id
  join public.ad_placements p on p.placement_key=ap.placement_key
  where ap.placement_key=p_placement_key
    and p.enabled=true
    and ac.status='active'
    and coalesce(ac.starts_at,'-infinity'::timestamptz) <= now()
    and coalesce(ac.ends_at,'infinity'::timestamptz) > now()
  order by ac.starts_at desc nulls last, ac.created_at desc
  limit 1;
$$;

revoke all on function public.get_active_ad(text) from public;
grant execute on function public.get_active_ad(text) to anon, authenticated;

create or replace function public.admin_list_audit(p_limit integer default 200)
returns setof public.admin_audit_log
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  return query select * from public.admin_audit_log order by created_at desc limit greatest(1,least(coalesce(p_limit,200),1000));
end;
$$;

revoke all on function public.admin_list_audit(integer) from public;
grant execute on function public.admin_list_audit(integer) to authenticated;

create or replace function public.admin_list_challenge_reviews(p_limit integer default 150)
returns table (
  review_id uuid,
  created_at timestamptz,
  review_stage text,
  decision text,
  notes text,
  participant_id uuid,
  participant_name text,
  reviewer_name text,
  exercise_name text,
  challenge_type text,
  organization_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  return query
  select cr.id,cr.created_at,cr.review_stage::text,cr.decision::text,cr.notes::text,cr.participant_id,
    coalesce(pp.display_name,pp.username,'Gymbro')::text,
    coalesce(rp.display_name,rp.username,'Reviewer')::text,
    c.exercise_name::text,c.challenge_type::text,o.name::text
  from public.challenge_reviews cr
  join public.challenge_participants cp on cp.id=cr.participant_id
  join public.challenges c on c.id=cp.challenge_id
  join public.profiles pp on pp.id=cp.user_id
  left join public.profiles rp on rp.id=cr.reviewer_user_id
  left join public.organizations o on o.id=c.creator_organization_id
  order by cr.created_at desc
  limit greatest(1,least(coalesce(p_limit,150),1000));
end;
$$;

revoke all on function public.admin_list_challenge_reviews(integer) from public;
grant execute on function public.admin_list_challenge_reviews(integer) to authenticated;

alter table public.platform_admins enable row level security;
alter table public.support_requests enable row level security;
alter table public.ad_placements enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_campaign_placements enable row level security;
alter table public.admin_audit_log enable row level security;

drop policy if exists platform_admins_read_self_v14 on public.platform_admins;
create policy platform_admins_read_self_v14 on public.platform_admins for select to authenticated using (user_id=auth.uid());

drop policy if exists support_requests_admin_v14 on public.support_requests;
create policy support_requests_admin_v14 on public.support_requests for select to authenticated using (public.is_platform_admin(auth.uid()));

drop policy if exists ad_placements_admin_v14 on public.ad_placements;
create policy ad_placements_admin_v14 on public.ad_placements for select to authenticated using (public.is_platform_admin(auth.uid()));

drop policy if exists ad_campaigns_admin_v14 on public.ad_campaigns;
create policy ad_campaigns_admin_v14 on public.ad_campaigns for select to authenticated using (public.is_platform_admin(auth.uid()));

drop policy if exists ad_campaign_placements_admin_v14 on public.ad_campaign_placements;
create policy ad_campaign_placements_admin_v14 on public.ad_campaign_placements for select to authenticated using (public.is_platform_admin(auth.uid()));

drop policy if exists admin_audit_read_v14 on public.admin_audit_log;
create policy admin_audit_read_v14 on public.admin_audit_log for select to authenticated using (public.is_platform_admin(auth.uid()));

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v14-platform-superadmin-backoffice',
    'workspace_model', 'personal+organization',
    'brand_double_validation', true,
    'brand_audit_trail', true,
    'platform_superadmin', true,
    'support_requests', true,
    'ad_inventory', 7,
    'admin_audit_log', true,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
