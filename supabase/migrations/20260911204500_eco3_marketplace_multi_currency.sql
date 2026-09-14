-- DadoFit V15.7.15 / ECO-3 - Marketplace multi-currency
-- Reward payment contract:
--   Gym reward   -> own Gym GP OR DadoCoins
--   Brand reward -> own Brand SP OR DadoCoins
--   one redemption = one currency only; no mixed payments.
-- Historical Gym score is never debited by GP redemption.

alter table public.rewards
  add column if not exists native_currency text,
  add column if not exists native_cost bigint;

alter table public.rewards drop constraint if exists rewards_native_currency_check;
alter table public.rewards add constraint rewards_native_currency_check
  check (native_currency is null or native_currency in ('gp','sp'));

alter table public.rewards drop constraint if exists rewards_native_cost_check;
alter table public.rewards add constraint rewards_native_cost_check
  check (native_cost is null or native_cost > 0);

-- Existing offers are intentionally NOT assigned an arbitrary GP/SP exchange rate.
-- They remain DC-only until their provider edits them and sets a native price.
update public.rewards r
set native_currency = case
  when o.organization_type='gym' then 'gp'
  when o.organization_type in ('brand','sponsor','company') then 'sp'
  else null
end
from public.organizations o
where o.id=r.organization_id
  and r.native_currency is null;

alter table public.reward_redemptions
  add column if not exists payment_currency text,
  add column if not exists payment_amount bigint,
  add column if not exists payment_organization_id uuid references public.organizations(id) on delete set null;

update public.reward_redemptions
set payment_currency='dc',
    payment_amount=coin_cost
where payment_currency is null or payment_amount is null;

alter table public.reward_redemptions alter column payment_currency set default 'dc';
alter table public.reward_redemptions alter column payment_currency set not null;
alter table public.reward_redemptions alter column payment_amount set default 0;
alter table public.reward_redemptions alter column payment_amount set not null;

alter table public.reward_redemptions drop constraint if exists reward_redemptions_payment_currency_check;
alter table public.reward_redemptions add constraint reward_redemptions_payment_currency_check
  check (payment_currency in ('dc','gp','sp'));

alter table public.reward_redemptions drop constraint if exists reward_redemptions_payment_amount_check;
alter table public.reward_redemptions add constraint reward_redemptions_payment_amount_check
  check (payment_amount >= 0);

-- Internal-only GP debit primitive. Active Gym membership is required at redemption time.
create or replace function public.spend_gym_points_internal(
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
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Gym Points spend must be greater than zero'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'idempotency key is required'; end if;
  if not exists(select 1 from public.organizations o where o.id=p_gym_organization_id and o.organization_type='gym') then
    raise exception 'invalid Gym organization';
  end if;
  if not exists(
    select 1 from public.organization_members om
    where om.organization_id=p_gym_organization_id and om.user_id=p_user_id and om.status='active'
  ) then
    raise exception 'active Gym membership is required to spend GP';
  end if;

  if exists(select 1 from public.gym_point_ledger l where l.idempotency_key=p_idempotency_key) then
    select w.balance into v_balance from public.gym_point_wallets w
    where w.user_id=p_user_id and w.gym_organization_id=p_gym_organization_id;
    return query select coalesce(v_balance,0);
    return;
  end if;

  select w.balance into v_balance
  from public.gym_point_wallets w
  where w.user_id=p_user_id and w.gym_organization_id=p_gym_organization_id
  for update;

  if not found or coalesce(v_balance,0) < p_amount then raise exception 'insufficient Gym Points'; end if;

  update public.gym_point_wallets
  set balance=balance-p_amount,
      lifetime_spent=lifetime_spent+p_amount,
      updated_at=now()
  where user_id=p_user_id and gym_organization_id=p_gym_organization_id
  returning balance into v_balance;

  insert into public.gym_point_ledger(
    user_id,gym_organization_id,amount,balance_after,entry_type,source_type,source_id,description,idempotency_key
  ) values(
    p_user_id,p_gym_organization_id,-p_amount,v_balance,'redeem',left(coalesce(p_source_type,'unknown'),80),p_source_id,
    nullif(left(btrim(coalesce(p_description,'')),300),''),p_idempotency_key
  );

  return query select v_balance;
end;
$$;

revoke all on function public.spend_gym_points_internal(uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated;

-- Internal-only SP debit primitive. SP remain isolated by sponsor organization.
create or replace function public.spend_sponsor_points_internal(
  p_user_id uuid,
  p_sponsor_organization_id uuid,
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
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Sponsor Points spend must be greater than zero'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'idempotency key is required'; end if;
  if not public.is_brand_organization(p_sponsor_organization_id) then raise exception 'invalid Brand/Sponsor organization'; end if;

  if exists(select 1 from public.sponsor_point_ledger l where l.idempotency_key=p_idempotency_key) then
    select w.balance into v_balance from public.sponsor_point_wallets w
    where w.user_id=p_user_id and w.sponsor_organization_id=p_sponsor_organization_id;
    return query select coalesce(v_balance,0);
    return;
  end if;

  select w.balance into v_balance
  from public.sponsor_point_wallets w
  where w.user_id=p_user_id and w.sponsor_organization_id=p_sponsor_organization_id
  for update;

  if not found or coalesce(v_balance,0) < p_amount then raise exception 'insufficient Sponsor Points'; end if;

  update public.sponsor_point_wallets
  set balance=balance-p_amount,
      lifetime_spent=lifetime_spent+p_amount,
      updated_at=now()
  where user_id=p_user_id and sponsor_organization_id=p_sponsor_organization_id
  returning balance into v_balance;

  insert into public.sponsor_point_ledger(
    user_id,sponsor_organization_id,amount,balance_after,entry_type,source_type,source_id,description,idempotency_key
  ) values(
    p_user_id,p_sponsor_organization_id,-p_amount,v_balance,'redeem',left(coalesce(p_source_type,'unknown'),80),p_source_id,
    nullif(left(btrim(coalesce(p_description,'')),300),''),p_idempotency_key
  );

  return query select v_balance;
end;
$$;

revoke all on function public.spend_sponsor_points_internal(uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated;

-- Replace provider create/update RPCs, adding the provider-native price.
drop function if exists public.provider_create_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text);
drop function if exists public.provider_update_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text);

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
  p_ends_at timestamptz,
  p_fulfillment_mode text default 'generated_code',
  p_shared_code text default null,
  p_redemption_url text default null,
  p_coupon_codes text default null,
  p_native_cost bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid:=auth.uid();
  v_reward_id uuid;
  v_org public.organizations%rowtype;
  v_native_currency text;
  v_codes_added integer:=0;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.can_manage_rewards_for_org(p_organization_id,v_actor) then raise exception 'only Owner/Admin can manage rewards for this organization'; end if;
  select * into v_org from public.organizations where id=p_organization_id;
  if not found then raise exception 'organization not found'; end if;
  if v_org.organization_type not in ('gym','brand','sponsor','company') then raise exception 'organization type cannot publish rewards'; end if;

  v_native_currency:=case when v_org.organization_type='gym' then 'gp' else 'sp' end;

  if length(btrim(coalesce(p_title,'')))<3 or length(btrim(p_title))>160 then raise exception 'invalid reward title'; end if;
  if p_reward_type not in ('discount','product','gym_pass','subscription','experience','other') then raise exception 'invalid reward type'; end if;
  if p_coin_cost is null or p_coin_cost<1 then raise exception 'DC cost must be greater than zero'; end if;
  if p_native_cost is null or p_native_cost<1 then raise exception '% cost must be greater than zero',upper(v_native_currency); end if;
  if p_inventory is not null and p_inventory<0 then raise exception 'inventory cannot be negative'; end if;
  if coalesce(p_max_per_user,0)<1 or p_max_per_user>1000 then raise exception 'invalid max per user'; end if;
  if p_fulfillment_type not in ('digital_code','digital_benefit','physical_product','in_person') then raise exception 'invalid fulfillment type'; end if;
  if p_fulfillment_mode not in ('generated_code','shared_code','code_pool','redemption_url','instructions_only') then raise exception 'invalid fulfillment mode'; end if;
  if p_fulfillment_type='digital_code' and p_fulfillment_mode not in ('generated_code','shared_code','code_pool') then raise exception 'digital code rewards require generated, shared or pool mode'; end if;
  if p_fulfillment_type in ('physical_product','in_person') and p_fulfillment_mode<>'instructions_only' then raise exception 'physical and in-person rewards use instructions-only mode'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'invalid reward window'; end if;

  insert into public.rewards(
    organization_id,title,description,reward_type,coin_cost,native_currency,native_cost,inventory,status,starts_at,ends_at,
    image_url,max_per_user,fulfillment_type,fulfillment_mode,shared_code,redemption_url,
    fulfillment_instructions,terms,created_by_user_id,updated_by_user_id
  ) values(
    p_organization_id,left(btrim(p_title),160),nullif(btrim(coalesce(p_description,'')),''),p_reward_type,p_coin_cost,v_native_currency,p_native_cost,p_inventory,'draft',p_starts_at,p_ends_at,
    nullif(left(btrim(coalesce(p_image_url,'')),1000),''),p_max_per_user,p_fulfillment_type,p_fulfillment_mode,
    nullif(left(btrim(coalesce(p_shared_code,'')),180),''),nullif(left(btrim(coalesce(p_redemption_url,'')),1000),''),
    nullif(left(btrim(coalesce(p_fulfillment_instructions,'')),2000),''),nullif(left(btrim(coalesce(p_terms,'')),4000),''),v_actor,v_actor
  ) returning id into v_reward_id;

  v_codes_added:=public.add_reward_coupon_codes_internal(v_reward_id,p_coupon_codes);
  insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,after_data)
  select v_reward_id,p_organization_id,v_actor,'reward_offer.create',to_jsonb(r) from public.rewards r where r.id=v_reward_id;
  if v_codes_added>0 then
    insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,after_data)
    values(v_reward_id,p_organization_id,v_actor,'reward_offer.codes.add',jsonb_build_object('added',v_codes_added));
  end if;
  return v_reward_id;
end;
$$;

revoke all on function public.provider_create_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text,bigint) from public;
grant execute on function public.provider_create_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text,bigint) to authenticated;

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
  p_ends_at timestamptz,
  p_fulfillment_mode text default 'generated_code',
  p_shared_code text default null,
  p_redemption_url text default null,
  p_coupon_codes text default null,
  p_native_cost bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid:=auth.uid();
  v_reward public.rewards%rowtype;
  v_org public.organizations%rowtype;
  v_native_currency text;
  v_before jsonb;
  v_after jsonb;
  v_claimed integer;
  v_codes_added integer:=0;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found then raise exception 'reward not found'; end if;
  if not public.can_manage_rewards_for_org(v_reward.organization_id,v_actor) then raise exception 'only Owner/Admin can manage this reward'; end if;
  if v_reward.status='ended' then raise exception 'ended rewards are read-only'; end if;
  select * into v_org from public.organizations where id=v_reward.organization_id;
  v_native_currency:=case when v_org.organization_type='gym' then 'gp' else 'sp' end;

  if length(btrim(coalesce(p_title,'')))<3 or length(btrim(p_title))>160 then raise exception 'invalid reward title'; end if;
  if p_reward_type not in ('discount','product','gym_pass','subscription','experience','other') then raise exception 'invalid reward type'; end if;
  if p_coin_cost is null or p_coin_cost<1 then raise exception 'DC cost must be greater than zero'; end if;
  if p_native_cost is null or p_native_cost<1 then raise exception '% cost must be greater than zero',upper(v_native_currency); end if;
  if p_inventory is not null and p_inventory<0 then raise exception 'inventory cannot be negative'; end if;
  if coalesce(p_max_per_user,0)<1 or p_max_per_user>1000 then raise exception 'invalid max per user'; end if;
  if p_fulfillment_type not in ('digital_code','digital_benefit','physical_product','in_person') then raise exception 'invalid fulfillment type'; end if;
  if p_fulfillment_mode not in ('generated_code','shared_code','code_pool','redemption_url','instructions_only') then raise exception 'invalid fulfillment mode'; end if;
  if p_fulfillment_type='digital_code' and p_fulfillment_mode not in ('generated_code','shared_code','code_pool') then raise exception 'digital code rewards require generated, shared or pool mode'; end if;
  if p_fulfillment_type in ('physical_product','in_person') and p_fulfillment_mode<>'instructions_only' then raise exception 'physical and in-person rewards use instructions-only mode'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'invalid reward window'; end if;

  select count(*)::integer into v_claimed from public.reward_redemptions rr where rr.reward_id=p_reward_id and rr.status<>'cancelled';
  if p_inventory is not null and p_inventory<v_claimed then raise exception 'inventory cannot be lower than existing redemptions (%)',v_claimed; end if;

  v_before:=to_jsonb(v_reward);
  update public.rewards set
    title=left(btrim(p_title),160),description=nullif(btrim(coalesce(p_description,'')),''),reward_type=p_reward_type,
    coin_cost=p_coin_cost,native_currency=v_native_currency,native_cost=p_native_cost,inventory=p_inventory,max_per_user=p_max_per_user,
    image_url=nullif(left(btrim(coalesce(p_image_url,'')),1000),''),fulfillment_type=p_fulfillment_type,fulfillment_mode=p_fulfillment_mode,
    shared_code=nullif(left(btrim(coalesce(p_shared_code,'')),180),''),redemption_url=nullif(left(btrim(coalesce(p_redemption_url,'')),1000),''),
    fulfillment_instructions=nullif(left(btrim(coalesce(p_fulfillment_instructions,'')),2000),''),terms=nullif(left(btrim(coalesce(p_terms,'')),4000),''),
    starts_at=p_starts_at,ends_at=p_ends_at,updated_by_user_id=v_actor,updated_at=now()
  where id=p_reward_id;

  v_codes_added:=public.add_reward_coupon_codes_internal(p_reward_id,p_coupon_codes);
  if v_reward.status='active' then
    if p_fulfillment_mode='shared_code' and nullif(btrim(coalesce(p_shared_code,'')),'') is null then raise exception 'shared promo code is required for an active reward'; end if;
    if p_fulfillment_mode='redemption_url' and coalesce(p_redemption_url,'') !~* '^https?://' then raise exception 'valid redemption URL is required for an active reward'; end if;
    if p_fulfillment_mode='code_pool' and coalesce(public.reward_remaining_stock(p_reward_id),0)<=0 then raise exception 'active reward requires at least one available promo code'; end if;
  end if;

  select to_jsonb(r) into v_after from public.rewards r where r.id=p_reward_id;
  insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,before_data,after_data)
  values(p_reward_id,v_reward.organization_id,v_actor,'reward_offer.update',v_before,v_after);
  if v_codes_added>0 then
    insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,after_data)
    values(p_reward_id,v_reward.organization_id,v_actor,'reward_offer.codes.add',jsonb_build_object('added',v_codes_added));
  end if;
  return p_reward_id;
end;
$$;

revoke all on function public.provider_update_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text,bigint) from public;
grant execute on function public.provider_update_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text,bigint) to authenticated;

-- Provider list now exposes both prices.
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

  select coalesce(jsonb_agg(item order by (item->>'created_at') desc),'[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id',r.id,'organization_id',r.organization_id,'title',r.title,'description',r.description,'reward_type',r.reward_type,
      'coin_cost',r.coin_cost,'native_currency',r.native_currency,'native_cost',r.native_cost,
      'inventory',r.inventory,'max_per_user',r.max_per_user,'status',r.status,'starts_at',r.starts_at,'ends_at',r.ends_at,
      'image_url',r.image_url,'fulfillment_type',r.fulfillment_type,'fulfillment_mode',r.fulfillment_mode,'shared_code',r.shared_code,
      'redemption_url',r.redemption_url,'fulfillment_instructions',r.fulfillment_instructions,'terms',r.terms,
      'created_at',r.created_at,'updated_at',r.updated_at,
      'redemptions',(select count(*) from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled'),
      'remaining_stock',public.reward_remaining_stock(r.id),
      'code_pool_total',(select count(*) from public.reward_coupon_codes c where c.reward_id=r.id),
      'code_pool_available',(select count(*) from public.reward_coupon_codes c where c.reward_id=r.id and c.status='available'),
      'code_pool_assigned',(select count(*) from public.reward_coupon_codes c where c.reward_id=r.id and c.status='assigned')
    ) item
    from public.rewards r
    where r.organization_id=p_organization_id
  ) q;
  return v_result;
end;
$$;

revoke all on function public.provider_list_rewards(uuid) from public;
grant execute on function public.provider_list_rewards(uuid) to authenticated;

-- Publication requires the native price for Gym/Brand offers. Existing already-active legacy offers
-- are not mutated automatically; when edited/reactivated they must comply with ECO-3.
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
  v_remaining integer;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_status not in ('draft','active','paused','ended') then raise exception 'invalid reward status'; end if;
  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found then raise exception 'reward not found'; end if;
  if not public.can_manage_rewards_for_org(v_reward.organization_id,v_actor) then raise exception 'only Owner/Admin can manage this reward'; end if;
  select * into v_org from public.organizations where id=v_reward.organization_id;

  if p_status='active' then
    if v_org.verification_status<>'verified' then raise exception 'organization must be verified before publishing rewards'; end if;
    if v_reward.coin_cost<1 then raise exception 'invalid DC cost'; end if;
    if v_org.organization_type='gym' and (v_reward.native_currency<>'gp' or coalesce(v_reward.native_cost,0)<1) then raise exception 'Gym rewards require a GP price plus the DC alternative'; end if;
    if v_org.organization_type in ('brand','sponsor','company') and (v_reward.native_currency<>'sp' or coalesce(v_reward.native_cost,0)<1) then raise exception 'Brand rewards require an SP price plus the DC alternative'; end if;
    if v_reward.ends_at is not null and v_reward.ends_at<=now() then raise exception 'reward has already expired'; end if;
    if v_reward.fulfillment_mode='shared_code' and nullif(btrim(coalesce(v_reward.shared_code,'')),'') is null then raise exception 'shared promo code is required before publishing'; end if;
    if v_reward.fulfillment_mode='redemption_url' and coalesce(v_reward.redemption_url,'') !~* '^https?://' then raise exception 'valid redemption URL is required before publishing'; end if;
    select public.reward_remaining_stock(p_reward_id) into v_remaining;
    if v_remaining is not null and v_remaining<=0 then raise exception 'reward is sold out'; end if;
  end if;

  v_before:=to_jsonb(v_reward);
  update public.rewards set status=p_status,updated_by_user_id=v_actor,updated_at=now() where id=p_reward_id;
  select to_jsonb(r) into v_after from public.rewards r where r.id=p_reward_id;
  insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,before_data,after_data)
  values(p_reward_id,v_reward.organization_id,v_actor,'reward_offer.status.change',v_before,v_after);

  if p_status='active' and v_reward.status<>'active' and v_org.organization_type='gym' then
    insert into public.notifications(user_id,notification_type,title,body,data)
    select om.user_id,'gym_reward_published','Nuevo premio en '||v_org.name,
      format('%s · %s GP o %s DC',v_reward.title,v_reward.native_cost,v_reward.coin_cost),
      jsonb_build_object('organization_id',v_org.id,'reward_id',p_reward_id,'route','/rewards','coin_cost',v_reward.coin_cost,'native_currency','gp','native_cost',v_reward.native_cost)
    from public.organization_members om
    where om.organization_id=v_org.id and om.status='active' and om.user_id<>v_actor
      and not exists(select 1 from public.notifications n where n.user_id=om.user_id and n.notification_type='gym_reward_published' and n.data->>'reward_id'=p_reward_id::text);
  end if;

  return p_status;
end;
$$;

revoke all on function public.provider_set_reward_status(uuid,text) from public;
grant execute on function public.provider_set_reward_status(uuid,text) to authenticated;

-- Marketplace returns both wallet options, but never sums GP/SP across organizations.
create or replace function public.get_reward_marketplace()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid:=auth.uid();
  v_dc_balance bigint:=0;
  v_offers jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select coalesce((select w.balance from public.wallets w where w.user_id=v_actor),0) into v_dc_balance;

  select coalesce(jsonb_agg(item order by (item->>'created_at') desc),'[]'::jsonb) into v_offers
  from (
    select jsonb_build_object(
      'id',r.id,'provider_id',o.id,'provider_name',o.name,'provider_type',o.organization_type,
      'title',r.title,'description',r.description,'reward_type',r.reward_type,
      'coin_cost',r.coin_cost,'native_currency',r.native_currency,'native_cost',r.native_cost,
      'native_balance',nb.native_balance,'native_eligible',nb.native_eligible,
      'native_can_redeem',(r.native_cost is not null and nb.native_eligible and nb.native_balance>=r.native_cost and stock.ok and ur.ok),
      'dc_can_redeem',(v_dc_balance>=r.coin_cost and stock.ok and ur.ok),
      'inventory',r.inventory,'max_per_user',r.max_per_user,'image_url',r.image_url,
      'fulfillment_type',r.fulfillment_type,'fulfillment_mode',r.fulfillment_mode,'terms',r.terms,'starts_at',r.starts_at,'ends_at',r.ends_at,'created_at',r.created_at,
      'user_redemptions',ur.claimed,'remaining_stock',stock.remaining,
      'availability_status',case
        when not stock.ok then 'sold_out'
        when not ur.ok then 'limit_reached'
        when v_dc_balance<r.coin_cost and not (r.native_cost is not null and nb.native_eligible and nb.native_balance>=r.native_cost) then 'insufficient_balance'
        else 'available' end,
      'can_redeem',(stock.ok and ur.ok and (v_dc_balance>=r.coin_cost or (r.native_cost is not null and nb.native_eligible and nb.native_balance>=r.native_cost)))
    ) item
    from public.rewards r
    join public.organizations o on o.id=r.organization_id
    cross join lateral (
      select count(*)::integer as claimed,
             count(*)<r.max_per_user as ok
      from public.reward_redemptions rr
      where rr.reward_id=r.id and rr.user_id=v_actor and rr.status<>'cancelled'
    ) ur
    cross join lateral (
      select public.reward_remaining_stock(r.id) as remaining,
             (public.reward_remaining_stock(r.id) is null or public.reward_remaining_stock(r.id)>0) as ok
    ) stock
    cross join lateral (
      select
        case
          when r.native_currency='gp' then coalesce((select w.balance from public.gym_point_wallets w where w.user_id=v_actor and w.gym_organization_id=o.id),0)
          when r.native_currency='sp' then coalesce((select w.balance from public.sponsor_point_wallets w where w.user_id=v_actor and w.sponsor_organization_id=o.id),0)
          else 0
        end::bigint as native_balance,
        case
          when r.native_currency='gp' then exists(select 1 from public.organization_members om where om.organization_id=o.id and om.user_id=v_actor and om.status='active')
          when r.native_currency='sp' then true
          else false
        end as native_eligible
    ) nb
    where r.status='active'
      and o.verification_status='verified'
      and (r.starts_at is null or r.starts_at<=now())
      and (r.ends_at is null or r.ends_at>now())
  ) q;

  return jsonb_build_object('balance',v_dc_balance,'offers',v_offers);
end;
$$;

revoke all on function public.get_reward_marketplace() from public;
grant execute on function public.get_reward_marketplace() to authenticated;

-- Replace one-argument DC-only redemption with explicit single-currency payment.
drop function if exists public.redeem_reward(uuid);

create or replace function public.redeem_reward(p_reward_id uuid,p_payment_method text default 'dc')
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
  v_method text:=lower(btrim(coalesce(p_payment_method,'dc')));
  v_amount bigint;
  v_user_claimed integer;
  v_redemption_id uuid:=gen_random_uuid();
  v_reference text;
  v_code text;
  v_url text;
  v_coupon_id uuid;
  v_new_balance bigint;
  v_remaining integer;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if v_method not in ('dc','gp','sp') then raise exception 'invalid payment method'; end if;

  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found then raise exception 'reward not found'; end if;
  select * into v_org from public.organizations where id=v_reward.organization_id;

  if v_reward.status<>'active' then raise exception 'reward is not active'; end if;
  if v_org.verification_status<>'verified' then raise exception 'reward provider is not verified'; end if;
  if v_reward.starts_at is not null and v_reward.starts_at>now() then raise exception 'reward is not available yet'; end if;
  if v_reward.ends_at is not null and v_reward.ends_at<=now() then raise exception 'reward has expired'; end if;

  select public.reward_remaining_stock(p_reward_id) into v_remaining;
  if v_remaining is not null and v_remaining<=0 then raise exception 'reward is sold out'; end if;

  select count(*)::integer into v_user_claimed from public.reward_redemptions rr
  where rr.reward_id=p_reward_id and rr.user_id=v_actor and rr.status<>'cancelled';
  if v_user_claimed>=v_reward.max_per_user then raise exception 'redemption limit reached for this reward'; end if;

  if v_method='dc' then
    v_amount:=v_reward.coin_cost;
  else
    if v_reward.native_currency is distinct from v_method or coalesce(v_reward.native_cost,0)<1 then
      raise exception 'this reward does not support % payment',upper(v_method);
    end if;
    if v_method='gp' and v_org.organization_type<>'gym' then raise exception 'GP can only pay rewards from the same Gym'; end if;
    if v_method='sp' and not public.is_brand_organization(v_org.id) then raise exception 'SP can only pay rewards from the same Brand'; end if;
    v_amount:=v_reward.native_cost;
  end if;

  v_reference:='DF-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

  if v_reward.fulfillment_mode='shared_code' then
    if nullif(btrim(coalesce(v_reward.shared_code,'')),'') is null then raise exception 'reward has no promo code configured'; end if;
    v_code:=v_reward.shared_code;
  elsif v_reward.fulfillment_mode='code_pool' then
    select c.id,c.code into v_coupon_id,v_code from public.reward_coupon_codes c
    where c.reward_id=p_reward_id and c.status='available'
    order by c.created_at,c.id for update skip locked limit 1;
    if v_coupon_id is null then raise exception 'no promo codes available for this reward'; end if;
  elsif v_reward.fulfillment_mode='redemption_url' then
    if coalesce(v_reward.redemption_url,'') !~* '^https?://' then raise exception 'reward has no valid redemption URL configured'; end if;
    v_url:=v_reward.redemption_url;
  elsif v_reward.fulfillment_mode='generated_code' then
    v_code:=v_reference;
  end if;

  if v_method='dc' then
    select * into v_wallet from public.wallets where user_id=v_actor for update;
    if not found then raise exception 'wallet not found'; end if;
    if v_wallet.balance<v_amount then raise exception 'insufficient DadoCoins'; end if;
    update public.wallets set balance=balance-v_amount,updated_at=now() where id=v_wallet.id returning balance into v_new_balance;
    insert into public.wallet_transactions(wallet_id,amount,source_type,source_id,description,idempotency_key)
    values(v_wallet.id,-v_amount,'reward_redemption',p_reward_id,'Canje: '||v_reward.title,'reward-redemption:'||v_redemption_id::text);
  elsif v_method='gp' then
    select new_balance into v_new_balance from public.spend_gym_points_internal(
      v_actor,v_org.id,v_amount,'reward_redemption',p_reward_id,'Canje: '||v_reward.title,'reward-redemption:'||v_redemption_id::text||':gp'
    );
  else
    select new_balance into v_new_balance from public.spend_sponsor_points_internal(
      v_actor,v_org.id,v_amount,'reward_redemption',p_reward_id,'Canje: '||v_reward.title,'reward-redemption:'||v_redemption_id::text||':sp'
    );
  end if;

  insert into public.reward_redemptions(
    id,reward_id,user_id,coin_cost,payment_currency,payment_amount,payment_organization_id,status,
    redemption_reference,redemption_code,redemption_url_snapshot,reward_title_snapshot,provider_name_snapshot,reward_image_snapshot,
    fulfillment_type,fulfillment_instructions,terms_snapshot,issued_at,expires_at
  ) values(
    v_redemption_id,p_reward_id,v_actor,v_reward.coin_cost,v_method,v_amount,case when v_method='dc' then null else v_org.id end,'issued',
    v_reference,v_code,v_url,v_reward.title,v_org.name,v_reward.image_url,
    v_reward.fulfillment_type,v_reward.fulfillment_instructions,v_reward.terms,now(),v_reward.ends_at
  );

  if v_coupon_id is not null then
    update public.reward_coupon_codes set status='assigned',assigned_redemption_id=v_redemption_id,assigned_user_id=v_actor,assigned_at=now()
    where id=v_coupon_id;
  end if;

  insert into public.notifications(user_id,notification_type,title,body,data)
  values(v_actor,'reward_redeemed','Premio canjeado',format('%s por %s %s',v_reward.title,v_amount,upper(v_method)),
    jsonb_build_object('reward_id',p_reward_id,'redemption_id',v_redemption_id,'reference',v_reference,'payment_currency',v_method,'payment_amount',v_amount));

  return jsonb_build_object(
    'redemption_id',v_redemption_id,'title',v_reward.title,'provider_name',v_org.name,'new_balance',v_new_balance,
    'payment_currency',v_method,'payment_amount',v_amount,'redemption_reference',v_reference,'redemption_code',v_code,
    'redemption_url',v_url,'fulfillment_type',v_reward.fulfillment_type,'fulfillment_instructions',v_reward.fulfillment_instructions
  );
end;
$$;

revoke all on function public.redeem_reward(uuid,text) from public;
grant execute on function public.redeem_reward(uuid,text) to authenticated;

-- User history reports the currency actually spent.
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
    'image_url',coalesce(rr.reward_image_snapshot,r.image_url),'coin_cost',rr.coin_cost,
    'payment_currency',rr.payment_currency,'payment_amount',rr.payment_amount,'status',rr.status,
    'redemption_reference',coalesce(rr.redemption_reference,case when rr.redemption_code like 'DF-%' then rr.redemption_code else null end),
    'redemption_code',rr.redemption_code,'redemption_url',rr.redemption_url_snapshot,'validation_token',rr.validation_token,
    'fulfillment_type',coalesce(rr.fulfillment_type,r.fulfillment_type),'fulfillment_mode',r.fulfillment_mode,
    'fulfillment_instructions',coalesce(rr.fulfillment_instructions,r.fulfillment_instructions),'fulfillment_notes',rr.fulfillment_notes,
    'fulfilled_at',rr.fulfilled_at,'terms',coalesce(rr.terms_snapshot,r.terms),'created_at',rr.created_at,'issued_at',rr.issued_at,
    'redeemed_at',rr.redeemed_at,'expires_at',rr.expires_at
  ) order by rr.created_at desc),'[]'::jsonb) into v_result
  from public.reward_redemptions rr join public.rewards r on r.id=rr.reward_id left join public.organizations o on o.id=r.organization_id
  where rr.user_id=v_actor;
  return v_result;
end;
$$;

revoke all on function public.get_my_reward_redemptions() from public;
grant execute on function public.get_my_reward_redemptions() to authenticated;

-- Provider validation views also show the actual payment method.
create or replace function public.provider_list_reward_redemptions(p_organization_id uuid,p_status text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.can_manage_rewards_for_org(p_organization_id,v_actor) then raise exception 'only Owner/Admin can inspect reward redemptions for this organization'; end if;
  if p_status not in ('all','issued','redeemed','cancelled') then raise exception 'invalid redemption status filter'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',rr.id,'reward_id',rr.reward_id,'title',coalesce(rr.reward_title_snapshot,r.title),'user_id',rr.user_id,
    'user_name',coalesce(nullif(p.display_name,''),p.username,'Gymbro'),'username',p.username,'coin_cost',rr.coin_cost,
    'payment_currency',rr.payment_currency,'payment_amount',rr.payment_amount,'status',rr.status,
    'redemption_reference',rr.redemption_reference,'validation_token',rr.validation_token,
    'fulfillment_type',coalesce(rr.fulfillment_type,r.fulfillment_type),'created_at',rr.created_at,'issued_at',rr.issued_at,
    'expires_at',rr.expires_at,'fulfilled_at',rr.fulfilled_at,'fulfillment_notes',rr.fulfillment_notes
  ) order by rr.created_at desc),'[]'::jsonb) into v_result
  from public.reward_redemptions rr join public.rewards r on r.id=rr.reward_id left join public.profiles p on p.id=rr.user_id
  where r.organization_id=p_organization_id and (p_status='all' or rr.status=p_status);
  return v_result;
end;
$$;

revoke all on function public.provider_list_reward_redemptions(uuid,text) from public;
grant execute on function public.provider_list_reward_redemptions(uuid,text) to authenticated;

create or replace function public.provider_lookup_reward_redemption(p_lookup text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_actor uuid:=auth.uid(); v_clean text:=btrim(coalesce(p_lookup,'')); v_result jsonb; v_org uuid;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if v_clean='' then raise exception 'redemption reference or token is required'; end if;
  select r.organization_id,jsonb_build_object(
    'id',rr.id,'reward_id',rr.reward_id,'title',coalesce(rr.reward_title_snapshot,r.title),'provider_name',coalesce(rr.provider_name_snapshot,o.name),
    'user_id',rr.user_id,'user_name',coalesce(nullif(p.display_name,''),p.username,'Gymbro'),'username',p.username,
    'coin_cost',rr.coin_cost,'payment_currency',rr.payment_currency,'payment_amount',rr.payment_amount,'status',rr.status,
    'redemption_reference',rr.redemption_reference,'validation_token',rr.validation_token,
    'fulfillment_type',coalesce(rr.fulfillment_type,r.fulfillment_type),'fulfillment_instructions',coalesce(rr.fulfillment_instructions,r.fulfillment_instructions),
    'created_at',rr.created_at,'issued_at',rr.issued_at,'expires_at',rr.expires_at,'fulfilled_at',rr.fulfilled_at,'fulfillment_notes',rr.fulfillment_notes
  ) into v_org,v_result
  from public.reward_redemptions rr join public.rewards r on r.id=rr.reward_id join public.organizations o on o.id=r.organization_id
  left join public.profiles p on p.id=rr.user_id
  where rr.validation_token::text=v_clean or upper(coalesce(rr.redemption_reference,''))=upper(v_clean)
  order by rr.created_at desc limit 1;
  if v_result is null then raise exception 'redemption not found'; end if;
  if not public.can_manage_rewards_for_org(v_org,v_actor) then raise exception 'this redemption belongs to another provider'; end if;
  return v_result;
end;
$$;

revoke all on function public.provider_lookup_reward_redemption(text) from public;
grant execute on function public.provider_lookup_reward_redemption(text) to authenticated;

-- Reward issue audit now stores the actual payment currency instead of assuming DC.
create or replace function public.log_reward_redemption_issue_v152()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  select r.organization_id into v_org from public.rewards r where r.id=new.reward_id;
  if v_org is not null then
    insert into public.reward_redemption_events(redemption_id,organization_id,actor_user_id,action,metadata)
    values(new.id,v_org,new.user_id,'reward_redemption.issued',jsonb_build_object(
      'reward_id',new.reward_id,'coin_cost',new.coin_cost,'payment_currency',new.payment_currency,
      'payment_amount',new.payment_amount,'reference',new.redemption_reference
    ));
  end if;
  return new;
end;
$$;

revoke all on function public.log_reward_redemption_issue_v152() from public,anon,authenticated;


-- Provider analytics split actual spend by currency, so GP/SP redemptions are never counted as DC.
create or replace function public.provider_reward_analytics(p_organization_id uuid,p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid:=auth.uid();
  v_days integer:=greatest(1,least(coalesce(p_days,30),365));
  v_from timestamptz;
  v_offers_total integer:=0;
  v_active_offers integer:=0;
  v_redemptions integer:=0;
  v_redeemed integer:=0;
  v_unique_users integer:=0;
  v_dc_consumed bigint:=0;
  v_gp_consumed bigint:=0;
  v_sp_consumed bigint:=0;
  v_low_stock integer:=0;
  v_offers jsonb:='[]'::jsonb;
  v_trend jsonb:='[]'::jsonb;
  v_recent jsonb:='[]'::jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.can_manage_rewards_for_org(p_organization_id,v_actor) then raise exception 'only Owner/Admin can view reward analytics for this organization'; end if;
  v_from:=date_trunc('day',now())-make_interval(days=>v_days-1);

  select count(*)::integer,count(*) filter(where r.status='active')::integer
  into v_offers_total,v_active_offers from public.rewards r where r.organization_id=p_organization_id;

  select count(*)::integer,
         count(*) filter(where rr.status='redeemed')::integer,
         count(distinct rr.user_id)::integer,
         coalesce(sum(rr.payment_amount) filter(where rr.payment_currency='dc'),0)::bigint,
         coalesce(sum(rr.payment_amount) filter(where rr.payment_currency='gp'),0)::bigint,
         coalesce(sum(rr.payment_amount) filter(where rr.payment_currency='sp'),0)::bigint
  into v_redemptions,v_redeemed,v_unique_users,v_dc_consumed,v_gp_consumed,v_sp_consumed
  from public.reward_redemptions rr join public.rewards r on r.id=rr.reward_id
  where r.organization_id=p_organization_id and rr.status<>'cancelled' and rr.created_at>=v_from;

  select count(*)::integer into v_low_stock
  from public.rewards r
  where r.organization_id=p_organization_id and r.status in ('active','paused') and r.inventory is not null
    and greatest(r.inventory-(select count(*)::integer from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled'),0)
      <= greatest(3,ceil(r.inventory*0.20)::integer);

  select coalesce(jsonb_agg(item order by (item->>'redemptions')::integer desc,item->>'title'),'[]'::jsonb) into v_offers
  from (
    select jsonb_build_object(
      'reward_id',r.id,'title',r.title,'status',r.status,'coin_cost',r.coin_cost,'native_currency',r.native_currency,'native_cost',r.native_cost,
      'inventory',r.inventory,'remaining_stock',public.reward_remaining_stock(r.id),
      'redemptions',count(rr.id) filter(where rr.status<>'cancelled' and rr.created_at>=v_from),
      'redeemed',count(rr.id) filter(where rr.status='redeemed' and rr.created_at>=v_from),
      'unique_users',count(distinct rr.user_id) filter(where rr.status<>'cancelled' and rr.created_at>=v_from),
      'dc_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='dc'),0),
      'gp_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='gp'),0),
      'sp_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='sp'),0),
      'low_stock',case when r.inventory is null or r.status not in ('active','paused') then false
        else greatest(r.inventory-(select count(*)::integer from public.reward_redemptions x where x.reward_id=r.id and x.status<>'cancelled'),0)
          <= greatest(3,ceil(r.inventory*0.20)::integer) end
    ) item
    from public.rewards r left join public.reward_redemptions rr on rr.reward_id=r.id
    where r.organization_id=p_organization_id
    group by r.id,r.title,r.status,r.coin_cost,r.native_currency,r.native_cost,r.inventory
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'day',d.bucket_day,'redemptions',coalesce(x.redemptions,0),'dc_consumed',coalesce(x.dc_consumed,0),
    'gp_consumed',coalesce(x.gp_consumed,0),'sp_consumed',coalesce(x.sp_consumed,0),'unique_users',coalesce(x.unique_users,0)
  ) order by d.bucket_day),'[]'::jsonb) into v_trend
  from generate_series(v_from::date,current_date,interval '1 day') as d(bucket_day)
  left join (
    select rr.created_at::date as bucket_day,
      count(*) filter(where rr.status<>'cancelled')::integer redemptions,
      coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.payment_currency='dc'),0)::bigint dc_consumed,
      coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.payment_currency='gp'),0)::bigint gp_consumed,
      coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.payment_currency='sp'),0)::bigint sp_consumed,
      count(distinct rr.user_id) filter(where rr.status<>'cancelled')::integer unique_users
    from public.reward_redemptions rr join public.rewards r on r.id=rr.reward_id
    where r.organization_id=p_organization_id and rr.created_at>=v_from
    group by rr.created_at::date
  ) x on x.bucket_day=d.bucket_day::date;

  select coalesce(jsonb_agg(item order by item->>'created_at' desc),'[]'::jsonb) into v_recent
  from (
    select jsonb_build_object(
      'redemption_id',rr.id,'reward_id',rr.reward_id,'reward_title',coalesce(rr.reward_title_snapshot,r.title),
      'user_id',rr.user_id,'user_name',coalesce(nullif(p.display_name,''),p.username,'Gymbro'),
      'coin_cost',rr.coin_cost,'payment_currency',rr.payment_currency,'payment_amount',rr.payment_amount,
      'status',rr.status,'created_at',rr.created_at,'redeemed_at',rr.redeemed_at
    ) item
    from public.reward_redemptions rr join public.rewards r on r.id=rr.reward_id join public.profiles p on p.id=rr.user_id
    where r.organization_id=p_organization_id
    order by rr.created_at desc limit 20
  ) recent;

  return jsonb_build_object(
    'period_days',v_days,'from',v_from,
    'summary',jsonb_build_object('offers_total',v_offers_total,'active_offers',v_active_offers,'redemptions',v_redemptions,
      'redeemed',v_redeemed,'pending_delivery',greatest(v_redemptions-v_redeemed,0),'unique_users',v_unique_users,
      'dc_consumed',v_dc_consumed,'gp_consumed',v_gp_consumed,'sp_consumed',v_sp_consumed,'low_stock_offers',v_low_stock),
    'offers',v_offers,'trend',v_trend,'recent_redemptions',v_recent
  );
end;
$$;

revoke all on function public.provider_reward_analytics(uuid,integer) from public;
grant execute on function public.provider_reward_analytics(uuid,integer) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
as $$ select 'v15.7.15-eco3-marketplace-multi-currency'::text; $$;
