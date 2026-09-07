-- DadoFit V15.7.2 - Pre-Release QA Hotfix
-- Fixes authoritative manual season closure in the public hub and aligns
-- SuperAdmin's displayed status with the effective date window.

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
    'id',s.id,
    'name',s.name,
    'status',case
      when s.status='cancelled' then 'cancelled'
      when s.status='completed' then 'completed'
      when now()>=s.ends_at then 'completed'
      when now()>=s.starts_at then 'active'
      else 'upcoming'
    end,
    'starts_at',s.starts_at,
    'ends_at',s.ends_at,
    'season_type',s.season_type,
    'leaderboard',coalesce((
      select jsonb_agg(x order by (x->>'points')::bigint desc, x->>'name')
      from (
        select jsonb_build_object(
          'id',g.id,
          'name',g.name,
          'points',coalesce(sum(se.team_points),0),
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
  where s.season_type='squad'
    and s.status not in ('cancelled','completed')
    and s.ends_at>now()
  order by
    case when now()>=s.starts_at and now()<s.ends_at then 0 else 1 end,
    s.starts_at asc
  limit 1;

  select jsonb_build_object(
    'id',s.id,
    'name',s.name,
    'status',case
      when s.status='cancelled' then 'cancelled'
      when s.status='completed' then 'completed'
      when now()>=s.ends_at then 'completed'
      when now()>=s.starts_at then 'active'
      else 'upcoming'
    end,
    'starts_at',s.starts_at,
    'ends_at',s.ends_at,
    'season_type',s.season_type,
    'leaderboard',coalesce((
      select jsonb_agg(x order by (x->>'points')::bigint desc, x->>'name')
      from (
        select jsonb_build_object(
          'id',o.id,
          'name',o.name,
          'points',coalesce(sum(se.sponsor_points),0),
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
  where s.season_type='gym'
    and s.status not in ('cancelled','completed')
    and s.ends_at>now()
  order by
    case when now()>=s.starts_at and now()<s.ends_at then 0 else 1 end,
    s.starts_at asc
  limit 1;

  select coalesce(jsonb_agg(item order by item->>'ends_at'),'[]'::jsonb)
  into v_sponsored
  from (
    select jsonb_build_object(
      'id',s.id,
      'name',s.name,
      'description',s.description,
      'status',case
        when s.status='cancelled' then 'cancelled'
        when s.status='completed' then 'completed'
        when now()>=s.ends_at then 'completed'
        when now()>=s.starts_at then 'active'
        else 'upcoming'
      end,
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
      'id',s.id,
      'name',s.name,
      'season_type',s.season_type,
      'starts_at',s.starts_at,
      'ends_at',s.ends_at,
      'status','completed'
    ) item
    from public.seasons s
    where s.season_type in ('squad','gym')
      and s.status<>'cancelled'
      and (s.status='completed' or s.ends_at<=now())
    order by s.ends_at desc
    limit 12
  ) recent;

  return jsonb_build_object(
    'squad',v_squad,
    'gym',v_gym,
    'sponsored_gym',v_sponsored,
    'history',v_history
  );
end;
$$;

revoke all on function public.get_season_hub() from public;
grant execute on function public.get_season_hub() to authenticated;

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
      'score_events',coalesce((select count(*) from public.score_events se where se.season_id=s.id),0)
    ) order by s.starts_at desc)
    from public.seasons s
    where s.season_type in ('squad','gym')
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_competitive_seasons() from public;
grant execute on function public.admin_list_competitive_seasons() to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$ select 'v15.7.2-pre-release-qa-hotfix'::text; $$;

notify pgrst, 'reload schema';
