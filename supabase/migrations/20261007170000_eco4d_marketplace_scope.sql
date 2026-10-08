-- DadoFit 2.1 - ECO-4D Marketplace Split
-- Distinguishes DadoFit Marketplace (DC) from Partner Marketplaces (own Partner Points).

alter table public.rewards add column if not exists marketplace_scope text not null default 'partner'
  check (marketplace_scope in ('dadofit','partner'));

-- Safe backfill: DC-only offers with no native currency are DadoFit universal.
update public.rewards
set marketplace_scope = case
  when organization_id is null then 'dadofit'
  when coin_cost is not null and coin_cost > 0 and (native_cost is null or native_cost = 0) and (native_currency is null) then
    -- DC-only reward from a partner org: still partner marketplace (provider is a partner)
    'partner'
  else 'partner'
end
where true;

create or replace function public.get_dadofit_marketplace()
returns setof public.rewards
language sql
stable
security definer
set search_path = public
as $$
  select * from public.rewards
  where status = 'active'
    and marketplace_scope = 'dadofit'
  order by created_at desc;
$$;

create or replace function public.get_partner_marketplace(p_organization_id uuid)
returns setof public.rewards
language sql
stable
security definer
set search_path = public
as $$
  select * from public.rewards
  where status = 'active'
    and marketplace_scope = 'partner'
    and organization_id = p_organization_id
  order by created_at desc;
$$;

revoke all on function public.get_dadofit_marketplace() from public;
revoke all on function public.get_partner_marketplace(uuid) from public;
grant execute on function public.get_dadofit_marketplace() to authenticated;
grant execute on function public.get_partner_marketplace(uuid) to authenticated;

-- Reinforce: redeem_reward must reject DC for partner-scoped rewards and vice versa.
create or replace function public.eco4d_validate_redemption(p_reward_id uuid, p_payment_method text, p_organization_id uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_reward public.rewards;
begin
  select * into v_reward from public.rewards where id = p_reward_id;
  if not found then raise exception 'reward not found'; end if;
  if v_reward.marketplace_scope = 'dadofit' and p_payment_method <> 'dc' then
    raise exception 'DadoFit Marketplace rewards are payable with DadoCoins only';
  end if;
  if v_reward.marketplace_scope = 'partner' then
    if p_payment_method = 'dc' then raise exception 'Partner rewards are payable with that organizations Partner Points only'; end if;
    if v_reward.organization_id is distinct from p_organization_id and p_organization_id is not null then
      raise exception 'Partner Points from another organization cannot pay this reward';
    end if;
  end if;
end; $$;

revoke all on function public.eco4d_validate_redemption(uuid,text,uuid) from public, anon, authenticated;

create or replace function public.get_dadofit_schema_version()
returns text language sql stable as $$ select 'v15.7.19-eco4d-marketplace-split'::text; $$;

-- Trigger enforcement on redemptions (payment_currency/payment_organization_id live on reward_redemptions).
create or replace function public.eco4d_redemption_payment_guard()
returns trigger language plpgsql as $$
begin
  perform public.eco4d_validate_redemption(NEW.reward_id, NEW.payment_currency, NEW.payment_organization_id);
  return NEW;
end; $$;

drop trigger if exists eco4d_redemption_payment_guard on public.reward_redemptions;
create trigger eco4d_redemption_payment_guard
  before insert or update of payment_currency, payment_organization_id, reward_id on public.reward_redemptions
  for each row execute function public.eco4d_redemption_payment_guard();
