-- DadoFit V15.0 - Rewards Marketplace Foundation
-- Turns the existing V9 rewards/wallet schema into an operational DadoCoins redemption marketplace.

alter table public.rewards
  add column if not exists image_url text,
  add column if not exists max_per_user integer not null default 1,
  add column if not exists fulfillment_type text not null default 'digital_code',
  add column if not exists fulfillment_instructions text,
  add column if not exists terms text,
  add column if not exists created_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by_user_id uuid references public.profiles(id) on delete set null;

alter table public.rewards drop constraint if exists rewards_max_per_user_check;
alter table public.rewards add constraint rewards_max_per_user_check check (max_per_user between 1 and 1000);
alter table public.rewards drop constraint if exists rewards_fulfillment_type_check;
alter table public.rewards add constraint rewards_fulfillment_type_check
  check (fulfillment_type in ('digital_code','digital_benefit','physical_product','in_person'));

alter table public.reward_redemptions
  add column if not exists reward_title_snapshot text,
  add column if not exists provider_name_snapshot text,
  add column if not exists reward_image_snapshot text,
  add column if not exists fulfillment_type text,
  add column if not exists fulfillment_instructions text,
  add column if not exists terms_snapshot text,
  add column if not exists issued_at timestamptz,
  add column if not exists expires_at timestamptz;

create table if not exists public.reward_offer_events (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.rewards(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reward_offer_events_reward_idx on public.reward_offer_events(reward_id, created_at desc);
create index if not exists reward_redemptions_reward_user_idx on public.reward_redemptions(reward_id, user_id, created_at desc);
create index if not exists rewards_org_status_idx on public.rewards(organization_id, status, created_at desc);

alter table public.reward_offer_events enable row level security;
revoke all on table public.reward_offer_events from anon, authenticated;
grant select on table public.reward_offer_events to authenticated;

create or replace function public.can_manage_rewards_for_org(p_organization_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and (
    public.is_platform_admin(p_user_id)
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = p_organization_id
        and om.user_id = p_user_id
        and om.status = 'active'
        and om.role in ('owner','admin')
    )
  );
$$;

revoke all on function public.can_manage_rewards_for_org(uuid,uuid) from public;
grant execute on function public.can_manage_rewards_for_org(uuid,uuid) to authenticated;

-- Replace the old broad rewards policy. Published offers are visible to everyone authenticated;
-- drafts/paused offers remain visible only to their managers and SuperAdmin.
drop policy if exists rewards_read_authenticated on public.rewards;
drop policy if exists rewards_read_visible_v15 on public.rewards;
create policy rewards_read_visible_v15
on public.rewards for select
to authenticated
using (
  (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and exists (
      select 1 from public.organizations o
      where o.id = rewards.organization_id
        and o.verification_status = 'verified'
    )
  )
  or public.can_manage_rewards_for_org(organization_id, auth.uid())
);

-- Providers need to inspect redemptions of their own rewards; users keep access to their own history.
drop policy if exists reward_redemptions_read_own on public.reward_redemptions;
drop policy if exists reward_redemptions_read_related_v15 on public.reward_redemptions;
create policy reward_redemptions_read_related_v15
on public.reward_redemptions for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.rewards r
    where r.id = reward_redemptions.reward_id
      and public.can_manage_rewards_for_org(r.organization_id, auth.uid())
  )
);

drop policy if exists reward_offer_events_read_related_v15 on public.reward_offer_events;
create policy reward_offer_events_read_related_v15
on public.reward_offer_events for select
to authenticated
using (public.can_manage_rewards_for_org(organization_id, auth.uid()));

create or replace function public.provider_create_reward(
  p_organization_id uuid,
  p_title text,
  p_description text,
  p_reward_type text,
  p_coin_cost bigint,
  p_inventory integer,
  p_max_per_user integer,
  p_image_url text,
  p_fulfillment_type text,
  p_fulfillment_instructions text,
  p_terms text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reward_id uuid;
  v_org public.organizations%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.can_manage_rewards_for_org(p_organization_id, v_actor) then raise exception 'only Owner/Admin can manage rewards for this organization'; end if;

  select * into v_org from public.organizations where id = p_organization_id;
  if not found then raise exception 'organization not found'; end if;
  if v_org.organization_type not in ('gym','brand','sponsor','company') then raise exception 'organization type cannot publish rewards'; end if;
  if length(btrim(coalesce(p_title,''))) < 3 or length(btrim(p_title)) > 160 then raise exception 'invalid reward title'; end if;
  if p_reward_type not in ('discount','product','gym_pass','subscription','experience','other') then raise exception 'invalid reward type'; end if;
  if p_coin_cost is null or p_coin_cost < 1 then raise exception 'coin cost must be greater than zero'; end if;
  if p_inventory is not null and p_inventory < 0 then raise exception 'inventory cannot be negative'; end if;
  if coalesce(p_max_per_user,0) < 1 or p_max_per_user > 1000 then raise exception 'invalid max per user'; end if;
  if p_fulfillment_type not in ('digital_code','digital_benefit','physical_product','in_person') then raise exception 'invalid fulfillment type'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then raise exception 'invalid reward window'; end if;

  insert into public.rewards(
    organization_id,title,description,reward_type,coin_cost,inventory,status,starts_at,ends_at,
    image_url,max_per_user,fulfillment_type,fulfillment_instructions,terms,created_by_user_id,updated_by_user_id
  ) values (
    p_organization_id,left(btrim(p_title),160),nullif(btrim(coalesce(p_description,'')),''),p_reward_type,p_coin_cost,p_inventory,'draft',p_starts_at,p_ends_at,
    nullif(left(btrim(coalesce(p_image_url,'')),1000),''),p_max_per_user,p_fulfillment_type,
    nullif(left(btrim(coalesce(p_fulfillment_instructions,'')),2000),''),nullif(left(btrim(coalesce(p_terms,'')),4000),''),v_actor,v_actor
  ) returning id into v_reward_id;

  insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,after_data)
  select v_reward_id,p_organization_id,v_actor,'reward_offer.create',to_jsonb(r) from public.rewards r where r.id=v_reward_id;

  return v_reward_id;
end;
$$;

revoke all on function public.provider_create_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz) from public;
grant execute on function public.provider_create_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz) to authenticated;

create or replace function public.provider_update_reward(
  p_reward_id uuid,
  p_title text,
  p_description text,
  p_reward_type text,
  p_coin_cost bigint,
  p_inventory integer,
  p_max_per_user integer,
  p_image_url text,
  p_fulfillment_type text,
  p_fulfillment_instructions text,
  p_terms text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reward public.rewards%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_claimed integer;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found then raise exception 'reward not found'; end if;
  if not public.can_manage_rewards_for_org(v_reward.organization_id,v_actor) then raise exception 'only Owner/Admin can manage this reward'; end if;
  if v_reward.status='ended' then raise exception 'ended rewards are read-only'; end if;

  if length(btrim(coalesce(p_title,''))) < 3 or length(btrim(p_title)) > 160 then raise exception 'invalid reward title'; end if;
  if p_reward_type not in ('discount','product','gym_pass','subscription','experience','other') then raise exception 'invalid reward type'; end if;
  if p_coin_cost is null or p_coin_cost < 1 then raise exception 'coin cost must be greater than zero'; end if;
  if p_inventory is not null and p_inventory < 0 then raise exception 'inventory cannot be negative'; end if;
  if coalesce(p_max_per_user,0) < 1 or p_max_per_user > 1000 then raise exception 'invalid max per user'; end if;
  if p_fulfillment_type not in ('digital_code','digital_benefit','physical_product','in_person') then raise exception 'invalid fulfillment type'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then raise exception 'invalid reward window'; end if;

  select count(*)::integer into v_claimed from public.reward_redemptions rr where rr.reward_id=p_reward_id and rr.status<>'cancelled';
  if p_inventory is not null and p_inventory < v_claimed then raise exception 'inventory cannot be lower than existing redemptions (%)',v_claimed; end if;

  v_before:=to_jsonb(v_reward);
  update public.rewards
  set title=left(btrim(p_title),160),description=nullif(btrim(coalesce(p_description,'')),''),reward_type=p_reward_type,
      coin_cost=p_coin_cost,inventory=p_inventory,max_per_user=p_max_per_user,image_url=nullif(left(btrim(coalesce(p_image_url,'')),1000),''),
      fulfillment_type=p_fulfillment_type,fulfillment_instructions=nullif(left(btrim(coalesce(p_fulfillment_instructions,'')),2000),''),
      terms=nullif(left(btrim(coalesce(p_terms,'')),4000),''),starts_at=p_starts_at,ends_at=p_ends_at,updated_by_user_id=v_actor,updated_at=now()
  where id=p_reward_id;
  select to_jsonb(r) into v_after from public.rewards r where r.id=p_reward_id;
  insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,before_data,after_data)
  values(p_reward_id,v_reward.organization_id,v_actor,'reward_offer.update',v_before,v_after);
  return p_reward_id;
end;
$$;

revoke all on function public.provider_update_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz) from public;
grant execute on function public.provider_update_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz) to authenticated;

create or replace function public.provider_set_reward_status(p_reward_id uuid,p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid:=auth.uid();
  v_reward public.rewards%rowtype;
  v_org public.organizations%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_claimed integer;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_status not in ('draft','active','paused','ended') then raise exception 'invalid reward status'; end if;
  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found then raise exception 'reward not found'; end if;
  if not public.can_manage_rewards_for_org(v_reward.organization_id,v_actor) then raise exception 'only Owner/Admin can manage this reward'; end if;
  select * into v_org from public.organizations where id=v_reward.organization_id;

  if p_status='active' then
    if v_org.verification_status<>'verified' then raise exception 'organization must be verified before publishing rewards'; end if;
    if v_reward.coin_cost<1 then raise exception 'invalid coin cost'; end if;
    if v_reward.ends_at is not null and v_reward.ends_at<=now() then raise exception 'reward has already expired'; end if;
    select count(*)::integer into v_claimed from public.reward_redemptions rr where rr.reward_id=p_reward_id and rr.status<>'cancelled';
    if v_reward.inventory is not null and v_claimed>=v_reward.inventory then raise exception 'reward is sold out'; end if;
  end if;

  v_before:=to_jsonb(v_reward);
  update public.rewards set status=p_status,updated_by_user_id=v_actor,updated_at=now() where id=p_reward_id;
  select to_jsonb(r) into v_after from public.rewards r where r.id=p_reward_id;
  insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,before_data,after_data)
  values(p_reward_id,v_reward.organization_id,v_actor,'reward_offer.status.change',v_before,v_after);
  return p_status;
end;
$$;

revoke all on function public.provider_set_reward_status(uuid,text) from public;
grant execute on function public.provider_set_reward_status(uuid,text) to authenticated;

create or replace function public.provider_list_rewards(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid:=auth.uid();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.can_manage_rewards_for_org(p_organization_id,v_actor) then raise exception 'only Owner/Admin can manage rewards for this organization'; end if;

  select coalesce(jsonb_agg(item order by (item->>'created_at') desc),'[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id',r.id,'organization_id',r.organization_id,'title',r.title,'description',r.description,'reward_type',r.reward_type,
      'coin_cost',r.coin_cost,'inventory',r.inventory,'max_per_user',r.max_per_user,'status',r.status,'starts_at',r.starts_at,'ends_at',r.ends_at,
      'image_url',r.image_url,'fulfillment_type',r.fulfillment_type,'fulfillment_instructions',r.fulfillment_instructions,'terms',r.terms,
      'created_at',r.created_at,'updated_at',r.updated_at,
      'redemptions',(select count(*) from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled'),
      'remaining_stock',case when r.inventory is null then null else greatest(r.inventory-(select count(*)::integer from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled'),0) end
    ) item
    from public.rewards r
    where r.organization_id=p_organization_id
  ) q;
  return v_result;
end;
$$;

revoke all on function public.provider_list_rewards(uuid) from public;
grant execute on function public.provider_list_rewards(uuid) to authenticated;

create or replace function public.get_reward_marketplace()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid:=auth.uid();
  v_balance bigint:=0;
  v_offers jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select coalesce(w.balance,0) into v_balance from public.wallets w where w.user_id=v_actor;

  select coalesce(jsonb_agg(item order by (item->>'created_at') desc),'[]'::jsonb)
  into v_offers
  from (
    select jsonb_build_object(
      'id',r.id,'provider_id',o.id,'provider_name',o.name,'provider_type',o.organization_type,'title',r.title,'description',r.description,
      'reward_type',r.reward_type,'coin_cost',r.coin_cost,'inventory',r.inventory,'max_per_user',r.max_per_user,'image_url',r.image_url,
      'fulfillment_type',r.fulfillment_type,'terms',r.terms,'starts_at',r.starts_at,'ends_at',r.ends_at,'created_at',r.created_at,
      'user_redemptions',(select count(*) from public.reward_redemptions rr where rr.reward_id=r.id and rr.user_id=v_actor and rr.status<>'cancelled'),
      'remaining_stock',case when r.inventory is null then null else greatest(r.inventory-(select count(*)::integer from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled'),0) end,
      'availability_status',case
        when r.inventory is not null and (select count(*) from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled')>=r.inventory then 'sold_out'
        when (select count(*) from public.reward_redemptions rr where rr.reward_id=r.id and rr.user_id=v_actor and rr.status<>'cancelled')>=r.max_per_user then 'limit_reached'
        when v_balance<r.coin_cost then 'insufficient_balance'
        else 'available' end,
      'can_redeem',(
        (r.inventory is null or (select count(*) from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled')<r.inventory)
        and (select count(*) from public.reward_redemptions rr where rr.reward_id=r.id and rr.user_id=v_actor and rr.status<>'cancelled')<r.max_per_user
        and v_balance>=r.coin_cost
      )
    ) item
    from public.rewards r
    join public.organizations o on o.id=r.organization_id
    where r.status='active'
      and o.verification_status='verified'
      and (r.starts_at is null or r.starts_at<=now())
      and (r.ends_at is null or r.ends_at>now())
  ) q;

  return jsonb_build_object('balance',v_balance,'offers',v_offers);
end;
$$;

revoke all on function public.get_reward_marketplace() from public;
grant execute on function public.get_reward_marketplace() to authenticated;

create or replace function public.get_my_reward_redemptions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',rr.id,'reward_id',rr.reward_id,'title',coalesce(rr.reward_title_snapshot,r.title),'provider_name',coalesce(rr.provider_name_snapshot,o.name),
    'image_url',coalesce(rr.reward_image_snapshot,r.image_url),'coin_cost',rr.coin_cost,'status',rr.status,'redemption_code',rr.redemption_code,
    'fulfillment_type',coalesce(rr.fulfillment_type,r.fulfillment_type),'fulfillment_instructions',coalesce(rr.fulfillment_instructions,r.fulfillment_instructions),
    'terms',coalesce(rr.terms_snapshot,r.terms),'created_at',rr.created_at,'issued_at',rr.issued_at,'redeemed_at',rr.redeemed_at,'expires_at',rr.expires_at
  ) order by rr.created_at desc),'[]'::jsonb)
  into v_result
  from public.reward_redemptions rr
  join public.rewards r on r.id=rr.reward_id
  left join public.organizations o on o.id=r.organization_id
  where rr.user_id=v_actor;
  return v_result;
end;
$$;

revoke all on function public.get_my_reward_redemptions() from public;
grant execute on function public.get_my_reward_redemptions() to authenticated;

create or replace function public.redeem_reward(p_reward_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid:=auth.uid();
  v_reward public.rewards%rowtype;
  v_org public.organizations%rowtype;
  v_wallet public.wallets%rowtype;
  v_claimed integer;
  v_user_claimed integer;
  v_redemption_id uuid:=gen_random_uuid();
  v_code text;
  v_new_balance bigint;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found then raise exception 'reward not found'; end if;
  select * into v_org from public.organizations where id=v_reward.organization_id;

  if v_reward.status<>'active' then raise exception 'reward is not active'; end if;
  if v_org.verification_status<>'verified' then raise exception 'reward provider is not verified'; end if;
  if v_reward.starts_at is not null and v_reward.starts_at>now() then raise exception 'reward is not available yet'; end if;
  if v_reward.ends_at is not null and v_reward.ends_at<=now() then raise exception 'reward has expired'; end if;

  select count(*)::integer into v_claimed from public.reward_redemptions rr where rr.reward_id=p_reward_id and rr.status<>'cancelled';
  if v_reward.inventory is not null and v_claimed>=v_reward.inventory then raise exception 'reward is sold out'; end if;
  select count(*)::integer into v_user_claimed from public.reward_redemptions rr where rr.reward_id=p_reward_id and rr.user_id=v_actor and rr.status<>'cancelled';
  if v_user_claimed>=v_reward.max_per_user then raise exception 'redemption limit reached for this reward'; end if;

  select * into v_wallet from public.wallets where user_id=v_actor for update;
  if not found then raise exception 'wallet not found'; end if;
  if v_wallet.balance<v_reward.coin_cost then raise exception 'insufficient DadoCoins'; end if;

  v_code:='DF-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  update public.wallets set balance=balance-v_reward.coin_cost,updated_at=now() where id=v_wallet.id returning balance into v_new_balance;
  insert into public.wallet_transactions(wallet_id,amount,source_type,source_id,description,idempotency_key)
  values(v_wallet.id,-v_reward.coin_cost,'reward_redemption',p_reward_id,'Canje: '||v_reward.title,'reward-redemption:'||v_redemption_id::text);

  insert into public.reward_redemptions(
    id,reward_id,user_id,coin_cost,status,redemption_code,reward_title_snapshot,provider_name_snapshot,reward_image_snapshot,
    fulfillment_type,fulfillment_instructions,terms_snapshot,issued_at,expires_at
  ) values (
    v_redemption_id,p_reward_id,v_actor,v_reward.coin_cost,'issued',v_code,v_reward.title,v_org.name,v_reward.image_url,
    v_reward.fulfillment_type,v_reward.fulfillment_instructions,v_reward.terms,now(),v_reward.ends_at
  );

  insert into public.notifications(user_id,notification_type,title,body,data)
  values(v_actor,'reward_redeemed','Premio canjeado',format('%s por %s DC',v_reward.title,v_reward.coin_cost),jsonb_build_object('reward_id',p_reward_id,'redemption_id',v_redemption_id,'code',v_code));

  return jsonb_build_object('redemption_id',v_redemption_id,'reward_id',p_reward_id,'title',v_reward.title,'provider_name',v_org.name,
    'coin_cost',v_reward.coin_cost,'new_balance',v_new_balance,'redemption_code',v_code,'status','issued',
    'fulfillment_type',v_reward.fulfillment_type,'fulfillment_instructions',v_reward.fulfillment_instructions);
end;
$$;

revoke all on function public.redeem_reward(uuid) from public;
grant execute on function public.redeem_reward(uuid) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$ select 'v15.0-rewards-marketplace-foundation'::text; $$;

revoke all on function public.get_dadofit_schema_version() from public;
grant execute on function public.get_dadofit_schema_version() to anon, authenticated;
