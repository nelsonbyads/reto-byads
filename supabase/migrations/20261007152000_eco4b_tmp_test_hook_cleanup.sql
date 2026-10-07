-- Cleanup temporary ECO-4B test hook and test budgets.
delete from public.dc_budget_transactions where dc_budget_id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2');
delete from public.dc_budgets where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2');
drop function if exists public.__eco4b_consume_test(uuid,bigint,text);
