-- DadoFit V15.2.2 - Gym reward publication notifications
-- When a verified Gym makes a reward active, active members who have not already
-- been notified about that reward receive a marketplace notification.

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

  select * into v_reward
  from public.rewards
  where id=p_reward_id
  for update;

  if not found then raise exception 'reward not found'; end if;
  if not public.can_manage_rewards_for_org(v_reward.organization_id,v_actor) then
    raise exception 'only Owner/Admin can manage this reward';
  end if;

  select * into v_org
  from public.organizations
  where id=v_reward.organization_id;

  if p_status='active' then
    if v_org.verification_status<>'verified' then raise exception 'organization must be verified before publishing rewards'; end if;
    if v_reward.coin_cost<1 then raise exception 'invalid coin cost'; end if;
    if v_reward.ends_at is not null and v_reward.ends_at<=now() then raise exception 'reward has already expired'; end if;
    if v_reward.fulfillment_mode='shared_code' and nullif(btrim(coalesce(v_reward.shared_code,'')),'') is null then raise exception 'shared promo code is required before publishing'; end if;
    if v_reward.fulfillment_mode='redemption_url' and coalesce(v_reward.redemption_url,'') !~* '^https?://' then raise exception 'valid redemption URL is required before publishing'; end if;

    if v_reward.fulfillment_mode='code_pool' then
      select public.reward_remaining_stock(p_reward_id) into v_remaining;
      if coalesce(v_remaining,0)<=0 then raise exception 'add at least one available promo code before publishing'; end if;
    else
      select public.reward_remaining_stock(p_reward_id) into v_remaining;
      if v_remaining is not null and v_remaining<=0 then raise exception 'reward is sold out'; end if;
    end if;
  end if;

  v_before:=to_jsonb(v_reward);

  update public.rewards
  set status=p_status,updated_by_user_id=v_actor,updated_at=now()
  where id=p_reward_id;

  select to_jsonb(r) into v_after
  from public.rewards r
  where r.id=p_reward_id;

  insert into public.reward_offer_events(
    reward_id,organization_id,actor_user_id,action,before_data,after_data
  ) values(
    p_reward_id,v_reward.organization_id,v_actor,'reward_offer.status.change',v_before,v_after
  );

  -- Gym marketplace announcement. Idempotent per member/reward: a member receives
  -- this publication notification at most once, even if the reward is paused/reactivated.
  if p_status='active'
     and v_reward.status <> 'active'
     and v_org.organization_type='gym' then
    insert into public.notifications(user_id,notification_type,title,body,data)
    select
      om.user_id,
      'gym_reward_published',
      'Nuevo premio en ' || v_org.name,
      format('%s · %s DC', v_reward.title, v_reward.coin_cost),
      jsonb_build_object(
        'organization_id', v_org.id,
        'reward_id', p_reward_id,
        'route', '/rewards',
        'coin_cost', v_reward.coin_cost
      )
    from public.organization_members om
    where om.organization_id = v_org.id
      and om.status = 'active'
      and om.user_id <> v_actor
      and not exists (
        select 1
        from public.notifications n
        where n.user_id = om.user_id
          and n.notification_type = 'gym_reward_published'
          and n.data ->> 'reward_id' = p_reward_id::text
      );
  end if;

  return p_status;
end;
$$;

revoke all on function public.provider_set_reward_status(uuid,text) from public;
grant execute on function public.provider_set_reward_status(uuid,text) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$ select 'v15.2.2-gym-reward-publish-notifications'::text; $$;
