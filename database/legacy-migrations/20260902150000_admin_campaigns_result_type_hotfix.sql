-- DadoFit V14.2.1
-- Fix admin_list_campaigns(): PostgreSQL requires every RETURN QUERY column
-- to match the declared RETURNS TABLE type exactly. Explicit casts keep the
-- RPC stable even when legacy migrations created compatible numeric/timestamp
-- columns using a different concrete PostgreSQL type.

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
    sc.id::uuid,
    sc.organization_id::uuid,
    o.name::text,
    sc.name::text,
    sc.status::text,
    coalesce(sc.requires_double_validation, false)::boolean,
    sc.max_participants::integer,
    sc.default_reward_coins::integer,
    sc.default_reward_xp::integer,
    (select count(*)::integer
       from public.challenges c
      where c.sponsor_campaign_id = sc.id)::integer,
    (select count(*)::integer
       from public.challenge_participants cp
       join public.challenges c on c.id = cp.challenge_id
      where c.sponsor_campaign_id = sc.id)::integer,
    (select count(*)::integer
       from public.challenge_participants cp
       join public.challenges c on c.id = cp.challenge_id
      where c.sponsor_campaign_id = sc.id
        and cp.status = 'approved')::integer,
    (select count(*)::integer
       from public.challenge_participants cp
       join public.challenges c on c.id = cp.challenge_id
      where c.sponsor_campaign_id = sc.id
        and cp.status = 'rejected')::integer,
    (select coalesce(sum(cp.reward_coins_granted), 0)::bigint
       from public.challenge_participants cp
       join public.challenges c on c.id = cp.challenge_id
      where c.sponsor_campaign_id = sc.id)::bigint,
    (select coalesce(sum(cp.reward_xp_granted), 0)::bigint
       from public.challenge_participants cp
       join public.challenges c on c.id = cp.challenge_id
      where c.sponsor_campaign_id = sc.id)::bigint,
    sc.created_at::timestamptz
  from public.sponsor_campaigns sc
  join public.organizations o on o.id = sc.organization_id
  order by sc.created_at desc;
end;
$$;

revoke all on function public.admin_list_campaigns() from public;
grant execute on function public.admin_list_campaigns() to authenticated;

-- Keep the project health chain identifiable from the migration history.
comment on function public.admin_list_campaigns() is
  'DadoFit V14.2.1 SuperAdmin global sponsored campaign list with explicit result casts';
