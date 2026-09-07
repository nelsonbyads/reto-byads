-- DadoFit V15.7 - Pre-Release Feature Pack
-- 1) TP/GP Seasons foundation on top of the existing seasons + score_events tables.
-- 2) Sponsored Gym Competitions managed by verified Brand workspaces.
-- 3) Season-aware challenge attribution without deleting historical score events.

alter table public.seasons
  add column if not exists season_type text not null default 'mixed',
  add column if not exists description text,
  add column if not exists sponsor_organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.seasons
  drop constraint if exists seasons_type_check;
alter table public.seasons
  add constraint seasons_type_check
  check (season_type in ('mixed','squad','gym','sponsored_gym'));

create index if not exists seasons_type_status_range_v157_idx
  on public.seasons (season_type, status, starts_at, ends_at);
create index if not exists seasons_sponsor_v157_idx
  on public.seasons (sponsor_organization_id, created_at desc);

create table if not exists public.season_organization_entries (
  season_id uuid not null references public.seasons(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','active','declined','removed')),
  invited_by_organization_id uuid references public.organizations(id) on delete set null,
  responded_by_user_id uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (season_id, organization_id)
);

create index if not exists season_org_entries_org_status_v157_idx
  on public.season_organization_entries (organization_id, status, updated_at desc);

alter table public.season_organization_entries enable row level security;
revoke all privileges on table public.season_organization_entries from anon, authenticated;
grant select on table public.season_organization_entries to authenticated;

drop policy if exists season_org_entries_read_authenticated_v157 on public.season_organization_entries;
create policy season_org_entries_read_authenticated_v157
on public.season_organization_entries for select
to authenticated
using (true);

-- Keep updated_at coherent for tables that now expose mutable season state.
drop trigger if exists seasons_set_updated_at_v157 on public.seasons;
create trigger seasons_set_updated_at_v157
before update on public.seasons
for each row execute function public.set_updated_at();

drop trigger if exists season_org_entries_set_updated_at_v157 on public.season_organization_entries;
create trigger season_org_entries_set_updated_at_v157
before update on public.season_organization_entries
for each row execute function public.set_updated_at();

-- Seed one active Squad season and one active Gym season for the current month only
-- when the project has no active season of that type. This gives the feature an
-- immediately testable baseline without rewriting historical ledgers.
insert into public.seasons (name, slug, season_type, status, starts_at, ends_at, metadata)
select
  'Temporada Squad · ' || to_char(current_date, 'TMMonth YYYY'),
  'v157-squad-' || to_char(current_date, 'YYYY-MM'),
  'squad',
  'active',
  date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month',
  jsonb_build_object('seeded_by','v15.7','points_label','TP')
where not exists (
  select 1 from public.seasons
  where season_type='squad' and status='active' and now()>=starts_at and now()<ends_at
)
on conflict (slug) do nothing;

insert into public.seasons (name, slug, season_type, status, starts_at, ends_at, metadata)
select
  'Temporada Gym · ' || to_char(current_date, 'TMMonth YYYY'),
  'v157-gym-' || to_char(current_date, 'YYYY-MM'),
  'gym',
  'active',
  date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month',
  jsonb_build_object('seeded_by','v15.7','points_label','GP')
where not exists (
  select 1 from public.seasons
  where season_type='gym' and status='active' and now()>=starts_at and now()<ends_at
)
on conflict (slug) do nothing;

-- Automatically attach new score-bearing challenges to the current global
-- season. Sponsored Gym Competitions deliberately do not own score_events:
-- they aggregate GP by their own date window so multiple sponsored activations
-- may coexist without stealing points from the global Gym season.
create or replace function public.assign_challenge_season_v157()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season_id uuid;
begin
  if new.season_id is not null then
    return new;
  end if;

  if new.challenge_type='group' then
    select s.id into v_season_id
    from public.seasons s
    where s.season_type='squad'
      and s.status in ('active','upcoming')
      and new.starts_at>=s.starts_at
      and new.starts_at<s.ends_at
    order by s.starts_at desc
    limit 1;
  elsif new.challenge_type='organization' then
    select s.id into v_season_id
    from public.seasons s
    where s.season_type='gym'
      and s.status in ('active','upcoming')
      and new.starts_at>=s.starts_at
      and new.starts_at<s.ends_at
    order by s.starts_at desc
    limit 1;
  end if;

  new.season_id := v_season_id;
  return new;
end;
$$;

revoke all on function public.assign_challenge_season_v157() from public, anon, authenticated;

drop trigger if exists challenges_assign_season_v157 on public.challenges;
create trigger challenges_assign_season_v157
before insert or update of challenge_type, starts_at, season_id on public.challenges
for each row execute function public.assign_challenge_season_v157();

-- Backfill active/current challenges too, so approvals that happen after this
-- migration inherit the season even when the challenge was published before V15.7.
update public.challenges c
set season_id = s.id
from public.seasons s
where c.season_id is null
  and c.challenge_type='group'
  and s.season_type='squad'
  and s.status in ('active','upcoming','completed')
  and c.starts_at>=s.starts_at and c.starts_at<s.ends_at;

update public.challenges c
set season_id = s.id
from public.seasons s
where c.season_id is null
  and c.challenge_type='organization'
  and s.season_type='gym'
  and s.status in ('active','upcoming','completed')
  and c.starts_at>=s.starts_at and c.starts_at<s.ends_at;

-- Backfill score events created inside the currently active month seasons.
update public.score_events se
set season_id = s.id
from public.seasons s
where se.season_id is null
  and se.team_points > 0
  and s.season_type='squad'
  and se.created_at>=s.starts_at
  and se.created_at<s.ends_at
  and s.status in ('active','completed');

update public.score_events se
set season_id = s.id
from public.seasons s
where se.season_id is null
  and se.sponsor_points > 0
  and s.season_type='gym'
  and se.created_at>=s.starts_at
  and se.created_at<s.ends_at
  and s.status in ('active','completed');

-- Public/authenticated season hub. Rankings are derived from immutable
-- score_events so there is no destructive reset at season close.
create or replace function public.get_season_hub()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_squad jsonb := null;
  v_gym jsonb := null;
  v_sponsored jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select jsonb_build_object(
    'id',s.id,'name',s.name,'status',case when s.status='cancelled' then 'cancelled' when now()>=s.ends_at then 'completed' when now()>=s.starts_at then 'active' else 'upcoming' end,'starts_at',s.starts_at,'ends_at',s.ends_at,'season_type',s.season_type,
    'leaderboard',coalesce((
      select jsonb_agg(x order by (x->>'points')::bigint desc, x->>'name')
      from (
        select jsonb_build_object(
          'id',g.id,'name',g.name,'points',coalesce(sum(se.team_points),0),
          'completed',count(se.id) filter (where se.team_points>0)
        ) x
        from public.groups g
        left join public.score_events se on se.group_id=g.id and se.season_id=s.id
        group by g.id,g.name
        having coalesce(sum(se.team_points),0)>0
        order by coalesce(sum(se.team_points),0) desc
        limit 50
      ) q
    ),'[]'::jsonb)
  ) into v_squad
  from public.seasons s
  where s.season_type='squad' and s.status<>'cancelled'
  order by case when now()>=s.starts_at and now()<s.ends_at then 0 when s.starts_at>now() then 1 else 2 end,
           case when s.starts_at>now() then s.starts_at end asc, s.ends_at desc
  limit 1;

  select jsonb_build_object(
    'id',s.id,'name',s.name,'status',case when s.status='cancelled' then 'cancelled' when now()>=s.ends_at then 'completed' when now()>=s.starts_at then 'active' else 'upcoming' end,'starts_at',s.starts_at,'ends_at',s.ends_at,'season_type',s.season_type,
    'leaderboard',coalesce((
      select jsonb_agg(x order by (x->>'points')::bigint desc, x->>'name')
      from (
        select jsonb_build_object(
          'id',o.id,'name',o.name,'points',coalesce(sum(se.sponsor_points),0),
          'completed',count(se.id) filter (where se.sponsor_points>0)
        ) x
        from public.organizations o
        left join public.score_events se on se.organization_id=o.id and se.season_id=s.id
        where o.organization_type='gym'
        group by o.id,o.name
        having coalesce(sum(se.sponsor_points),0)>0
        order by coalesce(sum(se.sponsor_points),0) desc
        limit 50
      ) q
    ),'[]'::jsonb)
  ) into v_gym
  from public.seasons s
  where s.season_type='gym' and s.status<>'cancelled'
  order by case when now()>=s.starts_at and now()<s.ends_at then 0 when s.starts_at>now() then 1 else 2 end,
           case when s.starts_at>now() then s.starts_at end asc, s.ends_at desc
  limit 1;

  select coalesce(jsonb_agg(item order by item->>'ends_at'),'[]'::jsonb)
  into v_sponsored
  from (
    select jsonb_build_object(
      'id',s.id,
      'name',s.name,
      'description',s.description,
      'status',case when s.status='cancelled' then 'cancelled' when now()>=s.ends_at then 'completed' when now()>=s.starts_at then 'active' else 'upcoming' end,
      'starts_at',s.starts_at,
      'ends_at',s.ends_at,
      'sponsor_organization_id',s.sponsor_organization_id,
      'sponsor_name',sp.name,
      'entries',coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization_id',e.organization_id,
          'organization_name',o.name,
          'status',e.status,
          'points',coalesce((
            select sum(se.sponsor_points)
            from public.score_events se
            where se.organization_id=e.organization_id
              and se.created_at>=s.starts_at
              and se.created_at<s.ends_at
          ),0)
        ) order by o.name)
        from public.season_organization_entries e
        join public.organizations o on o.id=e.organization_id
        where e.season_id=s.id
      ),'[]'::jsonb),
      'leaderboard',coalesce((
        select jsonb_agg(rank_row order by (rank_row->>'points')::bigint desc, rank_row->>'name')
        from (
          select jsonb_build_object(
            'id',e.organization_id,
            'name',o.name,
            'points',coalesce(sum(se.sponsor_points),0)
          ) rank_row
          from public.season_organization_entries e
          join public.organizations o on o.id=e.organization_id
          left join public.score_events se
            on se.organization_id=e.organization_id
           and se.created_at>=s.starts_at
           and se.created_at<s.ends_at
          where e.season_id=s.id and e.status='active'
          group by e.organization_id,o.name
          order by coalesce(sum(se.sponsor_points),0) desc
        ) q
      ),'[]'::jsonb)
    ) item
    from public.seasons s
    join public.organizations sp on sp.id=s.sponsor_organization_id
    where s.season_type='sponsored_gym'
      and s.status in ('upcoming','active','completed')
      and s.ends_at>now()-interval '90 days'
  ) q;

  select coalesce(jsonb_agg(item order by item->>'ends_at' desc),'[]'::jsonb)
  into v_history
  from (
    select jsonb_build_object(
      'id',s.id,'name',s.name,'season_type',s.season_type,'starts_at',s.starts_at,'ends_at',s.ends_at,
      'status',case when now()>=s.ends_at then 'completed' else s.status end
    ) item
    from public.seasons s
    where s.season_type in ('squad','gym')
      and s.status<>'cancelled'
      and s.ends_at<=now()
    order by s.ends_at desc
    limit 12
  ) recent;

  return jsonb_build_object('squad',v_squad,'gym',v_gym,'sponsored_gym',v_sponsored,'history',v_history);
end;
$$;

revoke all on function public.get_season_hub() from public;
grant execute on function public.get_season_hub() to authenticated;

-- SuperAdmin management for global Squad/Gym seasons.
create or replace function public.admin_create_competitive_season(
  p_name text,
  p_season_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_slug text;
  v_status text;
begin
  perform public.require_platform_admin();
  if p_season_type not in ('squad','gym') then raise exception 'season type must be squad or gym'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'invalid season dates'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'season name is required'; end if;

  if exists (
    select 1 from public.seasons s
    where s.season_type=p_season_type
      and s.status in ('upcoming','active')
      and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
  ) then raise exception 'another % season overlaps this range', p_season_type; end if;

  v_slug := p_season_type || '-' || to_char(p_starts_at,'YYYYMMDDHH24MI') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  v_status := case when now()>=p_ends_at then 'completed' when now()>=p_starts_at then 'active' else 'upcoming' end;

  insert into public.seasons(name,slug,season_type,status,starts_at,ends_at,metadata)
  values(left(btrim(p_name),120),v_slug,p_season_type,v_status,p_starts_at,p_ends_at,jsonb_build_object('created_by','superadmin'))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.admin_create_competitive_season(text,text,timestamptz,timestamptz) from public;
grant execute on function public.admin_create_competitive_season(text,text,timestamptz,timestamptz) to authenticated;

create or replace function public.admin_list_competitive_seasons()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name,'season_type',s.season_type,'status',s.status,
      'starts_at',s.starts_at,'ends_at',s.ends_at,
      'score_events',coalesce((select count(*) from public.score_events se where se.season_id=s.id),0)
    ) order by s.starts_at desc)
    from public.seasons s
    where s.season_type in ('squad','gym')
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_competitive_seasons() from public;
grant execute on function public.admin_list_competitive_seasons() to authenticated;

create or replace function public.admin_set_competitive_season_status(p_season_id uuid,p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  if p_status not in ('upcoming','active','completed','cancelled') then raise exception 'invalid season status'; end if;
  if p_status='active' and exists (
    select 1 from public.seasons current_s
    join public.seasons target on target.id=p_season_id
    where current_s.id<>target.id
      and current_s.season_type=target.season_type
      and current_s.status='active'
      and tstzrange(current_s.starts_at,current_s.ends_at,'[)') && tstzrange(target.starts_at,target.ends_at,'[)')
  ) then raise exception 'another active season overlaps this range'; end if;
  update public.seasons set status=p_status where id=p_season_id and season_type in ('squad','gym');
  if not found then raise exception 'season not found'; end if;
  return true;
end;
$$;

revoke all on function public.admin_set_competitive_season_status(uuid,text) from public;
grant execute on function public.admin_set_competitive_season_status(uuid,text) to authenticated;

-- Brand-sponsored Gym competition lifecycle.
create or replace function public.brand_create_sponsored_gym_competition(
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_gym_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_brand public.organizations%rowtype;
  v_id uuid;
  v_slug text;
  v_status text;
  v_gym uuid;
  v_gym_name text;
  v_manager record;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.is_organization_admin(p_organization_id) then raise exception 'owner or admin required'; end if;
  select * into v_brand from public.organizations where id=p_organization_id;
  if not found or v_brand.organization_type not in ('brand','sponsor','company') then raise exception 'Brand workspace required'; end if;
  if v_brand.verification_status<>'verified' then raise exception 'Brand must be verified'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'competition name is required'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'invalid competition dates'; end if;
  if coalesce(array_length(p_gym_ids,1),0)<2 then raise exception 'select at least two Gyms'; end if;

  if exists (
    select 1 from unnest(p_gym_ids) g(id)
    left join public.organizations o on o.id=g.id
    where o.id is null or o.organization_type<>'gym' or o.verification_status<>'verified'
  ) then raise exception 'all competitors must be verified Gyms'; end if;

  v_slug := 'sponsored-gym-' || to_char(p_starts_at,'YYYYMMDDHH24MI') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  v_status := case when now()>=p_ends_at then 'completed' when now()>=p_starts_at then 'active' else 'upcoming' end;

  insert into public.seasons(name,slug,season_type,status,starts_at,ends_at,description,sponsor_organization_id,metadata)
  values(left(btrim(p_name),120),v_slug,'sponsored_gym',v_status,p_starts_at,p_ends_at,nullif(left(btrim(coalesce(p_description,'')),1000),''),p_organization_id,
    jsonb_build_object('created_by_user_id',v_actor,'points_label','GP'))
  returning id into v_id;

  for v_gym in select distinct unnest(p_gym_ids)
  loop
    insert into public.season_organization_entries(season_id,organization_id,status,invited_by_organization_id)
    values(v_id,v_gym,'invited',p_organization_id)
    on conflict (season_id,organization_id) do nothing;

    select name into v_gym_name from public.organizations where id=v_gym;
    for v_manager in
      select om.user_id from public.organization_members om
      where om.organization_id=v_gym and om.status='active' and om.role in ('owner','admin')
    loop
      insert into public.notifications(user_id,notification_type,title,body,data)
      values(v_manager.user_id,'sponsored_gym_competition_invited',
        'Invitación a competencia patrocinada',
        format('%s te invita a “%s”. Compite con GP del %s al %s.',v_brand.name,left(btrim(p_name),120),to_char(p_starts_at,'DD/MM/YYYY'),to_char(p_ends_at,'DD/MM/YYYY')),
        jsonb_build_object('season_id',v_id,'organization_id',v_gym,'sponsor_organization_id',p_organization_id,'route','/seasons'));
    end loop;
  end loop;
  return v_id;
end;
$$;

revoke all on function public.brand_create_sponsored_gym_competition(uuid,text,text,timestamptz,timestamptz,uuid[]) from public;
grant execute on function public.brand_create_sponsored_gym_competition(uuid,text,text,timestamptz,timestamptz,uuid[]) to authenticated;

create or replace function public.brand_list_sponsored_gym_competitions(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.is_organization_member(p_organization_id) then raise exception 'organization membership required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name,'description',s.description,'status',case when s.status='cancelled' then 'cancelled' when now()>=s.ends_at then 'completed' when now()>=s.starts_at then 'active' else 'upcoming' end,'starts_at',s.starts_at,'ends_at',s.ends_at,
      'entries',coalesce((select jsonb_agg(jsonb_build_object(
        'organization_id',e.organization_id,'organization_name',o.name,'status',e.status,
        'points',coalesce((select sum(se.sponsor_points) from public.score_events se where se.organization_id=e.organization_id and se.created_at>=s.starts_at and se.created_at<s.ends_at),0)
      ) order by o.name) from public.season_organization_entries e join public.organizations o on o.id=e.organization_id where e.season_id=s.id),'[]'::jsonb)
    ) order by s.created_at desc)
    from public.seasons s
    where s.season_type='sponsored_gym' and s.sponsor_organization_id=p_organization_id
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.brand_list_sponsored_gym_competitions(uuid) from public;
grant execute on function public.brand_list_sponsored_gym_competitions(uuid) to authenticated;

create or replace function public.respond_sponsored_gym_competition(
  p_season_id uuid,
  p_organization_id uuid,
  p_accept boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_season public.seasons%rowtype;
  v_gym_name text;
  v_manager record;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.is_organization_admin(p_organization_id) then raise exception 'owner or admin required'; end if;
  select * into v_season from public.seasons where id=p_season_id and season_type='sponsored_gym';
  if not found then raise exception 'competition not found'; end if;
  if v_season.status in ('completed','cancelled') or now()>=v_season.ends_at then raise exception 'competition is closed'; end if;
  if not exists (select 1 from public.season_organization_entries where season_id=p_season_id and organization_id=p_organization_id and status='invited') then
    raise exception 'pending invitation not found';
  end if;

  update public.season_organization_entries
  set status=case when p_accept then 'active' else 'declined' end, responded_by_user_id=v_actor, responded_at=now()
  where season_id=p_season_id and organization_id=p_organization_id;

  select name into v_gym_name from public.organizations where id=p_organization_id;
  for v_manager in
    select om.user_id from public.organization_members om
    where om.organization_id=v_season.sponsor_organization_id and om.status='active' and om.role in ('owner','admin')
  loop
    insert into public.notifications(user_id,notification_type,title,body,data)
    values(v_manager.user_id,'sponsored_gym_competition_response',
      case when p_accept then 'Gym aceptó la competencia' else 'Gym rechazó la competencia' end,
      format('%s %s “%s”.',v_gym_name,case when p_accept then 'aceptó' else 'rechazó' end,v_season.name),
      jsonb_build_object('season_id',p_season_id,'organization_id',p_organization_id,'sponsor_organization_id',v_season.sponsor_organization_id,'route','/brand-competitions'));
  end loop;
  return true;
end;
$$;

revoke all on function public.respond_sponsored_gym_competition(uuid,uuid,boolean) from public;
grant execute on function public.respond_sponsored_gym_competition(uuid,uuid,boolean) to authenticated;

create or replace function public.get_my_sponsored_gym_invitations(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.is_organization_member(p_organization_id) then raise exception 'organization membership required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id,
      'name',s.name,
      'description',s.description,
      'status',case when now()>=s.ends_at then 'completed' when now()>=s.starts_at and s.status<>'cancelled' then 'active' else s.status end,
      'starts_at',s.starts_at,
      'ends_at',s.ends_at,
      'sponsor_organization_id',s.sponsor_organization_id,
      'sponsor_name',sp.name,
      'entry_status',e.status,
      'my_points',coalesce((select sum(se.sponsor_points) from public.score_events se where se.organization_id=p_organization_id and se.created_at>=s.starts_at and se.created_at<s.ends_at),0),
      'leaderboard',coalesce((
        select jsonb_agg(rank_row order by (rank_row->>'points')::bigint desc,rank_row->>'name')
        from (
          select jsonb_build_object('id',entry.organization_id,'name',o.name,'points',coalesce(sum(se.sponsor_points),0)) rank_row
          from public.season_organization_entries entry
          join public.organizations o on o.id=entry.organization_id
          left join public.score_events se on se.organization_id=entry.organization_id and se.created_at>=s.starts_at and se.created_at<s.ends_at
          where entry.season_id=s.id and entry.status='active'
          group by entry.organization_id,o.name
        ) ranked
      ),'[]'::jsonb)
    ) order by s.starts_at desc)
    from public.season_organization_entries e
    join public.seasons s on s.id=e.season_id and s.season_type='sponsored_gym'
    join public.organizations sp on sp.id=s.sponsor_organization_id
    where e.organization_id=p_organization_id and e.status in ('invited','active','declined')
      and s.status<>'cancelled' and s.ends_at>now()-interval '90 days'
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_my_sponsored_gym_invitations(uuid) from public;
grant execute on function public.get_my_sponsored_gym_invitations(uuid) to authenticated;

-- Keep health/version diagnostics aligned with the pre-release pack.
create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$ select 'v15.7-pre-release-feature-pack'::text; $$;

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
    'platform_superadmin', true,
    'rewards_marketplace', true,
    'reward_qr_fulfillment', true,
    'rewards_analytics', true,
    'tp_gp_seasons', true,
    'sponsored_gym_competitions', true,
    'ad_inventory', 7,
    'ad_rotation', true,
    'ad_analytics', true,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
