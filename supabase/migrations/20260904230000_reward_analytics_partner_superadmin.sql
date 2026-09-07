-- DadoFit V15.4 - Rewards Analytics (Partner + SuperAdmin)
-- Read-only analytics over existing rewards, redemptions and DadoCoins ledger.

create or replace function public.provider_reward_analytics(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_from timestamptz;
  v_offers_total integer := 0;
  v_active_offers integer := 0;
  v_redemptions integer := 0;
  v_redeemed integer := 0;
  v_unique_users integer := 0;
  v_dc_consumed bigint := 0;
  v_low_stock integer := 0;
  v_offers jsonb := '[]'::jsonb;
  v_trend jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_organization_id is null then raise exception 'organization required'; end if;
  if not public.can_manage_rewards_for_org(p_organization_id, v_actor) then
    raise exception 'only Owner/Admin can view reward analytics for this organization';
  end if;

  v_from := date_trunc('day', now()) - make_interval(days => v_days - 1);

  select count(*)::integer,
         count(*) filter (where r.status='active')::integer
  into v_offers_total, v_active_offers
  from public.rewards r
  where r.organization_id=p_organization_id;

  select count(*)::integer,
         count(*) filter (where rr.status='redeemed')::integer,
         count(distinct rr.user_id)::integer,
         coalesce(sum(rr.coin_cost),0)::bigint
  into v_redemptions, v_redeemed, v_unique_users, v_dc_consumed
  from public.reward_redemptions rr
  join public.rewards r on r.id=rr.reward_id
  where r.organization_id=p_organization_id
    and rr.status<>'cancelled'
    and rr.created_at>=v_from;

  select count(*)::integer into v_low_stock
  from public.rewards r
  where r.organization_id=p_organization_id
    and r.status in ('active','paused')
    and r.inventory is not null
    and greatest(
      r.inventory - (select count(*)::integer from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled'),
      0
    ) <= greatest(3, ceil(r.inventory * 0.20)::integer);

  select coalesce(jsonb_agg(item order by (item->>'redemptions')::integer desc, item->>'title'),'[]'::jsonb)
  into v_offers
  from (
    select jsonb_build_object(
      'reward_id', r.id,
      'title', r.title,
      'status', r.status,
      'coin_cost', r.coin_cost,
      'inventory', r.inventory,
      'remaining_stock', case when r.inventory is null then null else greatest(r.inventory - all_time.claimed, 0) end,
      'redemptions', coalesce(period.redemptions,0),
      'redeemed', coalesce(period.redeemed,0),
      'unique_users', coalesce(period.unique_users,0),
      'dc_consumed', coalesce(period.dc_consumed,0),
      'low_stock', case
        when r.inventory is null or r.status not in ('active','paused') then false
        else greatest(r.inventory-all_time.claimed,0) <= greatest(3,ceil(r.inventory*0.20)::integer)
      end
    ) item
    from public.rewards r
    cross join lateral (
      select count(*) filter (where rr.status<>'cancelled')::integer as claimed
      from public.reward_redemptions rr
      where rr.reward_id=r.id
    ) all_time
    cross join lateral (
      select
        count(*) filter (where rr.status<>'cancelled')::integer as redemptions,
        count(*) filter (where rr.status='redeemed')::integer as redeemed,
        count(distinct rr.user_id) filter (where rr.status<>'cancelled')::integer as unique_users,
        coalesce(sum(rr.coin_cost) filter (where rr.status<>'cancelled'),0)::bigint as dc_consumed
      from public.reward_redemptions rr
      where rr.reward_id=r.id and rr.created_at>=v_from
    ) period
    where r.organization_id=p_organization_id
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'day', d.day,
    'redemptions', coalesce(x.redemptions,0),
    'dc_consumed', coalesce(x.dc_consumed,0),
    'unique_users', coalesce(x.unique_users,0)
  ) order by d.day),'[]'::jsonb)
  into v_trend
  from generate_series(v_from::date, current_date, interval '1 day') d(day)
  left join (
    select rr.created_at::date as day,
           count(*) filter (where rr.status<>'cancelled')::integer as redemptions,
           coalesce(sum(rr.coin_cost) filter (where rr.status<>'cancelled'),0)::bigint as dc_consumed,
           count(distinct rr.user_id) filter (where rr.status<>'cancelled')::integer as unique_users
    from public.reward_redemptions rr
    join public.rewards r on r.id=rr.reward_id
    where r.organization_id=p_organization_id and rr.created_at>=v_from
    group by rr.created_at::date
  ) x on x.day=d.day::date;

  select coalesce(jsonb_agg(item order by item->>'created_at' desc),'[]'::jsonb)
  into v_recent
  from (
    select jsonb_build_object(
      'redemption_id', rr.id,
      'reward_id', rr.reward_id,
      'reward_title', coalesce(rr.reward_title_snapshot,r.title),
      'user_id', rr.user_id,
      'user_name', coalesce(nullif(p.display_name,''),p.username,'Gymbro'),
      'coin_cost', rr.coin_cost,
      'status', rr.status,
      'created_at', rr.created_at,
      'redeemed_at', rr.redeemed_at
    ) item
    from public.reward_redemptions rr
    join public.rewards r on r.id=rr.reward_id
    join public.profiles p on p.id=rr.user_id
    where r.organization_id=p_organization_id
    order by rr.created_at desc
    limit 20
  ) recent;

  return jsonb_build_object(
    'period_days', v_days,
    'from', v_from,
    'summary', jsonb_build_object(
      'offers_total', v_offers_total,
      'active_offers', v_active_offers,
      'redemptions', v_redemptions,
      'redeemed', v_redeemed,
      'pending_delivery', greatest(v_redemptions-v_redeemed,0),
      'unique_users', v_unique_users,
      'dc_consumed', v_dc_consumed,
      'low_stock_offers', v_low_stock
    ),
    'offers', v_offers,
    'trend', v_trend,
    'recent_redemptions', v_recent
  );
end;
$$;

revoke all on function public.provider_reward_analytics(uuid,integer) from public;
grant execute on function public.provider_reward_analytics(uuid,integer) to authenticated;

create or replace function public.admin_reward_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days,30),365));
  v_from timestamptz;
  v_redemptions integer := 0;
  v_redeemed integer := 0;
  v_unique_users integer := 0;
  v_dc_consumed bigint := 0;
  v_dc_issued bigint := 0;
  v_circulation bigint := 0;
  v_active_rewards integer := 0;
  v_providers integer := 0;
  v_low_stock integer := 0;
  v_providers_data jsonb := '[]'::jsonb;
  v_top_rewards jsonb := '[]'::jsonb;
  v_trend jsonb := '[]'::jsonb;
begin
  perform public.require_platform_admin();
  v_from := date_trunc('day',now()) - make_interval(days => v_days - 1);

  select count(*)::integer,
         count(*) filter (where rr.status='redeemed')::integer,
         count(distinct rr.user_id)::integer,
         coalesce(sum(rr.coin_cost),0)::bigint
  into v_redemptions,v_redeemed,v_unique_users,v_dc_consumed
  from public.reward_redemptions rr
  where rr.status<>'cancelled' and rr.created_at>=v_from;

  select coalesce(sum(wt.amount) filter (where wt.amount>0),0)::bigint
  into v_dc_issued
  from public.wallet_transactions wt
  where wt.created_at>=v_from;

  select coalesce(sum(w.balance),0)::bigint into v_circulation from public.wallets w;
  select count(*)::integer into v_active_rewards from public.rewards r where r.status='active';
  select count(distinct r.organization_id)::integer into v_providers from public.rewards r where r.organization_id is not null;

  select count(*)::integer into v_low_stock
  from public.rewards r
  where r.status in ('active','paused')
    and r.inventory is not null
    and greatest(r.inventory-(select count(*)::integer from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled'),0)
        <= greatest(3,ceil(r.inventory*0.20)::integer);

  select coalesce(jsonb_agg(item order by (item->>'dc_consumed')::bigint desc, item->>'organization_name'),'[]'::jsonb)
  into v_providers_data
  from (
    select jsonb_build_object(
      'organization_id',o.id,
      'organization_name',o.name,
      'organization_type',o.organization_type,
      'active_rewards',count(distinct r.id) filter (where r.status='active'),
      'redemptions',count(rr.id) filter (where rr.status<>'cancelled' and rr.created_at>=v_from),
      'unique_users',count(distinct rr.user_id) filter (where rr.status<>'cancelled' and rr.created_at>=v_from),
      'dc_consumed',coalesce(sum(rr.coin_cost) filter (where rr.status<>'cancelled' and rr.created_at>=v_from),0),
      'low_stock',count(distinct r.id) filter (
        where r.status in ('active','paused') and r.inventory is not null
          and greatest(r.inventory-(select count(*)::integer from public.reward_redemptions rr2 where rr2.reward_id=r.id and rr2.status<>'cancelled'),0)
              <= greatest(3,ceil(r.inventory*0.20)::integer)
      )
    ) item
    from public.organizations o
    join public.rewards r on r.organization_id=o.id
    left join public.reward_redemptions rr on rr.reward_id=r.id
    group by o.id,o.name,o.organization_type
  ) q;

  select coalesce(jsonb_agg(item order by (item->>'redemptions')::integer desc, item->>'title'),'[]'::jsonb)
  into v_top_rewards
  from (
    select jsonb_build_object(
      'reward_id',r.id,
      'title',r.title,
      'organization_name',o.name,
      'organization_type',o.organization_type,
      'status',r.status,
      'coin_cost',r.coin_cost,
      'redemptions',count(rr.id) filter (where rr.status<>'cancelled' and rr.created_at>=v_from),
      'unique_users',count(distinct rr.user_id) filter (where rr.status<>'cancelled' and rr.created_at>=v_from),
      'dc_consumed',coalesce(sum(rr.coin_cost) filter (where rr.status<>'cancelled' and rr.created_at>=v_from),0),
      'remaining_stock',case when r.inventory is null then null else greatest(r.inventory-count(rr.id) filter (where rr.status<>'cancelled'),0) end
    ) item
    from public.rewards r
    join public.organizations o on o.id=r.organization_id
    left join public.reward_redemptions rr on rr.reward_id=r.id
    group by r.id,r.title,r.status,r.coin_cost,r.inventory,o.name,o.organization_type
    having count(rr.id) filter (where rr.status<>'cancelled' and rr.created_at>=v_from)>0
    order by count(rr.id) filter (where rr.status<>'cancelled' and rr.created_at>=v_from) desc
    limit 20
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'day',d.day,
    'dc_issued',coalesce(w.dc_issued,0),
    'dc_consumed',coalesce(r.dc_consumed,0),
    'redemptions',coalesce(r.redemptions,0)
  ) order by d.day),'[]'::jsonb)
  into v_trend
  from generate_series(v_from::date,current_date,interval '1 day') d(day)
  left join (
    select wt.created_at::date as day,
           coalesce(sum(wt.amount) filter (where wt.amount>0),0)::bigint as dc_issued
    from public.wallet_transactions wt
    where wt.created_at>=v_from
    group by wt.created_at::date
  ) w on w.day=d.day::date
  left join (
    select rr.created_at::date as day,
           count(*) filter (where rr.status<>'cancelled')::integer as redemptions,
           coalesce(sum(rr.coin_cost) filter (where rr.status<>'cancelled'),0)::bigint as dc_consumed
    from public.reward_redemptions rr
    where rr.created_at>=v_from
    group by rr.created_at::date
  ) r on r.day=d.day::date;

  return jsonb_build_object(
    'period_days',v_days,
    'from',v_from,
    'summary',jsonb_build_object(
      'redemptions',v_redemptions,
      'redeemed',v_redeemed,
      'pending_delivery',greatest(v_redemptions-v_redeemed,0),
      'unique_users',v_unique_users,
      'dc_consumed',v_dc_consumed,
      'dc_issued',v_dc_issued,
      'dc_circulation',v_circulation,
      'active_rewards',v_active_rewards,
      'providers',v_providers,
      'low_stock_offers',v_low_stock
    ),
    'providers',v_providers_data,
    'top_rewards',v_top_rewards,
    'trend',v_trend
  );
end;
$$;

revoke all on function public.admin_reward_analytics(integer) from public;
grant execute on function public.admin_reward_analytics(integer) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$ select 'v15.4-rewards-analytics'::text; $$;
