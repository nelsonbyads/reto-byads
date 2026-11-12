-- MARKETPLACE-PARTNER-001 T15 behavioral/security tests.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
select plan(41);

insert into auth.users(id,email,encrypted_password,aud,role,raw_user_meta_data)
values
 ('10000000-0000-0000-0000-000000000001','owner@test.local','x','authenticated','authenticated','{}'),
 ('10000000-0000-0000-0000-000000000002','member@test.local','x','authenticated','authenticated','{}'),
 ('10000000-0000-0000-0000-000000000003','outsider@test.local','x','authenticated','authenticated','{}'),
 ('10000000-0000-0000-0000-000000000004','super@test.local','x','authenticated','authenticated','{}');

insert into public.platform_admins(user_id,role,active) values('10000000-0000-0000-0000-000000000004','superadmin',true);
insert into public.organizations(id,owner_user_id,name,slug,organization_type,verification_status)
values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Fixture Gym','fixture-gym','gym','verified'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Fixture Brand','fixture-brand','brand','verified'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Unrelated Brand','fixture-other','brand','verified'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Legacy Sponsor','fixture-sponsor','sponsor','verified');

select is((select enabled from public.partner_point_configs where organization_id='20000000-0000-0000-0000-000000000001'),false,'new Gym config is disabled');
select is((select governance_source from public.partner_point_configs where organization_id='20000000-0000-0000-0000-000000000002'),'AUTO_SEEDED','new Brand config records auto provenance');

insert into public.organization_members(organization_id,user_id,role,status) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner','active'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','member','active'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','owner','active');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.update_partner_point_presentation('20000000-0000-0000-0000-000000000001','Fixture Points','FP','star','#112233')$$,'Owner edits presentation');
select is((select enabled from public.partner_point_configs where organization_id='20000000-0000-0000-0000-000000000001'),false,'Owner presentation preserves disabled');
select is((select governance_source from public.partner_point_configs where organization_id='20000000-0000-0000-0000-000000000001'),'EXPLICIT','presentation records explicit governance');
select throws_ok($$select public.update_partner_point_presentation('20000000-0000-0000-0000-000000000004','Legacy Points','LP','star','#112233')$$,
  'unsupported Partner organization','unsupported organization cannot create Partner presentation config');
select throws_ok($$select public.admin_update_partner_point_config('20000000-0000-0000-0000-000000000001','Fixture Points','FP','star','#112233',true)$$,'platform superadmin required','Owner cannot enable economy');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
select lives_ok($$select public.admin_update_partner_point_config('20000000-0000-0000-0000-000000000001','Fixture Points','FP','star','#112233',true)$$,'SuperAdmin enables Gym');
select lives_ok($$select public.admin_update_partner_point_config('20000000-0000-0000-0000-000000000002','Brand Points','BP','award','#334455',true)$$,'SuperAdmin enables Brand');

insert into public.gym_point_wallets(user_id,gym_organization_id,balance,lifetime_earned,lifetime_spent)
values('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',100,100,0);
insert into public.gym_point_ledger(user_id,gym_organization_id,amount,balance_after,entry_type,source_type,description,idempotency_key)
values('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',100,100,'grant','gym_score_event','fixture','mp001:gp:fixture');

insert into public.rewards(id,organization_id,title,reward_type,coin_cost,native_currency,native_cost,inventory,status,
  starts_at,ends_at,max_per_user,marketplace_scope,fulfillment_type,fulfillment_mode,terms)
values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Gym Reward','product',999,'gp',10,2,'active',now()-interval '1 day',now()+interval '1 day',1,'partner','digital_code','generated_code','public terms'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Future Reward','product',999,'gp',20,5,'active',now()+interval '1 day',now()+interval '2 day',1,'partner','digital_code','generated_code','public terms'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Paused Reward','product',999,'gp',20,5,'paused',null,null,1,'partner','digital_code','generated_code','public terms'),
 ('30000000-0000-0000-0000-000000000004',null,'DadoFit Reward','product',25,null,null,5,'active',null,null,1,'dadofit','digital_code','generated_code','public terms');

select throws_ok($$insert into public.rewards(organization_id,title,reward_type,coin_cost,status,marketplace_scope,fulfillment_type,fulfillment_mode)
 values(null,'Invalid DC','product',0,'draft','dadofit','digital_code','generated_code')$$,'invalid DadoFit reward contract','DadoFit coin_cost must be positive');
select throws_ok($$insert into public.reward_redemptions(reward_id,user_id,coin_cost,payment_currency,payment_amount,payment_organization_id,status)
 values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',999,'gp',10,'20000000-0000-0000-0000-000000000002','issued')$$,
 'invalid cross-organization Partner payment','privileged cross-org redemption is rejected');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select is(public.get_partner_marketplace('20000000-0000-0000-0000-000000000001'),'[]'::jsonb,'deep link without relationship is non-enumerable');
select is((select count(*) from public.get_my_partner_marketplaces()),0::bigint,'unrelated user discovery is empty');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select is((select marketplace_state from public.get_my_partner_marketplaces() where organization_id='20000000-0000-0000-0000-000000000001'),'OPERATIONAL','active Gym member is operational');
select is((select x->>'blocked_reason' from jsonb_array_elements(public.get_partner_marketplace('20000000-0000-0000-0000-000000000001')) x where x->>'title'='Future Reward'),'NOT_STARTED','future reward is returned with NOT_STARTED');
select is((select x->>'blocked_reason' from jsonb_array_elements(public.get_partner_marketplace('20000000-0000-0000-0000-000000000001')) x where x->>'title'='Paused Reward'),'REWARD_INACTIVE','paused reward is returned with REWARD_INACTIVE');
select ok(not (public.get_partner_marketplace('20000000-0000-0000-0000-000000000001')::text ~ '(shared_code|redemption_url|fulfillment_instructions|validation_token)'),'catalog has no fulfillment secrets');
select throws_ok($$select public.redeem_reward('30000000-0000-0000-0000-000000000001','dc')$$,'Partner reward requires its own Partner Points','DC cannot pay Partner reward');
select lives_ok($$select public.redeem_reward('30000000-0000-0000-0000-000000000001','gp')$$,'Partner redemption succeeds atomically');
select is((select balance from public.gym_point_wallets where user_id='10000000-0000-0000-0000-000000000002' and gym_organization_id='20000000-0000-0000-0000-000000000001'),90::bigint,'successful redemption debits exact payment_amount');
select is((select payment_amount from public.reward_redemptions where reward_id='30000000-0000-0000-0000-000000000001'),10::bigint,'redemption stores canonical amount, not coin_cost');
select is((select marketplace_scope_snapshot||':'||points_short_name_snapshot from public.reward_redemptions where reward_id='30000000-0000-0000-0000-000000000001'),
  'partner:FP','redemption guard persists canonical immutable snapshots');
select throws_ok($$select public.redeem_reward('30000000-0000-0000-0000-000000000001','gp')$$,'redemption limit reached','max_per_user blocks second redemption');
select is((select balance from public.gym_point_wallets where user_id='10000000-0000-0000-0000-000000000002' and gym_organization_id='20000000-0000-0000-0000-000000000001'),90::bigint,'failed redemption rolls debit back');

select ok(public.get_my_reward_fulfillment((select id from public.reward_redemptions where reward_id='30000000-0000-0000-0000-000000000001')) is not null,'owner sees issued fulfillment');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select is(public.get_my_reward_fulfillment((select id from public.reward_redemptions where reward_id='30000000-0000-0000-0000-000000000001')),null::jsonb,'other user cannot see fulfillment');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((public.provider_reward_analytics('20000000-0000-0000-0000-000000000001',30)->'summary'->>'gp_consumed')::bigint,10::bigint,'provider analytics uses payment_amount');
select is((public.provider_reward_analytics('20000000-0000-0000-0000-000000000001',30)->'by_currency'->>'gp')::bigint,10::bigint,'provider by_currency is grouped');
select ok(public.provider_reward_analytics('20000000-0000-0000-0000-000000000001',30) ?& array['summary','offers','trend','recent_redemptions','by_currency'],'provider analytics preserves complete JSON contract');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
select is((public.admin_reward_analytics(30)->'summary'->>'gp_consumed')::bigint,10::bigint,'admin analytics uses canonical GP amount');
select ok(public.admin_reward_analytics(30) ?& array['summary','providers','top_rewards','trend','consumption'],'admin analytics preserves complete JSON contract');

select is(public.redact_reward_secrets_mp001('{"safe":{"label":"keep","nested":{"shared_code":"SECRET"}},"metadata":{"campaign":"retain"}}'::jsonb),
  '{"safe":{"label":"keep","nested":{"shared_code":"[REDACTED]"}},"metadata":{"campaign":"retain"}}'::jsonb,'recursive redaction preserves non-secret metadata');
insert into public.reward_offer_events(reward_id,organization_id,actor_user_id,action,after_data)
values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','test.redaction','{"shared_code":"NEW_SECRET","safe":"keep"}');
select is((select after_data from public.reward_offer_events where action='test.redaction'),
  '{"safe":"keep","shared_code":"[REDACTED]"}'::jsonb,'future audit writes are redacted at persistence boundary');
select throws_ok($$insert into public.gym_point_wallets(user_id,gym_organization_id,balance,lifetime_earned,lifetime_spent)
  values('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',50,10,0)$$,
  'inconsistent Gym wallet mutation','inconsistent privileged wallet insert is rejected');
select throws_ok($$update public.gym_point_wallets set gym_organization_id='20000000-0000-0000-0000-000000000003'
  where user_id='10000000-0000-0000-0000-000000000002' and gym_organization_id='20000000-0000-0000-0000-000000000001'$$,
  'wallet organization is immutable','privileged wallet organization reassignment is rejected');

select ok(not has_table_privilege('authenticated','public.rewards','SELECT')
  and not has_table_privilege('authenticated','public.reward_redemptions','SELECT')
  and not has_table_privilege('authenticated','public.reward_coupon_codes','SELECT'),'direct sensitive SELECT grants are closed');
select ok(not has_function_privilege('authenticated','public.grant_gym_points(uuid,uuid,bigint,text,uuid,text,text)','EXECUTE')
  and not has_function_privilege('service_role','public.grant_gym_points(uuid,uuid,bigint,text,uuid,text,text)','EXECUTE'),'direct grant primitive is not API executable');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef
  and p.proname in ('get_partner_marketplace','get_dadofit_marketplace','redeem_reward','get_my_reward_redemption_history','get_my_reward_fulfillment',
    'provider_lookup_reward_redemption','provider_reward_analytics','admin_reward_analytics','eco4h_seed_partner_point_config')
  and not exists(select 1 from unnest(coalesce(p.proconfig,'{}')) c where c='search_path=pg_catalog')),'sensitive definers have fixed search_path');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('get_partner_marketplace','get_dadofit_marketplace','redeem_reward','get_my_reward_redemption_history',
    'get_my_reward_fulfillment','provider_lookup_reward_redemption','provider_reward_analytics','admin_reward_analytics')
  and pg_get_userbyid(p.proowner)<>'postgres'),'sensitive entrypoints are owned by postgres');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.get_partner_marketplace('20000000-0000-0000-0000-000000000001')$$,'authenticated role can execute safe catalog RPC');
select throws_ok($$select * from public.rewards$$,'permission denied for table rewards','authenticated role cannot bypass DTO with direct SELECT');
reset role;

select * from finish();
rollback;
