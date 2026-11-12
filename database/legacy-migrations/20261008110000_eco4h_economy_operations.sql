-- DadoFit 2.1 - ECO-4H Economy Operations
-- Activates Partner Points config for the frontend, enforces marketplace scope inside
-- redeem_reward, and adds Partner read-only budget + Partner Points analytics RPCs.

-- ---------------------------------------------------------------------------
-- 1) Partner Point Config: auto-seed for NEW organizations (idempotent) + re-backfill
-- ---------------------------------------------------------------------------

create or replace function public.eco4h_seed_partner_point_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.partner_point_configs (organization_id, points_name, points_short_name, points_icon, points_color, enabled, competitive_score_name)
  values (
    NEW.id,
    case
      when NEW.organization_type = 'gym' then 'Gym Points'
      when NEW.organization_type in ('brand','sponsor') then 'Sponsor Points'
      else 'Partner Points'
    end,
    case
      when NEW.organization_type = 'gym' then 'GP'
      when NEW.organization_type in ('brand','sponsor') then 'SP'
      else 'PP'
    end,
    null, null, true, null
  )
  on conflict (organization_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists eco4h_seed_partner_point_config on public.organizations;
create trigger eco4h_seed_partner_point_config
after insert on public.organizations
for each row execute function public.eco4h_seed_partner_point_config();

-- Re-backfill any organization created between ECO-4A and now (idempotent).
insert into public.partner_point_configs (organization_id, points_name, points_short_name, points_icon, points_color, enabled, competitive_score_name)
select
  o.id,
  case
    when o.organization_type = 'gym' then 'Gym Points'
    when o.organization_type in ('brand','sponsor') then 'Sponsor Points'
    else 'Partner Points'
  end,
  case
    when o.organization_type = 'gym' then 'GP'
    when o.organization_type in ('brand','sponsor') then 'SP'
    else 'PP'
  end,
  null, null, true, null
from public.organizations o
on conflict (organization_id) do nothing;

-- Batch read RPC so the frontend can resolve display names for many orgs at once.
create or replace function public.get_partner_point_configs(p_organization_ids uuid[])
returns table (
  organization_id uuid,
  points_name text,
  points_short_name text,
  points_icon text,
  points_color text,
  enabled boolean,
  competitive_score_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_organization_ids is null or array_length(p_organization_ids,1) is null then return; end if;
  return query
  select c.organization_id, c.points_name, c.points_short_name, c.points_icon, c.points_color, c.enabled, c.competitive_score_name
  from public.partner_point_configs c
  where c.organization_id = any(p_organization_ids);
end;
$$;

revoke all on function public.get_partner_point_configs(uuid[]) from public;
grant execute on function public.get_partner_point_configs(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) redeem_reward: enforce marketplace_scope BEFORE any deduction
-- ---------------------------------------------------------------------------

drop function if exists public.redeem_reward(uuid, text);

create or replace function public.redeem_reward(p_reward_id uuid, p_payment_method text default 'dc')
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
  v_is_dadofit boolean;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if v_method not in ('dc','gp','sp') then raise exception 'invalid payment method'; end if;

  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found then raise exception 'reward not found'; end if;
  select * into v_org from public.organizations where id=v_reward.organization_id;

  v_is_dadofit := (v_reward.marketplace_scope = 'dadofit') or v_reward.organization_id is null;

  -- Scope enforcement (DadoFit+DC only; Partner+own points only; cross-org blocked).
  perform public.eco4d_validate_redemption(
    p_reward_id,
    v_method,
    case when v_method='dc' then null else v_reward.organization_id end
  );

  if v_reward.status<>'active' then raise exception 'reward is not active'; end if;
  if not v_is_dadofit then
    if v_org.verification_status<>'verified' then raise exception 'reward provider is not verified'; end if;
  end if;
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
    v_reference,v_code,v_url,v_reward.title,coalesce(v_org.name,'DadoFit'),v_reward.image_url,
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
    'redemption_id',v_redemption_id,'title',v_reward.title,'provider_name',coalesce(v_org.name,'DadoFit'),'new_balance',v_new_balance,
    'payment_currency',v_method,'payment_amount',v_amount,'redemption_reference',v_reference,'redemption_code',v_code,
    'redemption_url',v_url,'fulfillment_type',v_reward.fulfillment_type,'fulfillment_instructions',v_reward.fulfillment_instructions
  );
end;
$$;

revoke all on function public.redeem_reward(uuid,text) from public;
grant execute on function public.redeem_reward(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Partner read-only DC budget visibility (RBAC validated in backend)
-- ---------------------------------------------------------------------------

create or replace function public.get_my_dc_budgets()
returns table (
  id uuid, organization_id uuid, organization_name text, sponsor_campaign_id uuid, season_id uuid,
  is_dadofit_internal boolean, budget_dc bigint, used_dc bigint, remaining_dc bigint,
  utilization_pct numeric, status text, starts_at timestamptz, ends_at timestamptz,
  approved_at timestamptz, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  return query
  select b.id, b.organization_id, o.name, b.sponsor_campaign_id, b.season_id,
         b.is_dadofit_internal, b.budget_dc, b.used_dc, b.remaining_dc,
         round(case when b.budget_dc>0 then (b.used_dc::numeric/b.budget_dc)*100 else 0 end,2),
         b.status, b.starts_at, b.ends_at, b.approved_at, b.created_at
  from public.dc_budgets b
  join public.organizations o on o.id=b.organization_id
  join public.organization_members om
    on om.organization_id=b.organization_id
   and om.user_id=v_actor
   and om.status='active'
   and om.role in ('owner','admin')
  where b.organization_id is not null
  order by b.created_at desc;
end;
$$;

revoke all on function public.get_my_dc_budgets() from public;
grant execute on function public.get_my_dc_budgets() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Partner Points analytics per organization (RBAC validated in backend)
-- ---------------------------------------------------------------------------

create or replace function public.get_partner_point_analytics(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_is_gym boolean;
  v_emitted bigint := 0;
  v_spent bigint := 0;
  v_circulation bigint := 0;
  v_active_users integer := 0;
  v_redemptions integer := 0;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_organization_id is null then raise exception 'organization_id required'; end if;

  -- RBAC: only Owner/Admin of that org or platform admin. Partner is read-only.
  if not public.is_platform_admin(v_actor) and not exists (
    select 1 from public.organization_members om
    where om.organization_id=p_organization_id and om.user_id=v_actor and om.status='active' and om.role in ('owner','admin')
  ) then
    raise exception 'only Owner/Admin of this organization or platform admin can read Partner Points analytics';
  end if;

  select (o.organization_type='gym') into v_is_gym from public.organizations o where o.id=p_organization_id;

  if v_is_gym then
    select
      coalesce(sum(w.lifetime_earned),0), coalesce(sum(w.lifetime_spent),0), coalesce(sum(w.balance),0),
      count(*) filter (where w.balance>0 or w.lifetime_earned>0)::integer
    into v_emitted, v_spent, v_circulation, v_active_users
    from public.gym_point_wallets w where w.gym_organization_id=p_organization_id;
  else
    select
      coalesce(sum(w.lifetime_earned),0), coalesce(sum(w.lifetime_spent),0), coalesce(sum(w.balance),0),
      count(*) filter (where w.balance>0 or w.lifetime_earned>0)::integer
    into v_emitted, v_spent, v_circulation, v_active_users
    from public.sponsor_point_wallets w where w.sponsor_organization_id=p_organization_id;
  end if;

  select count(*)::integer into v_redemptions
  from public.reward_redemptions rr
  where rr.payment_organization_id=p_organization_id
    and rr.payment_currency in ('gp','sp')
    and rr.status<>'cancelled';

  v_result := jsonb_build_object(
    'organization_id', p_organization_id,
    'points_kind', case when v_is_gym then 'gym' else 'sponsor' end,
    'emitted', v_emitted,
    'spent', v_spent,
    'circulation', v_circulation,
    'active_users', v_active_users,
    'redemptions', v_redemptions
  );
  return v_result;
end;
$$;

revoke all on function public.get_partner_point_analytics(uuid) from public;
grant execute on function public.get_partner_point_analytics(uuid) to authenticated;

-- Version marker.
create or replace function public.get_dadofit_schema_version()
returns text language sql stable as $$ select 'v15.7.21-eco4h-economy-operations'::text; $$;
