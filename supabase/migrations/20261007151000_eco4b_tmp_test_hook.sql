-- TEMPORARY test hook for ECO-4B concurrency/idempotency verification. Removed by 20261007152000_eco4b_tmp_test_hook_cleanup.sql
insert into public.dc_budgets (id, is_dadofit_internal, budget_dc, status, approved_by, approved_at)
values ('00000000-0000-0000-0000-0000000000b1', true, 25, 'active', null, now());

create or replace function public.__eco4b_consume_test(p_budget uuid, p_amount bigint, p_key text)
returns jsonb language sql security definer set search_path = public as $$
  select public.consume_dc_budget_internal(p_budget, p_amount, 'grant', null, null, null, 'reward_payout', 'test', null, p_key);
$$;
grant execute on function public.__eco4b_consume_test(uuid,bigint,text) to anon, authenticated;
