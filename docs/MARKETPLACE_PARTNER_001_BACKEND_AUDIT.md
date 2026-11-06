# MARKETPLACE-PARTNER-001 Backend Audit

Scope: T01-T10 and T15. Evidence is generated before the new write guards are installed by
`20261016120000_marketplace_partner_001_backend.sql`.

## Static findings remediated

| Finding | Previous surface | Remediation |
|---|---|---|
| Full reward rows exposed | `SELECT rewards`, `get_dadofit_marketplace`, `get_partner_marketplace` | Direct grant revoked; RPCs replaced by allowlisted JSON DTOs |
| Fulfillment secrets copied to audit JSON | `reward_offer_events.before_data/after_data` | Secret keys removed; direct client read revoked |
| Lookup existence oracle | `provider_lookup_reward_redemption` | Authorization moved into the query predicate; unauthorized/not-found both return null |
| Owner/Admin controlled `enabled` | legacy `upsert_partner_point_config(..., p_enabled, ...)` | EXECUTE revoked; presentation and SuperAdmin governance split |
| Missing config enabled economy | config fallback and auto assumptions | Every new contract uses `coalesce(enabled,false)` |
| Legacy auto-config enabled economies | `eco4h_seed_partner_point_config` and untouched generated defaults | Trigger replaced with disabled supported types; only exact unattributed defaults are marked `AUTO_SEEDED` and disabled; explicit/ambiguous legacy rows are preserved |
| Open Partner type fallback | legacy `CASE ... ELSE sp` paths | New contracts accept only `gym`, `brand`, `company` |
| Cross-org privileged writes | incomplete redemption guard | row checks plus reward/organization trigger guard |
| Legacy analytics amount | `coin_cost` in reward analytics | consumption uses `payment_currency`, `payment_amount`, and organization snapshot |
| Destructive audit cleanup | top-level key deletion including full `metadata` | recursive value redaction preserves JSON structure and non-secret metadata |

## Reproducible runtime evidence

Run after applying migrations:

```sql
select *
from public.marketplace_partner_integrity_audit
where migration_version = 'MARKETPLACE-PARTNER-001'
order by check_name;
```

The table records counts and up to 20 IDs for scope/organization, DadoFit/native price, Partner
type/currency, payment shape, reward/payment mismatch, physical wallet type and nested historical
secret findings. It is intentionally unavailable to API roles. Historical violations are
not rewritten without unequivocal evidence. New writes are blocked immediately by `NOT VALID`
constraints and triggers; constraints are validated automatically only when the corresponding audit
count is zero.

## Legacy compatibility retained

- Physical `gym_point_wallets`/`gym_point_ledger` and `sponsor_point_wallets`/`sponsor_point_ledger` remain unchanged.
- Existing redemption fulfillment fields and historical rows remain intact.
- `provider_list_rewards` remains the privileged management contract.
- `coin_cost` remains stored as historical/legacy offer information, but is not a consumption KPI.
- No refund, conversion, mixed payment, new wallet, synthetic organization or production fixture was introduced.

## Verification

```bash
npx supabase db reset
npx supabase test db supabase/tests/marketplace_partner_001.sql
npx supabase db lint --level warning
```

The pgTAP suite creates isolated Auth users, Owner/Member/outsider/SuperAdmin actors, organizations,
memberships, wallets and rewards. It executes discovery, catalog, governance, cross-org rejection,
canonical analytics, redemption rollback, fulfillment authorization, recursive redaction and direct
grant/SELECT denial, including calls under the real `authenticated` database role. Concurrency
serialization is enforced by the locked reward row and `FOR UPDATE SKIP LOCKED` coupon selection;
multi-session load remains an integration environment concern.
