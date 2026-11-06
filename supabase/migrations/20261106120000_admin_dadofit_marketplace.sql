-- DadoFit universal marketplace administration.
-- Only Platform SuperAdmins may create or mutate rewards paid with DadoCoins.

create or replace function public.admin_list_dadofit_rewards()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare v_rows jsonb;
begin
  perform public.require_platform_admin();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select r.id,r.title,r.description,r.reward_type,r.coin_cost,r.inventory,r.max_per_user,r.status,
      r.starts_at,r.ends_at,r.image_url,r.fulfillment_type,r.fulfillment_mode,r.shared_code,
      r.redemption_url,r.fulfillment_instructions,r.terms,r.created_at,r.updated_at,
      public.reward_remaining_stock(r.id) remaining_stock,
      (select count(*) from public.reward_redemptions rr where rr.reward_id=r.id and rr.status<>'cancelled') redemptions,
      (select count(*) from public.reward_coupon_codes c where c.reward_id=r.id) code_pool_total,
      (select count(*) from public.reward_coupon_codes c where c.reward_id=r.id and c.status='available') code_pool_available,
      (select count(*) from public.reward_coupon_codes c where c.reward_id=r.id and c.status='assigned') code_pool_assigned
    from public.rewards r
    where r.marketplace_scope='dadofit' and r.organization_id is null
  ) x;
  return v_rows;
end;
$$;

create or replace function public.admin_create_dadofit_reward(
  p_title text,p_description text,p_reward_type text,p_coin_cost bigint,p_inventory integer,p_max_per_user integer,
  p_image_url text,p_fulfillment_type text,p_fulfillment_instructions text,p_terms text,
  p_starts_at timestamptz,p_ends_at timestamptz,p_fulfillment_mode text default 'generated_code',
  p_shared_code text default null,p_redemption_url text default null,p_coupon_codes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_actor uuid:=auth.uid(); v_id uuid; v_codes integer;
begin
  perform public.require_platform_admin();
  if char_length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'invalid reward title'; end if;
  if p_reward_type not in ('discount','product','gym_pass','subscription','experience','other') then raise exception 'invalid reward type'; end if;
  if coalesce(p_coin_cost,0)<1 then raise exception 'DadoCoin cost must be greater than zero'; end if;
  if p_inventory is not null and p_inventory<0 then raise exception 'inventory cannot be negative'; end if;
  if coalesce(p_max_per_user,0) not between 1 and 1000 then raise exception 'invalid max per user'; end if;
  if p_fulfillment_type not in ('digital_code','digital_benefit','physical_product','in_person') then raise exception 'invalid fulfillment type'; end if;
  if p_fulfillment_mode not in ('generated_code','shared_code','code_pool','redemption_url','instructions_only') then raise exception 'invalid fulfillment mode'; end if;
  if p_fulfillment_type in ('physical_product','in_person') and p_fulfillment_mode<>'instructions_only' then raise exception 'physical and in-person rewards use instructions-only mode'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'invalid reward window'; end if;

  insert into public.rewards(organization_id,title,description,reward_type,coin_cost,inventory,status,starts_at,ends_at,
    image_url,max_per_user,fulfillment_type,fulfillment_mode,shared_code,redemption_url,fulfillment_instructions,terms,
    created_by_user_id,updated_by_user_id,native_currency,native_cost,marketplace_scope)
  values(null,left(btrim(p_title),160),nullif(btrim(coalesce(p_description,'')),''),p_reward_type,p_coin_cost,p_inventory,'draft',p_starts_at,p_ends_at,
    nullif(left(btrim(coalesce(p_image_url,'')),1000),''),p_max_per_user,p_fulfillment_type,p_fulfillment_mode,
    nullif(left(btrim(coalesce(p_shared_code,'')),180),''),nullif(left(btrim(coalesce(p_redemption_url,'')),1000),''),
    nullif(left(btrim(coalesce(p_fulfillment_instructions,'')),2000),''),nullif(left(btrim(coalesce(p_terms,'')),4000),''),
    v_actor,v_actor,null,null,'dadofit') returning id into v_id;
  v_codes:=public.add_reward_coupon_codes_internal(v_id,p_coupon_codes);
  insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,after_data)
  values(v_id,null,v_actor,'dadofit_reward.create',jsonb_build_object('codes_added',v_codes));
  return v_id;
end;
$$;

create or replace function public.admin_update_dadofit_reward(
  p_reward_id uuid,p_title text,p_description text,p_reward_type text,p_coin_cost bigint,p_inventory integer,p_max_per_user integer,
  p_image_url text,p_fulfillment_type text,p_fulfillment_instructions text,p_terms text,
  p_starts_at timestamptz,p_ends_at timestamptz,p_fulfillment_mode text default 'generated_code',
  p_shared_code text default null,p_redemption_url text default null,p_coupon_codes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_actor uuid:=auth.uid(); v_reward public.rewards%rowtype; v_claimed integer; v_codes integer;
begin
  perform public.require_platform_admin();
  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found or v_reward.marketplace_scope<>'dadofit' or v_reward.organization_id is not null then raise exception 'DadoFit reward not found'; end if;
  if v_reward.status='ended' then raise exception 'ended rewards are read-only'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'invalid reward title'; end if;
  if p_reward_type not in ('discount','product','gym_pass','subscription','experience','other') then raise exception 'invalid reward type'; end if;
  if coalesce(p_coin_cost,0)<1 then raise exception 'DadoCoin cost must be greater than zero'; end if;
  if p_inventory is not null and p_inventory<0 then raise exception 'inventory cannot be negative'; end if;
  if coalesce(p_max_per_user,0) not between 1 and 1000 then raise exception 'invalid max per user'; end if;
  if p_fulfillment_type not in ('digital_code','digital_benefit','physical_product','in_person') then raise exception 'invalid fulfillment type'; end if;
  if p_fulfillment_mode not in ('generated_code','shared_code','code_pool','redemption_url','instructions_only') then raise exception 'invalid fulfillment mode'; end if;
  if p_fulfillment_type in ('physical_product','in_person') and p_fulfillment_mode<>'instructions_only' then raise exception 'physical and in-person rewards use instructions-only mode'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'invalid reward window'; end if;
  select count(*)::integer into v_claimed from public.reward_redemptions where reward_id=p_reward_id and status<>'cancelled';
  if p_inventory is not null and p_inventory<v_claimed then raise exception 'inventory cannot be lower than existing redemptions (%)',v_claimed; end if;

  update public.rewards set title=left(btrim(p_title),160),description=nullif(btrim(coalesce(p_description,'')),''),reward_type=p_reward_type,
    coin_cost=p_coin_cost,inventory=p_inventory,max_per_user=p_max_per_user,image_url=nullif(left(btrim(coalesce(p_image_url,'')),1000),''),
    fulfillment_type=p_fulfillment_type,fulfillment_mode=p_fulfillment_mode,shared_code=nullif(left(btrim(coalesce(p_shared_code,'')),180),''),
    redemption_url=nullif(left(btrim(coalesce(p_redemption_url,'')),1000),''),fulfillment_instructions=nullif(left(btrim(coalesce(p_fulfillment_instructions,'')),2000),''),
    terms=nullif(left(btrim(coalesce(p_terms,'')),4000),''),starts_at=p_starts_at,ends_at=p_ends_at,updated_by_user_id=v_actor,updated_at=now()
  where id=p_reward_id;
  v_codes:=public.add_reward_coupon_codes_internal(p_reward_id,p_coupon_codes);
  if v_reward.status='active' then
    if p_fulfillment_mode='shared_code' and nullif(btrim(coalesce(p_shared_code,'')),'') is null then raise exception 'shared promo code is required'; end if;
    if p_fulfillment_mode='redemption_url' and coalesce(p_redemption_url,'') !~* '^https?://' then raise exception 'valid redemption URL is required'; end if;
    if p_fulfillment_mode='code_pool' and coalesce(public.reward_remaining_stock(p_reward_id),0)<=0 then raise exception 'active reward requires an available code'; end if;
  end if;
  insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,after_data)
  values(p_reward_id,null,v_actor,'dadofit_reward.update',jsonb_build_object('codes_added',v_codes));
  return p_reward_id;
end;
$$;

create or replace function public.admin_set_dadofit_reward_status(p_reward_id uuid,p_status text)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_actor uuid:=auth.uid(); v_reward public.rewards%rowtype;
begin
  perform public.require_platform_admin();
  if p_status not in ('draft','active','paused','ended') then raise exception 'invalid reward status'; end if;
  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found or v_reward.marketplace_scope<>'dadofit' or v_reward.organization_id is not null then raise exception 'DadoFit reward not found'; end if;
  if v_reward.status='ended' then raise exception 'ended rewards are read-only'; end if;
  if p_status='active' then
    if v_reward.ends_at is not null and v_reward.ends_at<=now() then raise exception 'reward has expired'; end if;
    if v_reward.fulfillment_mode='shared_code' and v_reward.shared_code is null then raise exception 'shared promo code is required'; end if;
    if v_reward.fulfillment_mode='redemption_url' and coalesce(v_reward.redemption_url,'') !~* '^https?://' then raise exception 'valid redemption URL is required'; end if;
    if v_reward.fulfillment_mode='code_pool' and coalesce(public.reward_remaining_stock(p_reward_id),0)<=0 then raise exception 'reward requires an available code'; end if;
  end if;
  update public.rewards set status=p_status,updated_by_user_id=v_actor,updated_at=now() where id=p_reward_id;
  insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,after_data)
  values(p_reward_id,null,v_actor,'dadofit_reward.status',jsonb_build_object('status',p_status));
  return p_status;
end;
$$;

revoke all on function public.admin_list_dadofit_rewards() from public,anon;
revoke all on function public.admin_create_dadofit_reward(text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text) from public,anon;
revoke all on function public.admin_update_dadofit_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text) from public,anon;
revoke all on function public.admin_set_dadofit_reward_status(uuid,text) from public,anon;
grant execute on function public.admin_list_dadofit_rewards() to authenticated;
grant execute on function public.admin_create_dadofit_reward(text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text) to authenticated;
grant execute on function public.admin_update_dadofit_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text) to authenticated;
grant execute on function public.admin_set_dadofit_reward_status(uuid,text) to authenticated;
