-- DadoFit V15.7.3 - Season scope + editing QA hotfix
-- Adds explicit Squad/Gym participation to competitive seasons, editable upcoming/active
-- seasons, clearer overlap diagnostics, and scoped leaderboards.

create table if not exists public.season_group_entries (
  season_id uuid not null references public.seasons(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (season_id, group_id)
);

create index if not exists season_group_entries_group_v1573_idx
  on public.season_group_entries (group_id, season_id);

alter table public.season_group_entries enable row level security;
revoke all privileges on table public.season_group_entries from anon, authenticated;
grant select on table public.season_group_entries to authenticated;

drop policy if exists season_group_entries_read_authenticated_v1573 on public.season_group_entries;
create policy season_group_entries_read_authenticated_v1573
on public.season_group_entries for select
to authenticated
using (true);

create or replace function public.admin_competitive_season_options(p_season_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  if p_season_type='squad' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name)
      from public.groups g
    ),'[]'::jsonb);
  elsif p_season_type='gym' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'name',o.name,
        'verification_status',o.verification_status
      ) order by o.name)
      from public.organizations o
      where o.organization_type='gym'
    ),'[]'::jsonb);
  end if;
  raise exception 'season type must be squad or gym';
end;
$$;

revoke all on function public.admin_competitive_season_options(text) from public;
grant execute on function public.admin_competitive_season_options(text) to authenticated;

-- Replace the old four-argument creator with the scoped version so PostgREST has
-- one authoritative signature for SuperAdmin season creation.
drop function if exists public.admin_create_competitive_season(text,text,timestamptz,timestamptz);

create or replace function public.admin_create_competitive_season(
  p_name text,
  p_season_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_entry_ids uuid[]
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
  v_conflict record;
  v_requested int := coalesce(array_length(p_entry_ids,1),0);
  v_valid int := 0;
begin
  perform public.require_platform_admin();
  if p_season_type not in ('squad','gym') then raise exception 'El tipo debe ser Squad o Gym.'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'La fecha de fin debe ser posterior a la fecha de inicio.'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'El nombre de la temporada es obligatorio.'; end if;
  if v_requested < 1 then raise exception 'Selecciona al menos un participante para la temporada.'; end if;

  if p_season_type='squad' then
    select count(distinct g.id) into v_valid from public.groups g where g.id=any(p_entry_ids);
  else
    select count(distinct o.id) into v_valid
    from public.organizations o
    where o.id=any(p_entry_ids) and o.organization_type='gym';
  end if;
  if v_valid<>v_requested then raise exception 'Uno o más participantes seleccionados ya no son válidos.'; end if;

  select s.name,s.starts_at,s.ends_at into v_conflict
  from public.seasons s
  where s.season_type=p_season_type
    and s.status in ('upcoming','active')
    and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
  order by s.starts_at
  limit 1;
  if found then
    raise exception 'La temporada "%" ya ocupa del % al %. Ajusta las fechas o edita esa temporada.',
      v_conflict.name,
      to_char(v_conflict.starts_at at time zone 'America/Bogota','DD/MM/YYYY HH24:MI'),
      to_char(v_conflict.ends_at at time zone 'America/Bogota','DD/MM/YYYY HH24:MI');
  end if;

  v_slug := p_season_type || '-' || to_char(p_starts_at,'YYYYMMDDHH24MI') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  v_status := case when now()>=p_ends_at then 'completed' when now()>=p_starts_at then 'active' else 'upcoming' end;

  insert into public.seasons(name,slug,season_type,status,starts_at,ends_at,metadata)
  values(left(btrim(p_name),120),v_slug,p_season_type,v_status,p_starts_at,p_ends_at,jsonb_build_object('created_by','superadmin','scope','selected'))
  returning id into v_id;

  if p_season_type='squad' then
    insert into public.season_group_entries(season_id,group_id)
    select v_id,unnest(p_entry_ids)
    on conflict do nothing;
  else
    insert into public.season_organization_entries(season_id,organization_id,status,responded_at)
    select v_id,x,'active',now() from unnest(p_entry_ids) as x
    on conflict (season_id,organization_id) do update set status='active',responded_at=now();
  end if;

  return v_id;
end;
$$;

revoke all on function public.admin_create_competitive_season(text,text,timestamptz,timestamptz,uuid[]) from public;
grant execute on function public.admin_create_competitive_season(text,text,timestamptz,timestamptz,uuid[]) to authenticated;

create or replace function public.admin_update_competitive_season(
  p_season_id uuid,
  p_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_entry_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season public.seasons%rowtype;
  v_conflict record;
  v_requested int := coalesce(array_length(p_entry_ids,1),0);
  v_valid int := 0;
begin
  perform public.require_platform_admin();
  select * into v_season from public.seasons where id=p_season_id and season_type in ('squad','gym');
  if not found then raise exception 'Temporada no encontrada.'; end if;
  if v_season.status in ('completed','cancelled') then raise exception 'Una temporada finalizada o cancelada ya no se puede editar.'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'La fecha de fin debe ser posterior a la fecha de inicio.'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'El nombre de la temporada es obligatorio.'; end if;
  if v_requested < 1 then raise exception 'Selecciona al menos un participante para la temporada.'; end if;

  if v_season.season_type='squad' then
    select count(distinct g.id) into v_valid from public.groups g where g.id=any(p_entry_ids);
  else
    select count(distinct o.id) into v_valid from public.organizations o where o.id=any(p_entry_ids) and o.organization_type='gym';
  end if;
  if v_valid<>v_requested then raise exception 'Uno o más participantes seleccionados ya no son válidos.'; end if;

  select s.name,s.starts_at,s.ends_at into v_conflict
  from public.seasons s
  where s.id<>p_season_id
    and s.season_type=v_season.season_type
    and s.status in ('upcoming','active')
    and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
  order by s.starts_at
  limit 1;
  if found then
    raise exception 'La temporada "%" ya ocupa del % al %. Ajusta las fechas o edita esa temporada.',
      v_conflict.name,
      to_char(v_conflict.starts_at at time zone 'America/Bogota','DD/MM/YYYY HH24:MI'),
      to_char(v_conflict.ends_at at time zone 'America/Bogota','DD/MM/YYYY HH24:MI');
  end if;

  update public.seasons
  set name=left(btrim(p_name),120),
      starts_at=p_starts_at,
      ends_at=p_ends_at,
      status=case when now()>=p_ends_at then 'completed' when now()>=p_starts_at then 'active' else 'upcoming' end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('scope','selected','updated_by','superadmin')
  where id=p_season_id;

  if v_season.season_type='squad' then
    delete from public.season_group_entries where season_id=p_season_id;
    insert into public.season_group_entries(season_id,group_id)
    select p_season_id,unnest(p_entry_ids)
    on conflict do nothing;
  else
    delete from public.season_organization_entries where season_id=p_season_id;
    insert into public.season_organization_entries(season_id,organization_id,status,responded_at)
    select p_season_id,x,'active',now() from unnest(p_entry_ids) as x
    on conflict (season_id,organization_id) do update set status='active',responded_at=now();
  end if;

  return true;
end;
$$;

revoke all on function public.admin_update_competitive_season(uuid,text,timestamptz,timestamptz,uuid[]) from public;
grant execute on function public.admin_update_competitive_season(uuid,text,timestamptz,timestamptz,uuid[]) to authenticated;

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
      'id',s.id,
      'name',s.name,
      'season_type',s.season_type,
      'status',case
        when s.status='cancelled' then 'cancelled'
        when s.status='completed' then 'completed'
        when now()>=s.ends_at then 'completed'
        when now()>=s.starts_at then 'active'
        else 'upcoming'
      end,
      'starts_at',s.starts_at,
      'ends_at',s.ends_at,
      'score_events',coalesce((select count(*) from public.score_events se where se.season_id=s.id),0),
      'participants',case when s.season_type='squad' then coalesce((
        select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name)
        from public.season_group_entries e join public.groups g on g.id=e.group_id
        where e.season_id=s.id
      ),'[]'::jsonb) else coalesce((
        select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name)
        from public.season_organization_entries e join public.organizations o on o.id=e.organization_id
        where e.season_id=s.id and e.status='active'
      ),'[]'::jsonb) end
    ) order by s.starts_at desc)
    from public.seasons s
    where s.season_type in ('squad','gym')
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_competitive_seasons() from public;
grant execute on function public.admin_list_competitive_seasons() to authenticated;

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
    'id',s.id,'name',s.name,
    'status',case when s.status='cancelled' then 'cancelled' when s.status='completed' then 'completed' when now()>=s.ends_at then 'completed' when now()>=s.starts_at then 'active' else 'upcoming' end,
    'starts_at',s.starts_at,'ends_at',s.ends_at,'season_type',s.season_type,
    'participant_count',(select count(*) from public.season_group_entries p where p.season_id=s.id),
    'leaderboard',coalesce((
      select jsonb_agg(x order by (x->>'points')::bigint desc, x->>'name')
      from (
        select jsonb_build_object('id',g.id,'name',g.name,'points',coalesce(sum(se.team_points),0),'completed',count(se.id) filter (where se.team_points>0)) x
        from public.groups g
        left join public.score_events se on se.group_id=g.id and se.season_id=s.id
        where not exists (select 1 from public.season_group_entries any_scope where any_scope.season_id=s.id)
           or exists (select 1 from public.season_group_entries scope where scope.season_id=s.id and scope.group_id=g.id)
        group by g.id,g.name
        having coalesce(sum(se.team_points),0)>0
           or exists (select 1 from public.season_group_entries scope_zero where scope_zero.season_id=s.id and scope_zero.group_id=g.id)
        order by coalesce(sum(se.team_points),0) desc
        limit 50
      ) q
    ),'[]'::jsonb)
  ) into v_squad
  from public.seasons s
  where s.season_type='squad' and s.status not in ('cancelled','completed') and s.ends_at>now()
  order by case when now()>=s.starts_at and now()<s.ends_at then 0 else 1 end,s.starts_at asc
  limit 1;

  select jsonb_build_object(
    'id',s.id,'name',s.name,
    'status',case when s.status='cancelled' then 'cancelled' when s.status='completed' then 'completed' when now()>=s.ends_at then 'completed' when now()>=s.starts_at then 'active' else 'upcoming' end,
    'starts_at',s.starts_at,'ends_at',s.ends_at,'season_type',s.season_type,
    'participant_count',(select count(*) from public.season_organization_entries p where p.season_id=s.id and p.status='active'),
    'leaderboard',coalesce((
      select jsonb_agg(x order by (x->>'points')::bigint desc, x->>'name')
      from (
        select jsonb_build_object('id',o.id,'name',o.name,'points',coalesce(sum(se.sponsor_points),0),'completed',count(se.id) filter (where se.sponsor_points>0)) x
        from public.organizations o
        left join public.score_events se on se.organization_id=o.id and se.season_id=s.id
        where o.organization_type='gym'
          and (not exists (select 1 from public.season_organization_entries any_scope where any_scope.season_id=s.id)
            or exists (select 1 from public.season_organization_entries scope where scope.season_id=s.id and scope.organization_id=o.id and scope.status='active'))
        group by o.id,o.name
        having coalesce(sum(se.sponsor_points),0)>0
           or exists (select 1 from public.season_organization_entries scope_zero where scope_zero.season_id=s.id and scope_zero.organization_id=o.id and scope_zero.status='active')
        order by coalesce(sum(se.sponsor_points),0) desc
        limit 50
      ) q
    ),'[]'::jsonb)
  ) into v_gym
  from public.seasons s
  where s.season_type='gym' and s.status not in ('cancelled','completed') and s.ends_at>now()
  order by case when now()>=s.starts_at and now()<s.ends_at then 0 else 1 end,s.starts_at asc
  limit 1;

  select coalesce(jsonb_agg(item order by item->>'ends_at'),'[]'::jsonb)
  into v_sponsored
  from (
    select jsonb_build_object(
      'id',s.id,'name',s.name,'description',s.description,
      'status',case when s.status='cancelled' then 'cancelled' when s.status='completed' then 'completed' when now()>=s.ends_at then 'completed' when now()>=s.starts_at then 'active' else 'upcoming' end,
      'starts_at',s.starts_at,'ends_at',s.ends_at,'sponsor_organization_id',s.sponsor_organization_id,'sponsor_name',sp.name,
      'entries',coalesce((select jsonb_agg(jsonb_build_object('organization_id',e.organization_id,'organization_name',o.name,'status',e.status,'points',coalesce((select sum(se.sponsor_points) from public.score_events se where se.organization_id=e.organization_id and se.created_at>=s.starts_at and se.created_at<s.ends_at),0)) order by o.name) from public.season_organization_entries e join public.organizations o on o.id=e.organization_id where e.season_id=s.id),'[]'::jsonb),
      'leaderboard',coalesce((select jsonb_agg(rank_row order by (rank_row->>'points')::bigint desc, rank_row->>'name') from (select jsonb_build_object('id',e.organization_id,'name',o.name,'points',coalesce(sum(se.sponsor_points),0)) rank_row from public.season_organization_entries e join public.organizations o on o.id=e.organization_id left join public.score_events se on se.organization_id=e.organization_id and se.created_at>=s.starts_at and se.created_at<s.ends_at where e.season_id=s.id and e.status='active' group by e.organization_id,o.name order by coalesce(sum(se.sponsor_points),0) desc) q),'[]'::jsonb)
    ) item
    from public.seasons s join public.organizations sp on sp.id=s.sponsor_organization_id
    where s.season_type='sponsored_gym' and s.status in ('upcoming','active','completed') and s.ends_at>now()-interval '90 days'
  ) q;

  select coalesce(jsonb_agg(item order by item->>'ends_at' desc),'[]'::jsonb)
  into v_history
  from (
    select jsonb_build_object('id',s.id,'name',s.name,'season_type',s.season_type,'starts_at',s.starts_at,'ends_at',s.ends_at,'status','completed') item
    from public.seasons s
    where s.season_type in ('squad','gym') and s.status<>'cancelled' and (s.status='completed' or s.ends_at<=now())
    order by s.ends_at desc limit 12
  ) recent;

  return jsonb_build_object('squad',v_squad,'gym',v_gym,'sponsored_gym',v_sponsored,'history',v_history);
end;
$$;

revoke all on function public.get_season_hub() from public;
grant execute on function public.get_season_hub() to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$ select 'v15.7.3-season-scope-editing'::text; $$;

notify pgrst, 'reload schema';
