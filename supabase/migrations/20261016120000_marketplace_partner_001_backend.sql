-- MARKETPLACE-PARTNER-001 (T01-T10): backend contracts, integrity and security.
-- Additive migration: existing wallets, ledgers, redemptions and fulfillment are preserved.

-- -----------------------------------------------------------------------------
-- T01: persistent, reproducible pre-hardening audit evidence
-- -----------------------------------------------------------------------------

alter table public.partner_point_configs
  add column if not exists governance_source text,
  add column if not exists explicitly_managed_at timestamptz;

alter table public.partner_point_configs drop constraint if exists partner_point_configs_governance_source_check;
alter table public.partner_point_configs add constraint partner_point_configs_governance_source_check
  check (governance_source is null or governance_source in ('AUTO_SEEDED','EXPLICIT','LEGACY_UNKNOWN'));

-- ECO-4A/ECO-4H rows are safely identifiable only when they were never attributed to an actor
-- and still exactly match the generated defaults. Anything ambiguous remains enabled as legacy
-- unknown instead of being disabled arbitrarily.
update public.partner_point_configs c
set governance_source=case
      when c.updated_by is not null then 'EXPLICIT'
      when c.points_icon is null and c.points_color is null and c.competitive_score_name is null
       and exists(select 1 from public.organizations o where o.id=c.organization_id and (
         (o.organization_type='gym' and c.points_name='Gym Points' and c.points_short_name='GP') or
         (o.organization_type in ('brand','sponsor') and c.points_name='Sponsor Points' and c.points_short_name='SP') or
         (o.organization_type not in ('gym','brand','sponsor') and c.points_name='Partner Points' and c.points_short_name='PP')
       )) then 'AUTO_SEEDED'
      else 'LEGACY_UNKNOWN' end,
    explicitly_managed_at=case when c.updated_by is not null then coalesce(c.updated_at,now()) else c.explicitly_managed_at end
where c.governance_source is null;

update public.partner_point_configs
set enabled=false,updated_at=now()
where governance_source='AUTO_SEEDED' and enabled=true;

create or replace function public.eco4h_seed_partner_point_config()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new.organization_type in ('gym','brand','company') then
    insert into public.partner_point_configs(
      organization_id,points_name,points_short_name,points_icon,points_color,enabled,competitive_score_name,governance_source
    ) values(
      new.id,
      case when new.organization_type='gym' then 'Gym Points' else 'Partner Points' end,
      case when new.organization_type='gym' then 'GP' else 'PP' end,
      null,null,false,null,'AUTO_SEEDED'
    ) on conflict(organization_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.eco4h_seed_partner_point_config() from public,anon,authenticated;
drop trigger if exists eco4h_seed_partner_point_config on public.organizations;
create trigger eco4h_seed_partner_point_config after insert on public.organizations
for each row execute function public.eco4h_seed_partner_point_config();

create table if not exists public.marketplace_partner_integrity_audit (
  id bigint generated always as identity primary key,
  migration_version text not null,
  check_name text not null,
  issue_count bigint not null,
  sampled_ids uuid[] not null default '{}'::uuid[],
  recorded_at timestamptz not null default now(),
  unique (migration_version, check_name)
);

revoke all on table public.marketplace_partner_integrity_audit from public, anon, authenticated;

insert into public.marketplace_partner_integrity_audit(migration_version, check_name, issue_count, sampled_ids)
select 'MARKETPLACE-PARTNER-001', check_name, count(*), coalesce((array_agg(id order by id))[1:20], '{}'::uuid[])
from (
  select r.id, 'reward_scope_organization'::text check_name
  from public.rewards r
  where (r.marketplace_scope='dadofit' and r.organization_id is not null)
     or (r.marketplace_scope='partner' and r.organization_id is null)
  union all
  select r.id, 'reward_scope_price'
  from public.rewards r
  where (r.marketplace_scope='dadofit' and (r.native_currency is not null or r.native_cost is not null or coalesce(r.coin_cost,0)<=0))
     or (r.marketplace_scope='partner' and (r.native_currency is null or coalesce(r.native_cost,0)<=0))
  union all
  select r.id, 'reward_partner_type_currency'
  from public.rewards r left join public.organizations o on o.id=r.organization_id
  where r.marketplace_scope='partner' and (
    o.organization_type not in ('gym','brand','company')
    or (o.organization_type='gym' and r.native_currency is distinct from 'gp')
    or (o.organization_type in ('brand','company') and r.native_currency is distinct from 'sp'))
  union all
  select rr.id, 'redemption_payment_shape'
  from public.reward_redemptions rr
  where (rr.payment_currency='dc' and rr.payment_organization_id is not null)
     or (rr.payment_currency in ('gp','sp') and rr.payment_organization_id is null)
     or rr.payment_amount<=0
  union all
  select rr.id, 'redemption_reward_mismatch'
  from public.reward_redemptions rr join public.rewards r on r.id=rr.reward_id
  where (r.marketplace_scope='dadofit' and (rr.payment_currency<>'dc' or rr.payment_organization_id is not null))
     or (r.marketplace_scope='partner' and (rr.payment_currency is distinct from r.native_currency or rr.payment_organization_id is distinct from r.organization_id))
  union all
  select w.user_id, 'gym_wallet_wrong_org_type' from public.gym_point_wallets w
  join public.organizations o on o.id=w.gym_organization_id where o.organization_type<>'gym'
  union all
  select w.user_id, 'sponsor_wallet_wrong_org_type' from public.sponsor_point_wallets w
  join public.organizations o on o.id=w.sponsor_organization_id where o.organization_type not in ('brand','company')
  union all
  select e.id, 'offer_event_nested_secret' from public.reward_offer_events e
  where jsonb_path_exists(coalesce(e.before_data,'{}'::jsonb),'$.**.shared_code')
     or jsonb_path_exists(coalesce(e.before_data,'{}'::jsonb),'$.**.redemption_url')
     or jsonb_path_exists(coalesce(e.before_data,'{}'::jsonb),'$.**.fulfillment_instructions')
     or jsonb_path_exists(coalesce(e.after_data,'{}'::jsonb),'$.**.shared_code')
     or jsonb_path_exists(coalesce(e.after_data,'{}'::jsonb),'$.**.redemption_url')
     or jsonb_path_exists(coalesce(e.after_data,'{}'::jsonb),'$.**.fulfillment_instructions')
  union all
  select e.id, 'redemption_event_nested_secret' from public.reward_redemption_events e
  where jsonb_path_exists(e.metadata,'$.**.shared_code') or jsonb_path_exists(e.metadata,'$.**.code')
     or jsonb_path_exists(e.metadata,'$.**.redemption_url') or jsonb_path_exists(e.metadata,'$.**.fulfillment_instructions')
     or jsonb_path_exists(e.metadata,'$.**.validation_token')
) findings
group by check_name
on conflict (migration_version, check_name) do update
set issue_count=excluded.issue_count, sampled_ids=excluded.sampled_ids, recorded_at=now();

-- Record zeroes as well, so absence of findings is explicit evidence.
insert into public.marketplace_partner_integrity_audit(migration_version,check_name,issue_count)
select 'MARKETPLACE-PARTNER-001', x, 0
from unnest(array['reward_scope_organization','reward_scope_price','reward_partner_type_currency','redemption_payment_shape',
  'redemption_reward_mismatch','gym_wallet_wrong_org_type','sponsor_wallet_wrong_org_type',
  'offer_event_nested_secret','redemption_event_nested_secret']) x
on conflict (migration_version,check_name) do nothing;

-- -----------------------------------------------------------------------------
-- T02/T04: snapshots and persistence invariants
-- -----------------------------------------------------------------------------

alter table public.reward_redemptions
  add column if not exists organization_id_snapshot uuid,
  add column if not exists organization_name_snapshot text,
  add column if not exists marketplace_scope_snapshot text,
  add column if not exists points_name_snapshot text,
  add column if not exists points_short_name_snapshot text,
  add column if not exists fulfillment_mode_snapshot text;

update public.reward_redemptions rr
set organization_id_snapshot=coalesce(rr.organization_id_snapshot,r.organization_id,rr.payment_organization_id),
    organization_name_snapshot=coalesce(rr.organization_name_snapshot,rr.provider_name_snapshot,o.name,case when r.marketplace_scope='dadofit' then 'DadoFit' end),
    marketplace_scope_snapshot=coalesce(rr.marketplace_scope_snapshot,r.marketplace_scope),
    points_name_snapshot=coalesce(rr.points_name_snapshot,case when rr.payment_currency='dc' then 'DadoCoins' else c.points_name end,
      case rr.payment_currency when 'gp' then 'Gym Points' when 'sp' then 'Partner Points' else 'DadoCoins' end),
    points_short_name_snapshot=coalesce(rr.points_short_name_snapshot,case when rr.payment_currency='dc' then 'DC' else c.points_short_name end,
      upper(rr.payment_currency)),
    fulfillment_mode_snapshot=coalesce(rr.fulfillment_mode_snapshot,r.fulfillment_mode)
from public.rewards r
left join public.organizations o on o.id=r.organization_id
left join public.partner_point_configs c on c.organization_id=r.organization_id
where r.id=rr.reward_id;

alter table public.rewards drop constraint if exists rewards_marketplace_scope_org_mp001;
alter table public.rewards add constraint rewards_marketplace_scope_org_mp001 check (
  (marketplace_scope='dadofit' and organization_id is null and native_currency is null and native_cost is null and coin_cost>0)
  or
  (marketplace_scope='partner' and organization_id is not null and native_currency in ('gp','sp') and native_cost>0)
) not valid;

alter table public.reward_redemptions drop constraint if exists reward_redemptions_payment_shape_mp001;
alter table public.reward_redemptions add constraint reward_redemptions_payment_shape_mp001 check (
  payment_amount>0 and (
    (payment_currency='dc' and payment_organization_id is null)
    or (payment_currency in ('gp','sp') and payment_organization_id is not null)
  )
) not valid;

create or replace function public.marketplace_partner_reward_guard_mp001()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_type text; v_enabled boolean;
begin
  if new.marketplace_scope='dadofit' then
    if new.organization_id is not null or new.native_currency is not null or new.native_cost is not null or coalesce(new.coin_cost,0)<=0 then
      raise exception 'invalid DadoFit reward contract';
    end if;
  elsif new.marketplace_scope='partner' then
    if new.organization_id is null or coalesce(new.native_cost,0)<=0 then raise exception 'invalid Partner reward contract'; end if;
    select o.organization_type,coalesce(c.enabled,false) into v_type,v_enabled
    from public.organizations o left join public.partner_point_configs c on c.organization_id=o.id
    where o.id=new.organization_id;
    if v_type not in ('gym','brand','company') then raise exception 'unsupported Partner organization type'; end if;
    if (v_type='gym' and new.native_currency<>'gp') or (v_type in ('brand','company') and new.native_currency<>'sp') then
      raise exception 'Partner reward currency does not match organization type';
    end if;
    if new.status='active' and not v_enabled then raise exception 'Partner economy is disabled'; end if;
  else
    raise exception 'invalid marketplace scope';
  end if;
  return new;
end $$;

revoke all on function public.marketplace_partner_reward_guard_mp001() from public,anon,authenticated;
drop trigger if exists marketplace_partner_reward_guard_mp001 on public.rewards;
create trigger marketplace_partner_reward_guard_mp001
before insert or update of marketplace_scope,organization_id,native_currency,native_cost,status
on public.rewards for each row execute function public.marketplace_partner_reward_guard_mp001();

create or replace function public.marketplace_partner_redemption_guard_mp001()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_reward record; v_type text; v_org_name text; v_points_name text; v_points_short text;
begin
  select r.marketplace_scope,r.organization_id,r.native_currency,r.fulfillment_mode into v_reward
  from public.rewards r where r.id=new.reward_id;
  if not found then raise exception 'reward not found'; end if;
  if coalesce(new.payment_amount,0)<=0 then raise exception 'payment amount must be positive'; end if;
  if v_reward.marketplace_scope='dadofit' then
    if new.payment_currency<>'dc' or new.payment_organization_id is not null then raise exception 'invalid DadoFit payment'; end if;
  else
    if new.payment_currency is distinct from v_reward.native_currency
       or new.payment_organization_id is distinct from v_reward.organization_id then
      raise exception 'invalid cross-organization Partner payment';
    end if;
    select o.organization_type into v_type from public.organizations o where o.id=v_reward.organization_id;
    if (new.payment_currency='gp' and v_type<>'gym')
       or (new.payment_currency='sp' and v_type not in ('brand','company')) then
      raise exception 'invalid physical Partner wallet';
    end if;
  end if;
  select o.name,c.points_name,c.points_short_name into v_org_name,v_points_name,v_points_short
  from public.organizations o left join public.partner_point_configs c on c.organization_id=o.id
  where o.id=v_reward.organization_id;
  if tg_op='INSERT' then
    new.organization_id_snapshot:=v_reward.organization_id;
    new.organization_name_snapshot:=coalesce(v_org_name,case when v_reward.marketplace_scope='dadofit' then 'DadoFit' end);
    new.marketplace_scope_snapshot:=v_reward.marketplace_scope;
    new.points_name_snapshot:=coalesce(case when new.payment_currency='dc' then 'DadoCoins' else v_points_name end,
      case new.payment_currency when 'gp' then 'Gym Points' when 'sp' then 'Partner Points' else 'DadoCoins' end);
    new.points_short_name_snapshot:=coalesce(case when new.payment_currency='dc' then 'DC' else v_points_short end,upper(new.payment_currency));
    new.fulfillment_mode_snapshot:=v_reward.fulfillment_mode;
  elsif new.organization_id_snapshot is distinct from old.organization_id_snapshot
     or new.organization_name_snapshot is distinct from old.organization_name_snapshot
     or new.marketplace_scope_snapshot is distinct from old.marketplace_scope_snapshot
     or new.points_name_snapshot is distinct from old.points_name_snapshot
     or new.points_short_name_snapshot is distinct from old.points_short_name_snapshot
     or new.fulfillment_mode_snapshot is distinct from old.fulfillment_mode_snapshot then
    raise exception 'redemption snapshots are immutable';
  end if;
  return new;
end $$;

revoke all on function public.marketplace_partner_redemption_guard_mp001() from public,anon,authenticated;
drop trigger if exists eco4d_redemption_payment_guard on public.reward_redemptions;
drop trigger if exists marketplace_partner_redemption_guard_mp001 on public.reward_redemptions;
create trigger marketplace_partner_redemption_guard_mp001
before insert or update
on public.reward_redemptions for each row execute function public.marketplace_partner_redemption_guard_mp001();

-- -----------------------------------------------------------------------------
-- T03: close direct/legacy exposure and remove secrets copied into audit JSON
-- -----------------------------------------------------------------------------

create or replace function public.redact_reward_secrets_mp001(p_value jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_result jsonb;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value)='object' then
    select coalesce(jsonb_object_agg(e.key,case
      when lower(e.key) in ('shared_code','code','coupon_code','redemption_url','fulfillment_instructions','validation_token')
        then '"[REDACTED]"'::jsonb
      else public.redact_reward_secrets_mp001(e.value) end),'{}'::jsonb)
    into v_result from jsonb_each(p_value) e;
    return v_result;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(public.redact_reward_secrets_mp001(e.value) order by e.ordinality),'[]'::jsonb)
    into v_result from jsonb_array_elements(p_value) with ordinality e(value,ordinality);
    return v_result;
  end if;
  return p_value;
end $$;
revoke all on function public.redact_reward_secrets_mp001(jsonb) from public,anon,authenticated;

update public.reward_offer_events
set before_data=public.redact_reward_secrets_mp001(before_data),
    after_data=public.redact_reward_secrets_mp001(after_data)
where before_data is not null or after_data is not null;

update public.reward_redemption_events
set metadata=public.redact_reward_secrets_mp001(metadata)
where metadata is not null;

create or replace function public.redact_reward_event_secrets_mp001()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_table_name='reward_offer_events' then
    new.before_data:=public.redact_reward_secrets_mp001(new.before_data);
    new.after_data:=public.redact_reward_secrets_mp001(new.after_data);
  else
    new.metadata:=public.redact_reward_secrets_mp001(new.metadata);
  end if;
  return new;
end $$;
revoke all on function public.redact_reward_event_secrets_mp001() from public,anon,authenticated;
drop trigger if exists redact_reward_offer_event_secrets_mp001 on public.reward_offer_events;
create trigger redact_reward_offer_event_secrets_mp001 before insert or update of before_data,after_data
on public.reward_offer_events for each row execute function public.redact_reward_event_secrets_mp001();
drop trigger if exists redact_reward_redemption_event_secrets_mp001 on public.reward_redemption_events;
create trigger redact_reward_redemption_event_secrets_mp001 before insert or update of metadata
on public.reward_redemption_events for each row execute function public.redact_reward_event_secrets_mp001();

revoke all on table public.rewards,public.reward_redemptions,public.reward_coupon_codes,
  public.reward_offer_events,public.reward_redemption_events from anon,authenticated;
revoke execute on function public.get_reward_marketplace() from public,anon,authenticated;
revoke execute on function public.get_my_reward_redemptions() from public,anon,authenticated;
revoke execute on function public.get_partner_point_configs(uuid[]) from public,anon,authenticated;
revoke execute on function public.get_partner_point_config(uuid) from public,anon,authenticated;
revoke execute on function public.upsert_partner_point_config(uuid,text,text,text,text,boolean,text) from public,anon,authenticated;

drop function if exists public.get_dadofit_marketplace();
drop function if exists public.get_partner_marketplace(uuid);

-- -----------------------------------------------------------------------------
-- T05: config governance and safe defaults
-- -----------------------------------------------------------------------------

drop function if exists public.get_partner_point_config(uuid);
create or replace function public.get_partner_point_config(p_organization_id uuid)
returns table(organization_id uuid,points_name text,points_short_name text,points_icon text,points_color text,enabled boolean)
language sql stable security definer set search_path=pg_catalog
as $$
  select o.id,coalesce(c.points_name,'Partner Points'),coalesce(c.points_short_name,'PP'),
         case when c.points_icon ~ '^[a-z0-9][a-z0-9_-]{0,63}$' then c.points_icon end,
         coalesce(c.points_color,'#64748B'),coalesce(c.enabled,false)
  from public.organizations o left join public.partner_point_configs c on c.organization_id=o.id
  where o.id=p_organization_id and o.organization_type in ('gym','brand','company')
$$;
revoke all on function public.get_partner_point_config(uuid) from public,anon;
grant execute on function public.get_partner_point_config(uuid) to authenticated;

create or replace function public.update_partner_point_presentation(
  p_organization_id uuid,p_points_name text,p_points_short_name text,p_points_icon text default null,p_points_color text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid(); v_enabled boolean; v_row public.partner_point_configs;
begin
  if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.organization_type in ('gym','brand','company')) then
    raise exception 'unsupported Partner organization';
  end if;
  if v_actor is null or not public.can_manage_rewards_for_org(p_organization_id,v_actor) then raise exception 'not authorized'; end if;
  if char_length(btrim(coalesce(p_points_name,''))) not between 2 and 60 then raise exception 'invalid points name'; end if;
  if char_length(upper(btrim(coalesce(p_points_short_name,'')))) not between 1 and 8
     or upper(btrim(p_points_short_name)) in ('DC','TP','XP') then raise exception 'invalid points short name'; end if;
  if p_points_icon is not null and p_points_icon !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then raise exception 'invalid points icon'; end if;
  if p_points_color is not null and p_points_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid points color'; end if;
  select coalesce(c.enabled,false) into v_enabled from public.partner_point_configs c where c.organization_id=p_organization_id;
  insert into public.partner_point_configs(organization_id,points_name,points_short_name,points_icon,points_color,enabled,updated_by,governance_source,explicitly_managed_at)
  values(p_organization_id,btrim(p_points_name),upper(btrim(p_points_short_name)),p_points_icon,upper(p_points_color),coalesce(v_enabled,false),v_actor,'EXPLICIT',now())
  on conflict(organization_id) do update set points_name=excluded.points_name,points_short_name=excluded.points_short_name,
    points_icon=excluded.points_icon,points_color=excluded.points_color,updated_by=excluded.updated_by,updated_at=now(),
    governance_source='EXPLICIT',explicitly_managed_at=now()
  returning * into v_row;
  return jsonb_build_object('organization_id',v_row.organization_id,'points_name',v_row.points_name,
    'points_short_name',v_row.points_short_name,'points_icon',v_row.points_icon,'points_color',v_row.points_color,'enabled',v_row.enabled);
end $$;
revoke all on function public.update_partner_point_presentation(uuid,text,text,text,text) from public,anon;
grant execute on function public.update_partner_point_presentation(uuid,text,text,text,text) to authenticated;

create or replace function public.admin_update_partner_point_config(
  p_organization_id uuid,p_points_name text,p_points_short_name text,p_points_icon text default null,
  p_points_color text default null,p_enabled boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid(); v_row public.partner_point_configs;
begin
  perform public.require_platform_admin();
  if char_length(btrim(coalesce(p_points_name,''))) not between 2 and 60 then raise exception 'invalid points name'; end if;
  if char_length(upper(btrim(coalesce(p_points_short_name,'')))) not between 1 and 8
     or upper(btrim(p_points_short_name)) in ('DC','TP','XP') then raise exception 'invalid points short name'; end if;
  if p_points_icon is not null and p_points_icon !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then raise exception 'invalid points icon'; end if;
  if p_points_color is not null and p_points_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid points color'; end if;
  if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.organization_type in ('gym','brand','company')) then
    raise exception 'unsupported Partner organization';
  end if;
  insert into public.partner_point_configs(organization_id,points_name,points_short_name,points_icon,points_color,enabled,updated_by,governance_source,explicitly_managed_at)
  values(p_organization_id,btrim(p_points_name),upper(btrim(p_points_short_name)),p_points_icon,upper(p_points_color),coalesce(p_enabled,false),v_actor,'EXPLICIT',now())
  on conflict(organization_id) do update set points_name=excluded.points_name,points_short_name=excluded.points_short_name,
    points_icon=excluded.points_icon,points_color=excluded.points_color,enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now(),
    governance_source='EXPLICIT',explicitly_managed_at=now()
  returning * into v_row;
  return jsonb_build_object('organization_id',v_row.organization_id,'points_name',v_row.points_name,
    'points_short_name',v_row.points_short_name,'points_icon',v_row.points_icon,'points_color',v_row.points_color,'enabled',v_row.enabled);
end $$;
revoke all on function public.admin_update_partner_point_config(uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.admin_update_partner_point_config(uuid,text,text,text,text,boolean) to authenticated;

create or replace function public.require_partner_economy_enabled_mp001(p_organization_id uuid,p_expected_kind text default null)
returns void language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_type text; v_enabled boolean;
begin
  select o.organization_type,coalesce(c.enabled,false) into v_type,v_enabled
  from public.organizations o left join public.partner_point_configs c on c.organization_id=o.id
  where o.id=p_organization_id and o.verification_status='verified';
  if v_type not in ('gym','brand','company') or not v_enabled then raise exception 'Partner economy is disabled'; end if;
  if p_expected_kind='gp' and v_type<>'gym' then raise exception 'invalid Gym economy'; end if;
  if p_expected_kind='sp' and v_type not in ('brand','company') then raise exception 'invalid Brand/Company economy'; end if;
end $$;
revoke all on function public.require_partner_economy_enabled_mp001(uuid,text) from public,anon,authenticated;

-- Existing emitters all delegate to these two primitives; guarding them closes indirect issuance.
create or replace function public.marketplace_partner_wallet_emission_guard_mp001()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' then
    if tg_table_name='gym_point_ledger' and new.gym_organization_id is distinct from old.gym_organization_id then
      raise exception 'ledger organization is immutable';
    elsif tg_table_name='sponsor_point_ledger' and new.sponsor_organization_id is distinct from old.sponsor_organization_id then
      raise exception 'ledger organization is immutable';
    end if;
  end if;
  if tg_table_name='gym_point_ledger' and new.amount>0 then
    perform public.require_partner_economy_enabled_mp001(new.gym_organization_id,'gp');
  elsif tg_table_name='sponsor_point_ledger' and new.amount>0 then
    perform public.require_partner_economy_enabled_mp001(new.sponsor_organization_id,'sp');
  end if;
  return new;
end $$;
revoke all on function public.marketplace_partner_wallet_emission_guard_mp001() from public,anon,authenticated;
drop trigger if exists marketplace_partner_gp_emission_guard_mp001 on public.gym_point_ledger;
create trigger marketplace_partner_gp_emission_guard_mp001 before insert or update of gym_organization_id,amount on public.gym_point_ledger
for each row execute function public.marketplace_partner_wallet_emission_guard_mp001();
drop trigger if exists marketplace_partner_sp_emission_guard_mp001 on public.sponsor_point_ledger;
create trigger marketplace_partner_sp_emission_guard_mp001 before insert or update of sponsor_organization_id,amount on public.sponsor_point_ledger
for each row execute function public.marketplace_partner_wallet_emission_guard_mp001();

create or replace function public.marketplace_partner_wallet_direct_guard_mp001()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_table_name='gym_point_wallets' then
    if tg_op='UPDATE' and new.gym_organization_id is distinct from old.gym_organization_id then raise exception 'wallet organization is immutable'; end if;
    perform public.require_partner_economy_enabled_mp001(new.gym_organization_id,'gp');
    if new.balance is distinct from new.lifetime_earned-new.lifetime_spent then
      raise exception 'inconsistent Gym wallet mutation';
    end if;
  elsif tg_table_name='sponsor_point_wallets' then
    if tg_op='UPDATE' and new.sponsor_organization_id is distinct from old.sponsor_organization_id then raise exception 'wallet organization is immutable'; end if;
    perform public.require_partner_economy_enabled_mp001(new.sponsor_organization_id,'sp');
    if new.balance is distinct from new.lifetime_earned-new.lifetime_spent then
      raise exception 'inconsistent Brand/Company wallet mutation';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.marketplace_partner_wallet_direct_guard_mp001() from public,anon,authenticated,service_role;
drop trigger if exists marketplace_partner_gp_wallet_guard_mp001 on public.gym_point_wallets;
create trigger marketplace_partner_gp_wallet_guard_mp001 before insert or update
on public.gym_point_wallets for each row execute function public.marketplace_partner_wallet_direct_guard_mp001();
drop trigger if exists marketplace_partner_sp_wallet_guard_mp001 on public.sponsor_point_wallets;
create trigger marketplace_partner_sp_wallet_guard_mp001 before insert or update
on public.sponsor_point_wallets for each row execute function public.marketplace_partner_wallet_direct_guard_mp001();

create or replace function public.marketplace_partner_coupon_inventory_guard_mp001()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare v_scope text; v_org uuid;
begin
  select r.marketplace_scope,r.organization_id into v_scope,v_org from public.rewards r where r.id=new.reward_id;
  if v_scope='partner' and (tg_op='INSERT' or new.status='available') then
    perform public.require_partner_economy_enabled_mp001(v_org,null);
  end if;
  return new;
end $$;
revoke all on function public.marketplace_partner_coupon_inventory_guard_mp001() from public,anon,authenticated,service_role;
drop trigger if exists marketplace_partner_coupon_inventory_guard_mp001 on public.reward_coupon_codes;
create trigger marketplace_partner_coupon_inventory_guard_mp001 before insert or update of status,reward_id
on public.reward_coupon_codes for each row execute function public.marketplace_partner_coupon_inventory_guard_mp001();

revoke execute on function public.grant_gym_points(uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.grant_sponsor_points(uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.spend_gym_points_internal(uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.spend_sponsor_points_internal(uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated,service_role;

-- -----------------------------------------------------------------------------
-- T06: authoritative discovery and non-destructive GP/SP balance facade
-- -----------------------------------------------------------------------------

create or replace function public.get_my_partner_point_wallets()
returns table(
  organization_id uuid,organization_name text,organization_type text,organization_logo text,
  partner_currency text,physical_wallet_kind text,balance bigint,lifetime_earned bigint,lifetime_spent bigint,
  redeemable boolean,relationship_reason text,points_name text,points_short_name text,points_icon text,points_color text,enabled boolean
) language sql stable security definer set search_path=pg_catalog as $$
with actor as (select auth.uid() id), evidence as (
  select o.id organization_id,o.name,o.organization_type,o.logo_url,
    coalesce(g.balance,s.balance,0)::bigint balance,coalesce(g.lifetime_earned,s.lifetime_earned,0)::bigint lifetime_earned,
    coalesce(g.lifetime_spent,s.lifetime_spent,0)::bigint lifetime_spent,
    exists(select 1 from public.organization_members m where m.organization_id=o.id and m.user_id=(select id from actor) and m.status='active') active_member,
    exists(select 1 from public.organization_members m where m.organization_id=o.id and m.user_id=(select id from actor)) historical_member,
    (g.user_id is not null or s.user_id is not null) has_wallet,
    exists(select 1 from public.gym_point_ledger l where l.gym_organization_id=o.id and l.user_id=(select id from actor)
      and l.entry_type='grant' and l.source_type in ('gym_score_event','eco2_historical_backfill'))
      or exists(select 1 from public.sponsor_point_ledger l where l.sponsor_organization_id=o.id and l.user_id=(select id from actor)
      and l.entry_type='grant' and l.source_type='sponsored_challenge_reward') has_activity,
    exists(select 1 from public.reward_redemptions rr where rr.user_id=(select id from actor)
      and coalesce(rr.organization_id_snapshot,rr.payment_organization_id)=o.id) has_redemption,
    coalesce(c.points_name,'Partner Points') points_name,coalesce(c.points_short_name,'PP') points_short_name,
    case when c.points_icon ~ '^[a-z0-9][a-z0-9_-]{0,63}$' then c.points_icon end points_icon,
    coalesce(c.points_color,'#64748B') points_color,coalesce(c.enabled,false) enabled,o.verification_status
  from public.organizations o cross join actor
  left join public.partner_point_configs c on c.organization_id=o.id
  left join public.gym_point_wallets g on o.organization_type='gym' and g.gym_organization_id=o.id and g.user_id=actor.id
  left join public.sponsor_point_wallets s on o.organization_type in ('brand','company') and s.sponsor_organization_id=o.id and s.user_id=actor.id
  where actor.id is not null and o.organization_type in ('gym','brand','company')
), visible as (
  select e.*,case when active_member then 'ACTIVE_MEMBERSHIP'
    when has_wallet and balance>0 then 'PARTNER_WALLET' when has_activity then 'PARTNER_ACTIVITY'
    when has_redemption then 'REDEMPTION_HISTORY' when historical_member then 'HISTORICAL_MEMBERSHIP' end reason
  from evidence e
  where active_member or (has_wallet and balance>0) or has_activity or has_redemption or historical_member
)
select v.organization_id,v.name,v.organization_type,v.logo_url,'PARTNER_POINTS'::text,
  case when v.organization_type='gym' then 'GYM' else 'BRAND_COMPANY' end,
  v.balance,v.lifetime_earned,v.lifetime_spent,
  (v.enabled and v.verification_status='verified' and (v.organization_type<>'gym' or v.active_member)),
  v.reason,v.points_name,v.points_short_name,v.points_icon,v.points_color,v.enabled
from visible v
$$;
revoke all on function public.get_my_partner_point_wallets() from public,anon;
grant execute on function public.get_my_partner_point_wallets() to authenticated;

create or replace function public.get_my_partner_marketplaces()
returns table(
  organization_id uuid,organization_name text,organization_type text,organization_logo text,
  points_name text,points_short_name text,points_icon text,points_color text,enabled boolean,balance bigint,
  relationship_reason text,marketplace_state text
) language sql stable security definer set search_path=pg_catalog as $$
select w.organization_id,w.organization_name,w.organization_type,w.organization_logo,w.points_name,w.points_short_name,
  w.points_icon,w.points_color,w.enabled,w.balance,w.relationship_reason,
  case
    when o.verification_status<>'verified' then 'HISTORY_ONLY'
    when not w.enabled then 'DISABLED'
    when w.redeemable then 'OPERATIONAL'
    else 'HISTORY_ONLY'
  end
from public.get_my_partner_point_wallets() w join public.organizations o on o.id=w.organization_id
$$;
revoke all on function public.get_my_partner_marketplaces() from public,anon;
grant execute on function public.get_my_partner_marketplaces() to authenticated;

-- -----------------------------------------------------------------------------
-- T07: authoritative allowlisted catalog DTOs
-- -----------------------------------------------------------------------------

create or replace function public.get_partner_marketplace(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid(); v_market record; v_items jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_market from public.get_my_partner_marketplaces() m
  where m.organization_id=p_organization_id and m.marketplace_state='OPERATIONAL';
  if not found then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'reward_id',r.id,'organization_id',r.organization_id,'organization_name',v_market.organization_name,
    'organization_logo',v_market.organization_logo,'marketplace_scope',r.marketplace_scope,'title',r.title,
    'description',r.description,'reward_type',r.reward_type,'image_url',r.image_url,'native_cost',r.native_cost,
    'points_name',v_market.points_name,'points_short_name',v_market.points_short_name,'points_icon',v_market.points_icon,
    'points_color',v_market.points_color,'remaining_stock',s.remaining,'starts_at',r.starts_at,'ends_at',r.ends_at,
    'max_per_user',r.max_per_user,'user_redemptions',u.claimed,'fulfillment_type',r.fulfillment_type,'terms',r.terms,
    'can_redeem',(b.reason='NONE'),'blocked_reason',b.reason
  ) order by r.created_at desc),'[]'::jsonb) into v_items
  from public.rewards r
  cross join lateral (select public.reward_remaining_stock(r.id)::bigint remaining) s
  cross join lateral (select count(*)::bigint claimed from public.reward_redemptions rr
    where rr.reward_id=r.id and rr.user_id=v_actor and rr.status<>'cancelled') u
  cross join lateral (select case
    when not v_market.enabled then 'ECONOMY_DISABLED' when r.status<>'active' then 'REWARD_INACTIVE'
    when r.starts_at is not null and r.starts_at>now() then 'NOT_STARTED'
    when r.ends_at is not null and r.ends_at<=now() then 'EXPIRED'
    when s.remaining is not null and s.remaining<=0 and r.fulfillment_mode='code_pool' then 'CODE_POOL_EMPTY'
    when s.remaining is not null and s.remaining<=0 then 'OUT_OF_STOCK'
    when u.claimed>=r.max_per_user then 'MAX_PER_USER_REACHED'
    when v_market.balance<r.native_cost then 'INSUFFICIENT_BALANCE' else 'NONE' end reason) b
  where r.organization_id=p_organization_id and r.marketplace_scope='partner'
    and r.status in ('active','paused');
  return v_items;
end $$;
revoke all on function public.get_partner_marketplace(uuid) from public,anon;
grant execute on function public.get_partner_marketplace(uuid) to authenticated;

create or replace function public.get_dadofit_marketplace()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid(); v_balance bigint; v_items jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select coalesce(w.balance,0) into v_balance from public.wallets w where w.user_id=v_actor;
  v_balance:=coalesce(v_balance,0);
  select coalesce(jsonb_agg(jsonb_build_object(
    'reward_id',r.id,'organization_id',null,'organization_name','DadoFit','organization_logo',null,
    'marketplace_scope','dadofit','title',r.title,'description',r.description,'reward_type',r.reward_type,
    'image_url',r.image_url,'native_cost',r.coin_cost,'points_name','DadoCoins','points_short_name','DC',
    'points_icon',null,'points_color','#6D5DFC','remaining_stock',s.remaining,'starts_at',r.starts_at,'ends_at',r.ends_at,
    'max_per_user',r.max_per_user,'user_redemptions',u.claimed,'fulfillment_type',r.fulfillment_type,'terms',r.terms,
    'can_redeem',(b.reason='NONE'),'blocked_reason',b.reason
  ) order by r.created_at desc),'[]'::jsonb) into v_items
  from public.rewards r
  cross join lateral (select public.reward_remaining_stock(r.id)::bigint remaining) s
  cross join lateral (select count(*)::bigint claimed from public.reward_redemptions rr
    where rr.reward_id=r.id and rr.user_id=v_actor and rr.status<>'cancelled') u
  cross join lateral (select case when r.status<>'active' then 'REWARD_INACTIVE'
    when r.starts_at is not null and r.starts_at>now() then 'NOT_STARTED' when r.ends_at is not null and r.ends_at<=now() then 'EXPIRED'
    when s.remaining is not null and s.remaining<=0 and r.fulfillment_mode='code_pool' then 'CODE_POOL_EMPTY'
    when s.remaining is not null and s.remaining<=0 then 'OUT_OF_STOCK' when u.claimed>=r.max_per_user then 'MAX_PER_USER_REACHED'
    when v_balance<r.coin_cost then 'INSUFFICIENT_BALANCE' else 'NONE' end reason) b
  where r.marketplace_scope='dadofit' and r.organization_id is null and r.status in ('active','paused');
  return jsonb_build_object('balance',v_balance,'offers',v_items);
end $$;
revoke all on function public.get_dadofit_marketplace() from public,anon;
grant execute on function public.get_dadofit_marketplace() to authenticated;

-- -----------------------------------------------------------------------------
-- T08: sole atomic redemption entrypoint
-- -----------------------------------------------------------------------------

drop function if exists public.redeem_reward(uuid,text);
create function public.redeem_reward(p_reward_id uuid,p_payment_method text default 'dc')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid(); v_reward public.rewards; v_org public.organizations; v_method text:=lower(btrim(p_payment_method));
  v_amount bigint; v_balance bigint; v_claimed bigint; v_remaining integer; v_redemption uuid:=gen_random_uuid();
  v_reference text:='DF-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)); v_code text; v_url text; v_coupon uuid;
  v_points_name text; v_points_short text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_reward from public.rewards where id=p_reward_id for update;
  if not found then raise exception 'reward not found'; end if;
  if v_reward.status<>'active' then raise exception 'reward is not active'; end if;
  if v_reward.starts_at is not null and v_reward.starts_at>now() then raise exception 'reward is not available yet'; end if;
  if v_reward.ends_at is not null and v_reward.ends_at<=now() then raise exception 'reward has expired'; end if;
  if v_reward.marketplace_scope='dadofit' then
    if v_method<>'dc' or v_reward.organization_id is not null then raise exception 'DadoFit rewards require DC'; end if;
    v_amount:=v_reward.coin_cost; v_points_name:='DadoCoins'; v_points_short:='DC';
  else
    select * into v_org from public.organizations where id=v_reward.organization_id;
    perform public.require_partner_economy_enabled_mp001(v_reward.organization_id,v_reward.native_currency);
    if v_method is distinct from v_reward.native_currency then raise exception 'Partner reward requires its own Partner Points'; end if;
    if v_org.organization_type='gym' and not exists(select 1 from public.organization_members m
      where m.organization_id=v_org.id and m.user_id=v_actor and m.status='active') then raise exception 'active Gym membership required'; end if;
    v_amount:=v_reward.native_cost;
    select c.points_name,c.points_short_name into v_points_name,v_points_short from public.partner_point_configs c where c.organization_id=v_org.id;
  end if;
  select public.reward_remaining_stock(p_reward_id) into v_remaining;
  if v_remaining is not null and v_remaining<=0 then raise exception 'reward is sold out'; end if;
  select count(*) into v_claimed from public.reward_redemptions rr where rr.reward_id=p_reward_id and rr.user_id=v_actor and rr.status<>'cancelled';
  if v_claimed>=v_reward.max_per_user then raise exception 'redemption limit reached'; end if;
  if v_reward.fulfillment_mode='shared_code' then v_code:=v_reward.shared_code;
  elsif v_reward.fulfillment_mode='redemption_url' then v_url:=v_reward.redemption_url;
  elsif v_reward.fulfillment_mode='generated_code' then v_code:=v_reference;
  elsif v_reward.fulfillment_mode='code_pool' then
    select c.id,c.code into v_coupon,v_code from public.reward_coupon_codes c where c.reward_id=p_reward_id and c.status='available'
    order by c.created_at,c.id for update skip locked limit 1;
    if v_coupon is null then raise exception 'no promo codes available'; end if;
  end if;
  if v_method='dc' then
    select w.balance into v_balance from public.wallets w where w.user_id=v_actor for update;
    if not found or v_balance<v_amount then raise exception 'insufficient DadoCoins'; end if;
    update public.wallets set balance=balance-v_amount,updated_at=now() where user_id=v_actor returning balance into v_balance;
    insert into public.wallet_transactions(wallet_id,amount,source_type,source_id,description,idempotency_key)
    select w.id,-v_amount,'reward_redemption',p_reward_id,'Canje: '||v_reward.title,'reward-redemption:'||v_redemption from public.wallets w where w.user_id=v_actor;
  elsif v_method='gp' then
    select x.new_balance into v_balance from public.spend_gym_points_internal(v_actor,v_reward.organization_id,v_amount,
      'reward_redemption',p_reward_id,'Canje: '||v_reward.title,'reward-redemption:'||v_redemption||':gp') x;
  elsif v_method='sp' then
    select x.new_balance into v_balance from public.spend_sponsor_points_internal(v_actor,v_reward.organization_id,v_amount,
      'reward_redemption',p_reward_id,'Canje: '||v_reward.title,'reward-redemption:'||v_redemption||':sp') x;
  else raise exception 'invalid payment method'; end if;
  insert into public.reward_redemptions(id,reward_id,user_id,coin_cost,payment_currency,payment_amount,payment_organization_id,status,
    redemption_reference,redemption_code,redemption_url_snapshot,reward_title_snapshot,provider_name_snapshot,reward_image_snapshot,
    organization_id_snapshot,organization_name_snapshot,marketplace_scope_snapshot,points_name_snapshot,points_short_name_snapshot,
    fulfillment_type,fulfillment_mode_snapshot,fulfillment_instructions,terms_snapshot,issued_at,expires_at)
  values(v_redemption,p_reward_id,v_actor,v_reward.coin_cost,v_method,v_amount,case when v_method='dc' then null else v_reward.organization_id end,'issued',
    v_reference,v_code,v_url,v_reward.title,coalesce(v_org.name,'DadoFit'),v_reward.image_url,v_reward.organization_id,coalesce(v_org.name,'DadoFit'),
    v_reward.marketplace_scope,v_points_name,v_points_short,v_reward.fulfillment_type,v_reward.fulfillment_mode,
    v_reward.fulfillment_instructions,v_reward.terms,now(),v_reward.ends_at);
  if v_coupon is not null then update public.reward_coupon_codes set status='assigned',assigned_redemption_id=v_redemption,
    assigned_user_id=v_actor,assigned_at=now() where id=v_coupon; end if;
  insert into public.notifications(user_id,notification_type,title,body,data) values(v_actor,'reward_redeemed','Premio canjeado',
    format('%s por %s %s',v_reward.title,v_amount,upper(v_method)),jsonb_build_object('reward_id',p_reward_id,'redemption_id',v_redemption,'reference',v_reference));
  return jsonb_build_object('redemption_id',v_redemption,'reward_id',p_reward_id,'title',v_reward.title,'organization_name',coalesce(v_org.name,'DadoFit'),
    'new_balance',v_balance,'payment_currency',v_method,'payment_amount',v_amount,'redemption_reference',v_reference,
    'assigned_code',v_code,'redemption_url',v_url,'fulfillment_type',v_reward.fulfillment_type,'fulfillment_mode',v_reward.fulfillment_mode,
    'fulfillment_instructions',v_reward.fulfillment_instructions);
end $$;
revoke all on function public.redeem_reward(uuid,text) from public,anon;
grant execute on function public.redeem_reward(uuid,text) to authenticated;

-- -----------------------------------------------------------------------------
-- T09: filtered history and fulfillment DTOs; authorization is in each query
-- -----------------------------------------------------------------------------

create or replace function public.get_my_reward_redemption_history(p_organization_id uuid default null)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'redemption_id',rr.id,'reward_id',rr.reward_id,'organization_id_snapshot',rr.organization_id_snapshot,
  'organization_name_snapshot',rr.organization_name_snapshot,'marketplace_scope_snapshot',rr.marketplace_scope_snapshot,
  'reward_title_snapshot',rr.reward_title_snapshot,'reward_image_snapshot',rr.reward_image_snapshot,'redeemed_at',coalesce(rr.issued_at,rr.created_at),
  'status',rr.status,'payment_currency',rr.payment_currency,'payment_amount',rr.payment_amount,
  'points_name_snapshot',rr.points_name_snapshot,'points_short_name_snapshot',rr.points_short_name_snapshot,
  'fulfillment_type',rr.fulfillment_type,'redemption_reference',rr.redemption_reference,'expires_at',rr.expires_at,'fulfilled_at',rr.fulfilled_at
) order by rr.created_at desc),'[]'::jsonb)
from public.reward_redemptions rr
where rr.user_id=auth.uid() and (p_organization_id is null or rr.organization_id_snapshot=p_organization_id)
$$;
revoke all on function public.get_my_reward_redemption_history(uuid) from public,anon;
grant execute on function public.get_my_reward_redemption_history(uuid) to authenticated;

create or replace function public.get_my_reward_fulfillment(p_redemption_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
select jsonb_build_object('redemption_id',rr.id,'reward_title_snapshot',rr.reward_title_snapshot,
  'organization_id_snapshot',rr.organization_id_snapshot,'organization_name_snapshot',rr.organization_name_snapshot,
  'status',rr.status,'fulfillment_type',rr.fulfillment_type,'fulfillment_mode',rr.fulfillment_mode_snapshot,
  'fulfillment_instructions',rr.fulfillment_instructions,'assigned_code',rr.redemption_code,
  'redemption_url',rr.redemption_url_snapshot,'validation_token',rr.validation_token,'fulfillment_notes',rr.fulfillment_notes,
  'redemption_reference',rr.redemption_reference,'expires_at',rr.expires_at,'fulfilled_at',rr.fulfilled_at)
from public.reward_redemptions rr where rr.id=p_redemption_id and rr.user_id=auth.uid()
$$;
revoke all on function public.get_my_reward_fulfillment(uuid) from public,anon;
grant execute on function public.get_my_reward_fulfillment(uuid) to authenticated;

create or replace function public.provider_lookup_reward_redemption(p_lookup text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
select jsonb_build_object('redemption_id',rr.id,'reward_id',rr.reward_id,'reward_title_snapshot',rr.reward_title_snapshot,
  'organization_id_snapshot',rr.organization_id_snapshot,'user_id',rr.user_id,
  'user_name',coalesce(nullif(p.display_name,''),p.username,'Gymbro'),'username',p.username,'status',rr.status,
  'payment_currency',rr.payment_currency,'payment_amount',rr.payment_amount,'fulfillment_type',rr.fulfillment_type,
  'fulfillment_mode',rr.fulfillment_mode_snapshot,'assigned_code',rr.redemption_code,'redemption_reference',rr.redemption_reference,
  'validation_token',rr.validation_token,'expires_at',rr.expires_at,'fulfilled_at',rr.fulfilled_at,'fulfillment_notes',rr.fulfillment_notes)
from public.reward_redemptions rr left join public.profiles p on p.id=rr.user_id
where (rr.validation_token::text=btrim(p_lookup) or upper(coalesce(rr.redemption_reference,''))=upper(btrim(p_lookup)))
  and public.can_manage_rewards_for_org(rr.organization_id_snapshot,auth.uid())
order by rr.created_at desc limit 1
$$;
revoke all on function public.provider_lookup_reward_redemption(text) from public,anon;
grant execute on function public.provider_lookup_reward_redemption(text) to authenticated;

create or replace function public.provider_list_reward_redemptions(p_organization_id uuid,p_status text default 'all')
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
select case when public.can_manage_rewards_for_org(p_organization_id,auth.uid()) and p_status in ('all','issued','redeemed','cancelled') then
  coalesce(jsonb_agg(jsonb_build_object('redemption_id',rr.id,'reward_id',rr.reward_id,'reward_title_snapshot',rr.reward_title_snapshot,
    'organization_id_snapshot',rr.organization_id_snapshot,'user_id',rr.user_id,'user_name',coalesce(nullif(p.display_name,''),p.username,'Gymbro'),
    'username',p.username,'status',rr.status,'payment_currency',rr.payment_currency,'payment_amount',rr.payment_amount,
    'fulfillment_type',rr.fulfillment_type,'fulfillment_mode',rr.fulfillment_mode_snapshot,'assigned_code',rr.redemption_code,
    'redemption_reference',rr.redemption_reference,'validation_token',rr.validation_token,'expires_at',rr.expires_at,
    'fulfilled_at',rr.fulfilled_at,'fulfillment_notes',rr.fulfillment_notes) order by rr.created_at desc),'[]'::jsonb) else '[]'::jsonb end
from public.reward_redemptions rr left join public.profiles p on p.id=rr.user_id
where rr.organization_id_snapshot=p_organization_id and (p_status='all' or rr.status=p_status)
$$;
revoke all on function public.provider_list_reward_redemptions(uuid,text) from public,anon;
grant execute on function public.provider_list_reward_redemptions(uuid,text) to authenticated;

-- -----------------------------------------------------------------------------
-- T10: payment_amount is the only consumption amount in analytics
-- -----------------------------------------------------------------------------

create or replace function public.provider_reward_analytics(p_organization_id uuid,p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_days integer:=greatest(1,least(coalesce(p_days,30),365)); v_from timestamptz;
  v_offers_total integer; v_active_offers integer; v_redemptions integer; v_redeemed integer; v_unique_users integer;
  v_dc bigint; v_gp bigint; v_sp bigint; v_low_stock integer; v_offers jsonb; v_trend jsonb; v_recent jsonb; v_by_currency jsonb;
begin
  if auth.uid() is null or not public.can_manage_rewards_for_org(p_organization_id,auth.uid()) then raise exception 'not authorized'; end if;
  v_from:=date_trunc('day',now())-make_interval(days=>v_days-1);
  select count(*)::integer,count(*) filter(where status='active')::integer into v_offers_total,v_active_offers
  from public.rewards where organization_id=p_organization_id;
  select count(*)::integer,count(*) filter(where status='redeemed')::integer,count(distinct user_id)::integer,
    coalesce(sum(payment_amount) filter(where payment_currency='dc'),0)::bigint,
    coalesce(sum(payment_amount) filter(where payment_currency='gp'),0)::bigint,
    coalesce(sum(payment_amount) filter(where payment_currency='sp'),0)::bigint
  into v_redemptions,v_redeemed,v_unique_users,v_dc,v_gp,v_sp from public.reward_redemptions
  where organization_id_snapshot=p_organization_id and status<>'cancelled' and created_at>=v_from;
  select count(*)::integer into v_low_stock from public.rewards r where r.organization_id=p_organization_id
    and r.status in ('active','paused') and r.inventory is not null
    and coalesce(public.reward_remaining_stock(r.id),0)<=greatest(3,ceil(r.inventory*0.20)::integer);
  select coalesce(jsonb_agg(item order by (item->>'redemptions')::integer desc,item->>'title'),'[]'::jsonb) into v_offers from (
    select jsonb_build_object('reward_id',r.id,'title',r.title,'status',r.status,'coin_cost',r.coin_cost,
      'native_currency',r.native_currency,'native_cost',r.native_cost,'inventory',r.inventory,'remaining_stock',public.reward_remaining_stock(r.id),
      'redemptions',count(rr.id) filter(where rr.status<>'cancelled' and rr.created_at>=v_from),
      'redeemed',count(rr.id) filter(where rr.status='redeemed' and rr.created_at>=v_from),
      'unique_users',count(distinct rr.user_id) filter(where rr.status<>'cancelled' and rr.created_at>=v_from),
      'dc_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='dc'),0),
      'gp_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='gp'),0),
      'sp_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='sp'),0),
      'low_stock',r.inventory is not null and r.status in ('active','paused') and coalesce(public.reward_remaining_stock(r.id),0)<=greatest(3,ceil(r.inventory*0.20)::integer)) item
    from public.rewards r left join public.reward_redemptions rr on rr.reward_id=r.id where r.organization_id=p_organization_id group by r.id
  ) q;
  select coalesce(jsonb_agg(jsonb_build_object('day',d.bucket_day,'redemptions',coalesce(x.redemptions,0),
    'dc_consumed',coalesce(x.dc,0),'gp_consumed',coalesce(x.gp,0),'sp_consumed',coalesce(x.sp,0),'unique_users',coalesce(x.users,0)) order by d.bucket_day),'[]'::jsonb)
  into v_trend from generate_series(v_from::date,current_date,interval '1 day') d(bucket_day) left join (
    select created_at::date as bucket_day,count(*)::integer redemptions,
      coalesce(sum(payment_amount) filter(where payment_currency='dc'),0)::bigint dc,
      coalesce(sum(payment_amount) filter(where payment_currency='gp'),0)::bigint gp,
      coalesce(sum(payment_amount) filter(where payment_currency='sp'),0)::bigint sp,count(distinct user_id)::integer users
    from public.reward_redemptions where organization_id_snapshot=p_organization_id and status<>'cancelled' and created_at>=v_from group by created_at::date
  ) x on x.bucket_day=d.bucket_day::date;
  select coalesce(jsonb_agg(item order by item->>'created_at' desc),'[]'::jsonb) into v_recent from (
    select jsonb_build_object('redemption_id',rr.id,'reward_id',rr.reward_id,'reward_title',rr.reward_title_snapshot,
      'user_id',rr.user_id,'user_name',coalesce(nullif(p.display_name,''),p.username,'Gymbro'),'coin_cost',rr.coin_cost,
      'payment_currency',rr.payment_currency,'payment_amount',rr.payment_amount,'status',rr.status,'created_at',rr.created_at,'redeemed_at',rr.redeemed_at) item
    from public.reward_redemptions rr join public.profiles p on p.id=rr.user_id
    where rr.organization_id_snapshot=p_organization_id order by rr.created_at desc limit 20
  ) q;
  select coalesce(jsonb_object_agg(g.payment_currency,g.amount),'{}'::jsonb) into v_by_currency from (
    select payment_currency,sum(payment_amount)::bigint amount from public.reward_redemptions
    where organization_id_snapshot=p_organization_id and status<>'cancelled' and created_at>=v_from group by payment_currency
  ) g;
  return jsonb_build_object('period_days',v_days,'from',v_from,'summary',jsonb_build_object(
    'offers_total',v_offers_total,'active_offers',v_active_offers,'redemptions',v_redemptions,'redeemed',v_redeemed,
    'pending_delivery',greatest(v_redemptions-v_redeemed,0),'unique_users',v_unique_users,'dc_consumed',v_dc,
    'gp_consumed',v_gp,'sp_consumed',v_sp,'low_stock_offers',v_low_stock),
    'offers',v_offers,'trend',v_trend,'recent_redemptions',v_recent,'by_currency',v_by_currency);
end $$;
revoke all on function public.provider_reward_analytics(uuid,integer) from public,anon;
grant execute on function public.provider_reward_analytics(uuid,integer) to authenticated;

create or replace function public.admin_reward_analytics(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_days integer:=greatest(1,least(coalesce(p_days,30),365)); v_from timestamptz; v_result jsonb;
  v_redemptions integer; v_redeemed integer; v_users integer; v_dc bigint; v_gp bigint; v_sp bigint;
  v_dc_issued bigint; v_circulation bigint; v_active integer; v_providers integer; v_low integer;
  v_provider_data jsonb; v_top jsonb; v_trend jsonb; v_consumption jsonb;
begin
  perform public.require_platform_admin();
  v_from:=date_trunc('day',now())-make_interval(days=>v_days-1);
  select count(*)::integer,count(*) filter(where status='redeemed')::integer,count(distinct user_id)::integer,
    coalesce(sum(payment_amount) filter(where payment_currency='dc'),0)::bigint,
    coalesce(sum(payment_amount) filter(where payment_currency='gp'),0)::bigint,
    coalesce(sum(payment_amount) filter(where payment_currency='sp'),0)::bigint
  into v_redemptions,v_redeemed,v_users,v_dc,v_gp,v_sp from public.reward_redemptions where status<>'cancelled' and created_at>=v_from;
  select coalesce(sum(amount) filter(where amount>0),0)::bigint into v_dc_issued from public.wallet_transactions where created_at>=v_from;
  select coalesce(sum(balance),0)::bigint into v_circulation from public.wallets;
  select count(*)::integer into v_active from public.rewards where status='active';
  select count(distinct organization_id)::integer into v_providers from public.rewards where organization_id is not null;
  select count(*)::integer into v_low from public.rewards r where status in ('active','paused') and inventory is not null
    and coalesce(public.reward_remaining_stock(r.id),0)<=greatest(3,ceil(inventory*0.20)::integer);
  select coalesce(jsonb_agg(item order by item->>'organization_name'),'[]'::jsonb) into v_provider_data from (
    select jsonb_build_object('organization_id',o.id,'organization_name',o.name,'organization_type',o.organization_type,
      'active_rewards',count(distinct r.id) filter(where r.status='active'),
      'redemptions',count(rr.id) filter(where rr.status<>'cancelled' and rr.created_at>=v_from),
      'unique_users',count(distinct rr.user_id) filter(where rr.status<>'cancelled' and rr.created_at>=v_from),
      'dc_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='dc'),0),
      'gp_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='gp'),0),
      'sp_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='sp'),0),
      'low_stock',count(distinct r.id) filter(where r.inventory is not null and r.status in ('active','paused')
        and coalesce(public.reward_remaining_stock(r.id),0)<=greatest(3,ceil(r.inventory*0.20)::integer))) item
    from public.organizations o join public.rewards r on r.organization_id=o.id left join public.reward_redemptions rr on rr.reward_id=r.id
    group by o.id
  ) q;
  select coalesce(jsonb_agg(item order by (item->>'redemptions')::integer desc,item->>'title'),'[]'::jsonb) into v_top from (
    select jsonb_build_object('reward_id',r.id,'title',r.title,'organization_name',coalesce(o.name,'DadoFit'),
      'organization_type',o.organization_type,'status',r.status,'coin_cost',r.coin_cost,
      'redemptions',count(rr.id) filter(where rr.status<>'cancelled' and rr.created_at>=v_from),
      'unique_users',count(distinct rr.user_id) filter(where rr.status<>'cancelled' and rr.created_at>=v_from),
      'dc_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='dc'),0),
      'gp_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='gp'),0),
      'sp_consumed',coalesce(sum(rr.payment_amount) filter(where rr.status<>'cancelled' and rr.created_at>=v_from and rr.payment_currency='sp'),0),
      'remaining_stock',public.reward_remaining_stock(r.id)) item
    from public.rewards r left join public.organizations o on o.id=r.organization_id left join public.reward_redemptions rr on rr.reward_id=r.id
    group by r.id,o.id having count(rr.id) filter(where rr.status<>'cancelled' and rr.created_at>=v_from)>0 limit 20
  ) q;
  select coalesce(jsonb_agg(jsonb_build_object('day',d.bucket_day,'dc_issued',coalesce(w.dc_issued,0),'dc_consumed',coalesce(x.dc,0),
    'gp_consumed',coalesce(x.gp,0),'sp_consumed',coalesce(x.sp,0),'redemptions',coalesce(x.redemptions,0)) order by d.bucket_day),'[]'::jsonb)
  into v_trend from generate_series(v_from::date,current_date,interval '1 day') d(bucket_day)
  left join (select created_at::date as bucket_day,coalesce(sum(amount) filter(where amount>0),0)::bigint dc_issued from public.wallet_transactions
    where created_at>=v_from group by created_at::date) w on w.bucket_day=d.bucket_day::date
  left join (select created_at::date as bucket_day,count(*)::integer redemptions,
    coalesce(sum(payment_amount) filter(where payment_currency='dc'),0)::bigint dc,
    coalesce(sum(payment_amount) filter(where payment_currency='gp'),0)::bigint gp,
    coalesce(sum(payment_amount) filter(where payment_currency='sp'),0)::bigint sp
    from public.reward_redemptions where status<>'cancelled' and created_at>=v_from group by created_at::date) x on x.bucket_day=d.bucket_day::date;
  select coalesce(jsonb_agg(jsonb_build_object('organization_id',g.organization_id_snapshot,'payment_currency',g.payment_currency,
    'payment_amount',g.amount,'redemptions',g.redemptions) order by g.organization_id_snapshot nulls first,g.payment_currency),'[]'::jsonb)
  into v_consumption from (select organization_id_snapshot,payment_currency,sum(payment_amount)::bigint amount,count(*)::bigint redemptions
    from public.reward_redemptions where status<>'cancelled' and created_at>=v_from group by organization_id_snapshot,payment_currency) g;
  v_result:=jsonb_build_object('period_days',v_days,'from',v_from,'summary',jsonb_build_object(
    'redemptions',v_redemptions,'redeemed',v_redeemed,'pending_delivery',greatest(v_redemptions-v_redeemed,0),
    'unique_users',v_users,'dc_consumed',v_dc,'gp_consumed',v_gp,'sp_consumed',v_sp,'dc_issued',v_dc_issued,
    'dc_circulation',v_circulation,'active_rewards',v_active,'providers',v_providers,'low_stock_offers',v_low),
    'providers',v_provider_data,'top_rewards',v_top,'trend',v_trend,'consumption',v_consumption);
  return v_result;
end $$;
revoke all on function public.admin_reward_analytics(integer) from public,anon;
grant execute on function public.admin_reward_analytics(integer) to authenticated;

create or replace function public.get_partner_point_analytics(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_type text; v_emitted bigint; v_spent bigint; v_balance bigint; v_users bigint; v_redeemed bigint;
begin
  if not public.can_manage_rewards_for_org(p_organization_id,auth.uid()) then raise exception 'not authorized'; end if;
  select o.organization_type into v_type from public.organizations o where o.id=p_organization_id;
  if v_type='gym' then select coalesce(sum(lifetime_earned),0),coalesce(sum(lifetime_spent),0),coalesce(sum(balance),0),count(*)
    into v_emitted,v_spent,v_balance,v_users from public.gym_point_wallets where gym_organization_id=p_organization_id;
  elsif v_type in ('brand','company') then select coalesce(sum(lifetime_earned),0),coalesce(sum(lifetime_spent),0),coalesce(sum(balance),0),count(*)
    into v_emitted,v_spent,v_balance,v_users from public.sponsor_point_wallets where sponsor_organization_id=p_organization_id;
  else raise exception 'unsupported Partner organization'; end if;
  select coalesce(sum(payment_amount),0) into v_redeemed from public.reward_redemptions
  where payment_organization_id=p_organization_id and payment_currency=case when v_type='gym' then 'gp' else 'sp' end and status<>'cancelled';
  return jsonb_build_object('organization_id',p_organization_id,'partner_currency','PARTNER_POINTS','physical_wallet_kind',
    case when v_type='gym' then 'GYM' else 'BRAND_COMPANY' end,'emitted',v_emitted,'spent',v_spent,'circulation',v_balance,
    'active_users',v_users,'redemption_payment_amount',v_redeemed);
end $$;
revoke all on function public.get_partner_point_analytics(uuid) from public,anon;
grant execute on function public.get_partner_point_analytics(uuid) to authenticated;

-- Harden all touched SECURITY DEFINER functions and prevent accidental PUBLIC execution.
alter function public.can_manage_rewards_for_org(uuid,uuid) set search_path=pg_catalog;
alter function public.reward_remaining_stock(uuid) set search_path=pg_catalog;
alter function public.spend_gym_points_internal(uuid,uuid,bigint,text,uuid,text,text) set search_path=pg_catalog;
alter function public.spend_sponsor_points_internal(uuid,uuid,bigint,text,uuid,text,text) set search_path=pg_catalog;
alter function public.provider_create_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text,bigint) set search_path=pg_catalog;
alter function public.provider_update_reward(uuid,text,text,text,bigint,integer,integer,text,text,text,text,timestamptz,timestamptz,text,text,text,text,bigint) set search_path=pg_catalog;
alter function public.provider_list_rewards(uuid) set search_path=pg_catalog;
alter function public.provider_set_reward_status(uuid,text) set search_path=pg_catalog;
revoke all on function public.reward_remaining_stock(uuid) from public,anon,authenticated;

-- Quarantined historical violations remain queryable only by service/database operators.
-- Validate only in environments whose audit is clean; NOT VALID still enforces every new write.
do $$
begin
  if not exists(select 1 from public.marketplace_partner_integrity_audit
    where migration_version='MARKETPLACE-PARTNER-001' and check_name in ('reward_scope_organization','reward_scope_price') and issue_count>0) then
    alter table public.rewards validate constraint rewards_marketplace_scope_org_mp001;
  end if;
  if not exists(select 1 from public.marketplace_partner_integrity_audit
    where migration_version='MARKETPLACE-PARTNER-001' and check_name='redemption_payment_shape' and issue_count>0) then
    alter table public.reward_redemptions validate constraint reward_redemptions_payment_shape_mp001;
  end if;
end $$;

create or replace function public.get_dadofit_schema_version()
returns text language sql stable set search_path=pg_catalog as $$ select 'marketplace-partner-001-backend'::text $$;
revoke all on function public.get_dadofit_schema_version() from public;
grant execute on function public.get_dadofit_schema_version() to anon,authenticated;

notify pgrst,'reload schema';
