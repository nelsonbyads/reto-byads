-- Fix: eco4c_grant_dc failed with `column reference "new_balance" is ambiguous`
-- (42702) every time a DadoCoins budget actually paid a reward. Its own OUT
-- column is called new_balance and it read grant_wallet_coins().new_balance
-- unqualified. The error rolled back the whole approval, so approving any gym,
-- direct, squad or sponsored challenge with a DC reward and an active budget
-- failed with HTTP 500. It never showed up while no budget was active (the
-- function returns before that line). Found by the local demo seed (2026-11-11).
--
-- Identical to the definition in 20261007160000_eco4c_challenge_dc_budget.sql
-- except for the qualified column in the grant_wallet_coins() call.

create or replace function public.eco4c_grant_dc(
  p_user_id uuid,
  p_amount bigint,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_idempotency_key text
)
returns table(granted boolean, block_reason text, new_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget_id uuid;
  v_challenge public.challenges;
  v_consume jsonb;
  v_tx uuid;
  v_bal bigint;
begin
  select * into v_challenge from public.challenges where id = p_source_id;
  v_budget_id := public.eco4c_resolve_challenge_budget(p_source_id);

  if v_budget_id is null then
    -- No budget configured: block emission, record participant reason, return current balance.
    update public.challenge_participants
      set dc_block_reason = case when v_challenge.creator_organization_id is not null or v_challenge.sponsor_campaign_id is not null
        then 'budget_not_configured' else 'budget_not_configured' end
      where challenge_id = p_source_id and user_id = p_user_id;
    return query select false, 'budget_not_configured'::text, (select w.balance from public.wallets w where w.user_id = p_user_id);
    return;
  end if;

  v_consume := public.consume_dc_budget_internal(
    v_budget_id, p_amount, 'grant', p_user_id, p_source_id, null, 'reward_payout', p_source_type, null, p_idempotency_key);

  if (v_consume->>'success')::boolean is not true then
    update public.challenge_participants set dc_block_reason = v_consume->>'block_reason'
      where challenge_id = p_source_id and user_id = p_user_id;
    return query select false, (v_consume->>'block_reason')::text, (select w.balance from public.wallets w where w.user_id = p_user_id);
    return;
  end if;

  select g.new_balance into v_bal from public.grant_wallet_coins(
    p_user_id, p_amount, p_source_type, p_source_id, p_description, p_idempotency_key) as g;

  update public.challenge_participants set dc_block_reason = null
    where challenge_id = p_source_id and user_id = p_user_id;

  return query select true, null::text, v_bal;
end;
$$;
