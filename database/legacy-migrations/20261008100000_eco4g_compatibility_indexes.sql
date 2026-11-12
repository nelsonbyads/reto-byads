-- DadoFit 2.1 - ECO-4G Compatibility + final indexes
create index if not exists challenges_dc_budget_idx on public.challenges(dc_budget_id);
create index if not exists challenge_participants_dc_block_idx on public.challenge_participants(dc_block_reason) where dc_block_reason is not null;
create index if not exists rewards_marketplace_scope_idx on public.rewards(marketplace_scope, organization_id, status);
create index if not exists partner_point_configs_enabled_idx on public.partner_point_configs(organization_id, enabled);

-- Helpful invariant: redemptions payment currency must match reward scope (guard function already enforces).

create or replace function public.get_dadofit_schema_version()
returns text language sql stable as $$ select 'v15.7.20-eco4g-compatibility-qa'::text; $$;
