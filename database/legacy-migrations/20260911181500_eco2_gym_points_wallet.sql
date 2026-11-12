-- DadoFit V15.7.14 / ECO-2 - Gym Points wallet foundation
-- Separates immutable/gross Gym contribution from the member's spendable GP balance.
-- Legacy sponsor_points columns continue as a compatibility mirror for Gym score only.

alter table public.score_events
  add column if not exists gym_points integer not null default 0 check (gym_points >= 0);

-- Existing Gym score becomes explicit GP without changing historical rankings.
update public.score_events se
set gym_points = se.sponsor_points
from public.organizations o
where se.organization_id = o.id
  and o.organization_type = 'gym'
  and se.sponsor_points > 0
  and se.gym_points = 0;

create table if not exists public.gym_point_wallets (
  user_id uuid not null references public.profiles(id) on delete cascade,
  gym_organization_id uuid not null references public.organizations(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  lifetime_earned bigint not null default 0 check (lifetime_earned >= 0),
  lifetime_spent bigint not null default 0 check (lifetime_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, gym_organization_id)
);

create table if not exists public.gym_point_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  gym_organization_id uuid not null references public.organizations(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  entry_type text not null check (entry_type in ('grant','redeem','refund','adjustment')),
  source_type text not null,
  source_id uuid,
  description text,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gym_point_ledger_user_gym_idx
  on public.gym_point_ledger(user_id, gym_organization_id, created_at desc);

alter table public.gym_point_wallets enable row level security;
alter table public.gym_point_ledger enable row level security;

revoke all on table public.gym_point_wallets from anon, authenticated;
revoke all on table public.gym_point_ledger from anon, authenticated;
grant select on table public.gym_point_wallets to authenticated;
grant select on table public.gym_point_ledger to authenticated;

drop policy if exists gym_point_wallets_read_own_eco2 on public.gym_point_wallets;
create policy gym_point_wallets_read_own_eco2
on public.gym_point_wallets for select
to authenticated
using (user_id = auth.uid());

drop policy if exists gym_point_ledger_read_own_eco2 on public.gym_point_ledger;
create policy gym_point_ledger_read_own_eco2
on public.gym_point_ledger for select
to authenticated
using (user_id = auth.uid());

-- Internal grant primitive. It is intentionally NOT executable by authenticated clients.
create or replace function public.grant_gym_points(
  p_user_id uuid,
  p_gym_organization_id uuid,
  p_amount bigint,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_idempotency_key text
)
returns table(new_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_org_type text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Gym Points grant must be greater than zero'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'idempotency key is required'; end if;

  select organization_type into v_org_type
  from public.organizations
  where id = p_gym_organization_id;

  if v_org_type is distinct from 'gym' then raise exception 'Gym Points can only belong to a Gym organization'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'user not found'; end if;

  if exists (select 1 from public.gym_point_ledger where idempotency_key = p_idempotency_key) then
    select gpw.balance into v_balance
    from public.gym_point_wallets gpw
    where gpw.user_id = p_user_id and gpw.gym_organization_id = p_gym_organization_id;
    return query select coalesce(v_balance,0);
    return;
  end if;

  insert into public.gym_point_wallets(user_id,gym_organization_id,balance,lifetime_earned,lifetime_spent)
  values(p_user_id,p_gym_organization_id,p_amount,p_amount,0)
  on conflict (user_id,gym_organization_id) do update
  set balance = public.gym_point_wallets.balance + excluded.balance,
      lifetime_earned = public.gym_point_wallets.lifetime_earned + excluded.lifetime_earned,
      updated_at = now()
  returning balance into v_balance;

  insert into public.gym_point_ledger(
    user_id,gym_organization_id,amount,balance_after,entry_type,source_type,source_id,description,idempotency_key
  ) values(
    p_user_id,p_gym_organization_id,p_amount,v_balance,'grant',left(coalesce(p_source_type,'unknown'),80),p_source_id,
    nullif(left(btrim(coalesce(p_description,'')),300),''),p_idempotency_key
  );

  return query select v_balance;
end;
$$;

revoke all on function public.grant_gym_points(uuid,uuid,bigint,text,uuid,text,text) from public, anon, authenticated;

-- Historical wallet bootstrap: only score events attributed to a real Gym and a concrete participant.
-- This does not change score_events; it creates an independently spendable balance.
insert into public.gym_point_wallets(user_id,gym_organization_id,balance,lifetime_earned,lifetime_spent)
select
  cp.user_id,
  se.organization_id,
  sum(se.gym_points)::bigint,
  sum(se.gym_points)::bigint,
  0
from public.score_events se
join public.challenge_participants cp on cp.id = se.participant_id
join public.organizations o on o.id = se.organization_id and o.organization_type = 'gym'
where se.gym_points > 0
  and se.organization_id is not null
group by cp.user_id,se.organization_id
on conflict (user_id,gym_organization_id) do nothing;

insert into public.gym_point_ledger(
  user_id,gym_organization_id,amount,balance_after,entry_type,source_type,source_id,description,idempotency_key,metadata
)
select
  w.user_id,
  w.gym_organization_id,
  w.lifetime_earned,
  w.balance,
  'grant',
  'eco2_historical_backfill',
  null,
  'Saldo inicial GP derivado del aporte histórico registrado antes de ECO-2',
  format('eco2-gp-backfill:%s:%s',w.user_id,w.gym_organization_id),
  jsonb_build_object('migration','v15.7.14-eco2','historical',true)
from public.gym_point_wallets w
where w.lifetime_earned > 0
  and not exists (
    select 1 from public.gym_point_ledger l
    where l.idempotency_key = format('eco2-gp-backfill:%s:%s',w.user_id,w.gym_organization_id)
  );

-- Transitional compatibility: all new Gym score events keep explicit gym_points and the old
-- sponsor_points score column synchronized until the ranking layer is migrated completely.
create or replace function public.sync_gym_points_score_event_eco2()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_is_gym boolean;
  v_points integer;
begin
  if new.organization_id is null then return new; end if;

  select exists(
    select 1 from public.organizations o
    where o.id = new.organization_id and o.organization_type = 'gym'
  ) into v_is_gym;

  if not v_is_gym then return new; end if;

  v_points := greatest(coalesce(new.gym_points,0),coalesce(new.sponsor_points,0));
  new.gym_points := v_points;
  new.sponsor_points := v_points;
  return new;
end;
$$;

drop trigger if exists score_events_sync_gym_points_eco2 on public.score_events;
create trigger score_events_sync_gym_points_eco2
before insert or update of gym_points,sponsor_points,organization_id
on public.score_events
for each row execute function public.sync_gym_points_score_event_eco2();

-- Every new Gym score event also credits the participant's local spendable GP wallet exactly once.
create or replace function public.credit_gym_wallet_from_score_event_eco2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_is_gym boolean;
begin
  if new.organization_id is null or new.participant_id is null or coalesce(new.gym_points,0) <= 0 then
    return new;
  end if;

  select exists(
    select 1 from public.organizations o
    where o.id = new.organization_id and o.organization_type = 'gym'
  ) into v_is_gym;
  if not v_is_gym then return new; end if;

  select cp.user_id into v_user_id
  from public.challenge_participants cp
  where cp.id = new.participant_id;
  if v_user_id is null then return new; end if;

  perform public.grant_gym_points(
    v_user_id,
    new.organization_id,
    new.gym_points,
    'gym_score_event',
    new.id,
    'GP ganados por actividad aprobada del Gym',
    format('gym-score-event:%s',new.id)
  );
  return new;
end;
$$;

revoke all on function public.credit_gym_wallet_from_score_event_eco2() from public, anon, authenticated;

drop trigger if exists score_events_credit_gym_wallet_eco2 on public.score_events;
create trigger score_events_credit_gym_wallet_eco2
after insert on public.score_events
for each row execute function public.credit_gym_wallet_from_score_event_eco2();

-- Personal wallet view. Balances are never summed across Gyms.
create or replace function public.get_my_gym_point_balances()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'gym_organization_id',w.gym_organization_id,
      'gym_name',o.name,
      'logo_url',o.logo_url,
      'balance',w.balance,
      'lifetime_earned',w.lifetime_earned,
      'lifetime_spent',w.lifetime_spent,
      'membership_status',om.status,
      'redeemable',coalesce(om.status='active',false)
    ) order by case when om.status='active' then 0 else 1 end,w.balance desc,o.name)
    from public.gym_point_wallets w
    join public.organizations o on o.id = w.gym_organization_id and o.organization_type = 'gym'
    left join public.organization_members om
      on om.organization_id = w.gym_organization_id and om.user_id = auth.uid()
    where w.user_id = auth.uid()
      and (w.balance > 0 or w.lifetime_earned > 0 or w.lifetime_spent > 0)
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_my_gym_point_balances() from public, anon;
grant execute on function public.get_my_gym_point_balances() to authenticated;

-- Diagnostic contract for QA: historical score and spendable wallet are separate values.
create or replace function public.get_my_gym_points_economy_debug()
returns table(
  gym_organization_id uuid,
  gym_name text,
  historical_contribution bigint,
  spendable_balance bigint,
  lifetime_earned bigint,
  lifetime_spent bigint,
  membership_status text
)
language sql
stable
security definer
set search_path = public
as $$
  with history as (
    select se.organization_id,coalesce(sum(se.gym_points),0)::bigint as historical_contribution
    from public.score_events se
    join public.challenge_participants cp on cp.id=se.participant_id
    join public.organizations o on o.id=se.organization_id and o.organization_type='gym'
    where cp.user_id=auth.uid()
    group by se.organization_id
  )
  select w.gym_organization_id,o.name,
         coalesce(h.historical_contribution,0),w.balance,w.lifetime_earned,w.lifetime_spent,om.status
  from public.gym_point_wallets w
  join public.organizations o on o.id=w.gym_organization_id
  left join history h on h.organization_id=w.gym_organization_id
  left join public.organization_members om on om.organization_id=w.gym_organization_id and om.user_id=auth.uid()
  where w.user_id=auth.uid()
  order by o.name;
$$;

revoke all on function public.get_my_gym_points_economy_debug() from public, anon;
grant execute on function public.get_my_gym_points_economy_debug() to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
as $$
  select 'v15.7.14-eco2-gym-points-wallet'::text;
$$;
