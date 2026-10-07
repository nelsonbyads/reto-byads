-- DadoFit 2.1 - ECO-4B DC Budget Governance
-- Infrastructure for auditable DadoCoins budgets. Does NOT change challenge payouts or grant DC.

create table if not exists public.dc_budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  sponsor_campaign_id uuid references public.sponsor_campaigns(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  is_dadofit_internal boolean not null default false,
  budget_dc bigint not null check (budget_dc >= 0),
  used_dc bigint not null default 0 check (used_dc >= 0),
  remaining_dc bigint generated always as (budget_dc - used_dc) stored,
  status text not null default 'draft' check (status in ('draft','active','paused','exhausted','expired','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dc_budgets_used_lte_budget check (used_dc <= budget_dc),
  constraint dc_budgets_internal_org check (
    (is_dadofit_internal = true and organization_id is null)
    or (is_dadofit_internal = false and organization_id is not null)
  )
);

create index if not exists dc_budgets_org_idx on public.dc_budgets(organization_id, status);
create index if not exists dc_budgets_campaign_idx on public.dc_budgets(sponsor_campaign_id);
create index if not exists dc_budgets_season_idx on public.dc_budgets(season_id);
create index if not exists dc_budgets_internal_idx on public.dc_budgets(is_dadofit_internal, status);

create table if not exists public.dc_budget_transactions (
  id uuid primary key default gen_random_uuid(),
  dc_budget_id uuid not null references public.dc_budgets(id) on delete restrict,
  user_id uuid references public.profiles(id) on delete set null,
  challenge_id uuid references public.challenges(id) on delete set null,
  participant_id uuid references public.challenge_participants(id) on delete set null,
  direction text not null check (direction in ('grant','reversal','adjustment')),
  amount bigint not null check (amount > 0),
  balance_after bigint not null,             -- remaining_dc after the movement
  reason text,
  external_source text,
  external_id uuid,
  idempotency_key text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists dc_budget_tx_budget_idx on public.dc_budget_transactions(dc_budget_id, created_at desc);
create index if not exists dc_budget_tx_user_idx on public.dc_budget_transactions(user_id);

alter table public.dc_budgets enable row level security;
alter table public.dc_budget_transactions enable row level security;

revoke all on table public.dc_budgets from anon, authenticated;
revoke all on table public.dc_budget_transactions from anon, authenticated;

-- Partners can read their own budgets; everything written via SuperAdmin RPCs.
drop policy if exists dc_budgets_read_own on public.dc_budgets;
create policy dc_budgets_read_own
on public.dc_budgets for select
to authenticated
using (
  public.is_platform_admin(auth.uid())
  or exists (
    select 1 from public.organization_members om
    where om.organization_id = dc_budgets.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('owner','admin')
  )
);
grant select on table public.dc_budgets to authenticated;

drop policy if exists dc_budget_tx_read_own on public.dc_budget_transactions;
create policy dc_budget_tx_read_own
on public.dc_budget_transactions for select
to authenticated
using (
  public.is_platform_admin(auth.uid())
  or exists (
    select 1
    from public.dc_budgets b
    join public.organization_members om on om.organization_id = b.organization_id
    where b.id = dc_budget_transactions.dc_budget_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('owner','admin')
  )
);
grant select on table public.dc_budget_transactions to authenticated;

-- Helper: validate campaign/season coherence.
create or replace function public.dc_budget_validate_links(
  p_organization_id uuid,
  p_sponsor_campaign_id uuid,
  p_season_id uuid
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_campaign_org uuid;
  v_season_org uuid;
begin
  if p_sponsor_campaign_id is not null then
    select organization_id into v_campaign_org from public.sponsor_campaigns where id = p_sponsor_campaign_id;
    if v_campaign_org is null then raise exception 'sponsor_campaign not found'; end if;
    if p_organization_id is not null and v_campaign_org <> p_organization_id then
      raise exception 'sponsor_campaign belongs to a different organization';
    end if;
  end if;

  if p_season_id is not null then
    select sponsor_organization_id into v_season_org from public.seasons where id = p_season_id;
    if not found then raise exception 'season not found'; end if;
    if v_season_org is not null and p_organization_id is not null and v_season_org <> p_organization_id then
      raise exception 'season sponsor_organization belongs to a different organization';
    end if;
  end if;
end;
$$;

revoke all on function public.dc_budget_validate_links(uuid,uuid,uuid) from public;

create or replace function public.superadmin_create_dc_budget(
  p_budget_dc bigint,
  p_organization_id uuid default null,
  p_sponsor_campaign_id uuid default null,
  p_season_id uuid default null,
  p_is_dadofit_internal boolean default false,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns public.dc_budgets
language plpgsql
security definer
set search_path = public
as $$
declare v_budget public.dc_budgets;
begin
  perform public.require_platform_admin();
  if p_budget_dc is null or p_budget_dc <= 0 then raise exception 'budget_dc must be positive'; end if;
  if p_is_dadofit_internal and p_organization_id is not null then
    raise exception 'internal budget cannot have organization_id';
  end if;
  if not p_is_dadofit_internal and p_organization_id is null then
    raise exception 'partner budget requires organization_id';
  end if;
  perform public.dc_budget_validate_links(p_organization_id, p_sponsor_campaign_id, p_season_id);
  insert into public.dc_budgets (
    organization_id, sponsor_campaign_id, season_id, is_dadofit_internal,
    budget_dc, status, starts_at, ends_at, created_by
  ) values (
    p_organization_id, p_sponsor_campaign_id, p_season_id, coalesce(p_is_dadofit_internal,false),
    p_budget_dc, 'draft', p_starts_at, p_ends_at, auth.uid()
  ) returning * into v_budget;
  return v_budget;
end;
$$;

create or replace function public.superadmin_set_dc_budget_status(
  p_budget_id uuid,
  p_new_status text
)
returns public.dc_budgets
language plpgsql
security definer
set search_path = public
as $$
declare v_budget public.dc_budgets;
begin
  perform public.require_platform_admin();
  select * into v_budget from public.dc_budgets where id = p_budget_id for update;
  if not found then raise exception 'budget not found'; end if;

  if p_new_status = 'active' then
    if v_budget.status not in ('draft','paused') then raise exception 'cannot activate from %', v_budget.status; end if;
    if v_budget.budget_dc <= 0 then raise exception 'budget_dc must be positive'; end if;
    if v_budget.status = 'paused' and v_budget.remaining_dc < 1 then raise exception 'cannot resume exhausted budget'; end if;
    if v_budget.starts_at is not null and now() < v_budget.starts_at and v_budget.status = 'draft' then
      -- allow scheduling: only allow activation if within window when both set
      null;
    end if;
    if v_budget.ends_at is not null and now() > v_budget.ends_at then raise exception 'budget already expired'; end if;
    update public.dc_budgets set status = 'active', approved_by = auth.uid(), approved_at = coalesce(approved_at, now()), updated_at = now() where id = p_budget_id returning * into v_budget;
  elsif p_new_status = 'paused' then
    if v_budget.status <> 'active' then raise exception 'only active can be paused'; end if;
    update public.dc_budgets set status='paused', updated_at=now() where id = p_budget_id returning * into v_budget;
  elsif p_new_status = 'cancelled' then
    if v_budget.status in ('cancelled','expired','exhausted') then raise exception 'already terminal'; end if;
    update public.dc_budgets set status='cancelled', updated_at=now() where id = p_budget_id returning * into v_budget;
  else
    raise exception 'unsupported transition to %', p_new_status;
  end if;
  return v_budget;
end;
$$;

create or replace function public.superadmin_approve_dc_budget(p_budget_id uuid)
returns public.dc_budgets language plpgsql security definer set search_path = public as $$
begin perform public.require_platform_admin(); return public.superadmin_set_dc_budget_status(p_budget_id,'active'); end; $$;

create or replace function public.superadmin_pause_dc_budget(p_budget_id uuid)
returns public.dc_budgets language plpgsql security definer set search_path = public as $$
begin perform public.require_platform_admin(); return public.superadmin_set_dc_budget_status(p_budget_id,'paused'); end; $$;

create or replace function public.superadmin_resume_dc_budget(p_budget_id uuid)
returns public.dc_budgets language plpgsql security definer set search_path = public as $$
begin perform public.require_platform_admin(); return public.superadmin_set_dc_budget_status(p_budget_id,'active'); end; $$;

create or replace function public.superadmin_cancel_dc_budget(p_budget_id uuid)
returns public.dc_budgets language plpgsql security definer set search_path = public as $$
begin perform public.require_platform_admin(); return public.superadmin_set_dc_budget_status(p_budget_id,'cancelled'); end; $$;

revoke all on function public.superadmin_create_dc_budget(bigint,uuid,uuid,uuid,boolean,timestamptz,timestamptz) from public;
revoke all on function public.superadmin_set_dc_budget_status(uuid,text) from public;
revoke all on function public.superadmin_approve_dc_budget(uuid) from public;
revoke all on function public.superadmin_pause_dc_budget(uuid) from public;
revoke all on function public.superadmin_resume_dc_budget(uuid) from public;
revoke all on function public.superadmin_cancel_dc_budget(uuid) from public;
grant execute on function public.superadmin_create_dc_budget(bigint,uuid,uuid,uuid,boolean,timestamptz,timestamptz) to authenticated;
grant execute on function public.superadmin_set_dc_budget_status(uuid,text) to authenticated;
grant execute on function public.superadmin_approve_dc_budget(uuid) to authenticated;
grant execute on function public.superadmin_pause_dc_budget(uuid) to authenticated;
grant execute on function public.superadmin_resume_dc_budget(uuid) to authenticated;
grant execute on function public.superadmin_cancel_dc_budget(uuid) to authenticated;

create or replace function public.admin_get_dc_budgets()
returns table (
  id uuid, organization_id uuid, organization_name text, sponsor_campaign_id uuid, season_id uuid,
  is_dadofit_internal boolean, budget_dc bigint, used_dc bigint, remaining_dc bigint,
  utilization_pct numeric, status text, starts_at timestamptz, ends_at timestamptz,
  approved_by uuid, approved_at timestamptz, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_platform_admin();
  return query
    select b.id, b.organization_id, o.name, b.sponsor_campaign_id, b.season_id,
           b.is_dadofit_internal, b.budget_dc, b.used_dc, b.remaining_dc,
           round(case when b.budget_dc > 0 then (b.used_dc::numeric / b.budget_dc) * 100 else 0 end, 2),
           b.status, b.starts_at, b.ends_at, b.approved_by, b.approved_at, b.created_at
    from public.dc_budgets b
    left join public.organizations o on o.id = b.organization_id
    order by b.created_at desc;
end; $$;

revoke all on function public.admin_get_dc_budgets() from public;
grant execute on function public.admin_get_dc_budgets() to authenticated;

-- Atomic internal consumer. Uses SELECT ... FOR UPDATE on the budget row plus status/window checks.
-- Returns a single jsonb result; idempotent by idempotency_key.
create or replace function public.consume_dc_budget_internal(
  p_dc_budget_id uuid,
  p_amount bigint,
  p_direction text default 'grant',
  p_user_id uuid default null,
  p_challenge_id uuid default null,
  p_participant_id uuid default null,
  p_reason text default 'reward_payout',
  p_external_source text default null,
  p_external_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.dc_budgets;
  v_tx public.dc_budget_transactions;
  v_amount bigint := abs(p_amount);
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_direction not in ('grant','reversal','adjustment') then raise exception 'invalid direction'; end if;
  if p_idempotency_key is null then raise exception 'idempotency_key required'; end if;

  -- idempotency: if the same key already succeeded, return its result without re-consuming.
  select * into v_tx from public.dc_budget_transactions where idempotency_key = p_idempotency_key;
  if found then
    select * into v_budget from public.dc_budgets where id = v_tx.dc_budget_id;
    return jsonb_build_object('success', true, 'idempotent_replay', true, 'dc_budget_id', v_tx.dc_budget_id,
      'amount_consumed', v_tx.amount, 'direction', v_tx.direction, 'remaining_dc', v_budget.remaining_dc, 'block_reason', null);
  end if;

  select * into v_budget from public.dc_budgets where id = p_dc_budget_id for update;
  if not found then raise exception 'budget not found'; end if;

  -- re-check idempotency under the row lock (a concurrent same-key tx may have committed meanwhile)
  select * into v_tx from public.dc_budget_transactions where idempotency_key = p_idempotency_key;
  if found then
    select * into v_budget from public.dc_budgets where id = v_tx.dc_budget_id;
    return jsonb_build_object('success', true, 'idempotent_replay', true, 'dc_budget_id', v_tx.dc_budget_id,
      'amount_consumed', v_tx.amount, 'direction', v_tx.direction, 'remaining_dc', v_budget.remaining_dc, 'block_reason', null);
  end if;

  if v_budget.status <> 'active' then
    return jsonb_build_object('success', false, 'block_reason', case v_budget.status
      when 'draft' then 'budget_draft' when 'paused' then 'budget_paused'
      when 'exhausted' then 'budget_exhausted' when 'expired' then 'budget_expired'
      when 'cancelled' then 'budget_cancelled' else 'budget_inactive' end, 'remaining_dc', v_budget.remaining_dc);
  end if;
  if v_budget.starts_at is not null and now() < v_budget.starts_at then
    return jsonb_build_object('success', false, 'block_reason', 'budget_not_started', 'remaining_dc', v_budget.remaining_dc);
  end if;
  if v_budget.ends_at is not null and now() > v_budget.ends_at then
    update public.dc_budgets set status='expired', updated_at=now() where id = v_budget.id;
    return jsonb_build_object('success', false, 'block_reason', 'budget_expired', 'remaining_dc', v_budget.remaining_dc);
  end if;

  if p_direction = 'grant' then
    if v_budget.remaining_dc < v_amount then
      return jsonb_build_object('success', false, 'block_reason', 'insufficient_budget', 'remaining_dc', v_budget.remaining_dc);
    end if;
    update public.dc_budgets
      set used_dc = used_dc + v_amount,
          status = case when used_dc + v_amount >= budget_dc then 'exhausted' else status end,
          updated_at = now()
      where id = v_budget.id
      returning * into v_budget;
  elsif p_direction = 'reversal' then
    if v_budget.used_dc < v_amount then raise exception 'reversal exceeds used_dc'; end if;
    update public.dc_budgets set used_dc = used_dc - v_amount, status = case when status='exhausted' then 'active' else status end, updated_at = now()
      where id = v_budget.id returning * into v_budget;
  else -- adjustment: signed semantics via reason; grant increases used, reversal-style adjustment not automatic
    if v_budget.used_dc + v_amount > v_budget.budget_dc then raise exception 'adjustment exceeds budget_dc'; end if;
    update public.dc_budgets set used_dc = used_dc + v_amount, updated_at = now() where id = v_budget.id returning * into v_budget;
  end if;

  insert into public.dc_budget_transactions (
    dc_budget_id, user_id, challenge_id, participant_id, direction, amount, balance_after, reason, external_source, external_id, idempotency_key, created_by
  ) values (
    v_budget.id, p_user_id, p_challenge_id, p_participant_id, p_direction, v_amount, v_budget.remaining_dc, p_reason, p_external_source, p_external_id, p_idempotency_key, auth.uid()
  ) returning * into v_tx;

  return jsonb_build_object('success', true, 'idempotent_replay', false, 'dc_budget_id', v_budget.id,
    'amount_consumed', v_amount, 'direction', p_direction, 'remaining_dc', v_budget.remaining_dc, 'block_reason', null, 'budget_status', v_budget.status);
end; $$;

revoke all on function public.consume_dc_budget_internal(uuid,bigint,text,uuid,uuid,uuid,text,text,uuid,text) from public, anon, authenticated;

create or replace function public.get_dadofit_schema_version()
returns text language sql stable as $$ select 'v15.7.17-eco4b-dc-budget-governance'::text; $$;
