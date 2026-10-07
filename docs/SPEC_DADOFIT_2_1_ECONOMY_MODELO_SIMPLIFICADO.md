# DadoFit 2.1 — Economy Migration SPEC

Documento de especificación técnica y funcional para la migración económica de DadoFit a **DadoFit 2.1**. No incluye implementación; es la base para planificar milestones.

Base validada contra: `AGENT_DadoFit_2_1.md`, `docs/DADOFIT_2_1_ECONOMY_AUDIT.md`, migraciones en `supabase/migrations/`, RPCs ECO-1/2/3 y frontend en `src/`.

---

## 1. Executive Summary

DadoFit 2.1 formaliza su economía como:

```text
XP            → progreso personal, no gastable (user_progress)
DC            → moneda universal, única, emitida y gobernada por DadoFit (wallets)
Partner Points → moneda propia de cada organización (gym/sponsor wallets por organization_id)
Competitive Score → histórico de rankings, nunca se gasta (score_events)
```

El código real ya implementa gran parte de este modelo en ECO-1 (SP wallets), ECO-2 (GP wallets + trigger de score_events) y ECO-3 (rewards multi-moneda con un solo payment_method). 2.1 **no reconstruye** estas capas: las **abstrae** bajo un dominio `Partner Points`, añade **gobierno de emisión de DC** con un `DC Budget` por campaña/partner, separa explícitamente saldo gastable vs score competitivo, y divide el Marketplace en DadoFit (DC) vs Partner (puntos nativos).

---

## 2. Current State Baseline

Estado verificado contra el repositorio (mapeo completo en `docs/DADOFIT_2_1_ECONOMY_AUDIT.md`):

- **DC**: `wallets.balance` + `wallet_transactions` (ledger idempotente, `grant_wallet_coins`, spend vía `redeem_reward`).
- **XP**: `user_progress` + `progress_transactions`, otorgado vía `grant_user_xp`. No gastable.
- **GP**: `gym_point_wallets` (PK user+gym_org) + `gym_point_ledger`; acreditado por trigger `credit_gym_wallet_from_score_event_eco2`.
- **SP**: `sponsor_point_wallets` (PK user+brand_org) + `sponsor_point_ledger`; acreditado vía `grant_sponsor_points` en retos patrocinados.
- **Score histórico**: `score_events` (`team_points`, `sponsor_points` legacy=GP, `gym_points`), `group_scores`, `organization_scores`, `seasons`. Nunca se debita.
- **Legacy crítico**: `challenges.sponsor_points` y `score_events.sponsor_points` son compatibilidad de GP, **no** SP real.
- **Rewards**: `rewards` tiene `organization_id`, `coin_cost` (DC), `native_currency` ('gp'|'sp'), `native_cost`, inventory, fulfillment QR/code pools/etc. `redeem_reward(p_payment_method 'dc'|'gp'|'sp')` — pago único.
- **Organizations**: modelo único con `organization_type` ('gym'|'brand'|'sponsor'|'company'|'other'), `verification_status`, `organization_members` RBAC.
- **Anti-farming**: cooldowns 24h por par, daily limits, idempotency keys, advisory locks, caps por RPC.

---

## 3. Target Product Model

### Contrato canónico de producto

```text
XP                → progreso; no gastable
DadoCoins         → única moneda universal de DadoFit
Partner Points    → único sistema de puntos gastables por organization_id
Competitive Score → ranking/temporadas; no gastable
```

**GP, SP y TP no forman parte de la taxonomía económica visible de DadoFit 2.1.** Pueden seguir existiendo como nombres de tablas, columnas, parámetros o códigos legacy hasta completar la capa de compatibilidad.

```text
DADOFIT
  XP → progreso (no gastable)
  DC → moneda universal, una sola por usuario, solo Marketplace DadoFit
  Competitive Score → rankings/temporadas; no gastable

PARTNER (cada organization_id)
  Partner Points → único sistema de puntos gastables del Partner
  Marketplace propio → acepta solo los Partner Points de esa organization_id

LEGACY / IMPLEMENTATION ONLY
  TP / GP / SP → identificadores técnicos existentes; no son monedas visibles del producto
```

Reglas de soberanía:

- Un Partner **no** emite DC. Solo DadoFit puede autorizar emisión vía DC Budget.
- Un Partner emite y gasta sus Partner Points libremente (dentro de RLS/anti-farming).
- Partner Points **no** son transferibles, **no** convertibles a DC, y **no** valen en otra organización.
- TP/GP/SP pueden permanecer como identificadores técnicos legacy, pero no se presentan como economías del producto. El usuario ve `Competitive Score` o el nombre configurado de sus `Partner Points`.

---

## 4. Domain Definitions

| Concepto | Definición | Fuente de verdad hoy |
|---|---|---|
| XP | Progreso personal, nivel, racha | `user_progress.xp` |
| DC | Saldo universal DadoFit | `wallets.balance` |
| DC Budget | Cupo autorizado de DC para una campaña/convenio | **nueva tabla** |
| Partner Points | Moneda propia de una organización | `gym_point_wallets` / `sponsor_point_wallets` |
| Competitive Score | Acumulado histórico por usuario/org/group/season | `score_events`, `organization_scores`, `group_scores` |
| Spendable Balance | Puntos gastables del usuario en una organización | wallets por organización |
| Lifetime Earned/Spent | Acumulado neto gastado/ganado | `*_wallets.lifetime_*` |

---

## 5. Invariants

1. Una redención usa **exactamente una** moneda (`payment_method ∈ {dc, gp, sp}` → mapeado a partner).
2. `wallets.balance >= 0` siempre; `gym/sponsor_point_wallets.balance >= 0` siempre.
3. `competitive_score` nunca disminuye al gastar.
4. Todo otorgamiento de DC, interno o de convenio, debe consumir un DC Budget activo y con saldo.
5. Partner Points nunca se emiten a orgs no verificadas ni a orgs sin economía habilitada.
6. Idempotency_key única en cada ledger/mint/spend/budget consume.
7. `score_events.sponsor_points` nunca se reinterpreta como SP/Partner Points de Brand.
8. Los identificadores legacy TP/GP/SP no se exponen como monedas nuevas; el producto usa únicamente Partner Points para saldos de organización y Competitive Score para rankings.
9. Frontend nunca puede setear saldos directos; solo RPCs service_role/security definer.

---

## 6. Existing Architecture to Reuse

KEEP intactos:

- Enforcement anti-farming actual (cooldowns, daily limits, advisory locks).
- RPCs internas `grant_wallet_coins`, `grant_user_xp`, `grant_gym_points`, `grant_sponsor_points`, `spend_gym_points_internal`, `spend_sponsor_points_internal`, `redeem_reward`, provider `_reward` RPCs.
- Trigger `credit_gym_wallet_from_score_event_eco2` (patrón de acreditación desacoplada).
- Tablas `wallets`, `wallet_transactions`, `gym_point_wallets`, `gym_point_ledger`, `sponsor_point_wallets`, `sponsor_point_ledger`, `score_events`, `rewards`, `reward_redemptions`.
- Formato de fulfillment QR/code pools/analytics.

WRAP/EXTEND:

- `redeem_reward` → añadir validación/filtrado por marketplace scope (`dc` → solo offers DadoFit; `gp`/`sp` → solo offers Partner de la org correspondiente).
- `get_reward_marketplace` → añadir parámetro/filtro `marketplace_scope` o dos RPCs (ver §12).
- RPCs de otorgamiento de DC desde retos (`review_direct_challenge`, `review_organization_challenge`, `complete_sponsored_approval_v133`) → añadir consumo de DC Budget antes de `grant_wallet_coins`.
- `provider_create_reward/update_reward` → exigir que reward DC solo lo cree DadoFit/SuperAdmin; partner reward exige `native_cost` en sus puntos.

DEPRECATE LATER:

- Lectura del ranking desde `score_events.sponsor_points` (forzar `gym_points`).
- Presentación de "sponsor_points" en nuevas superficies (migrar a `<Org> Points`).

---

## 7. Target Database Model

### Nuevas tablas

**`partner_point_configs`** (recomendado sobre columnas en `organizations`):

```text
id uuid PK
organization_id uuid UNIQUE FK → organizations
points_name text NOT NULL            -- "Titanes Points"
points_short_name text NOT NULL      -- "TTP"
points_icon text                     -- emoji/slug
points_color text                    -- hex
enabled boolean default true
competitive_score_name text          -- opcional, default "Competitive Score"
created_at, updated_at, updated_by
```

Justificación: mantiene `organizations` normalizada, permite editar branding sin tocar membresías/verificación, y facilita migración futura de wallets a "partner_point_wallets" unificadas.

**`dc_budgets`**:

```text
id uuid PK
organization_id uuid FK → organizations NULL           -- NULL si presupuesto interno DadoFit
sponsor_campaign_id uuid FK → sponsor_campaigns NULL   -- vínculo opcional
season_id uuid FK → seasons NULL                      -- competencias
is_dadofit_internal boolean default false
budget_dc bigint NOT NULL CHECK >= 0
used_dc bigint NOT NULL DEFAULT 0 CHECK >= 0
remaining_dc bigint GENERATED ALWAYS AS (budget_dc - used_dc) STORED
status text CHECK IN ('draft','active','paused','exhausted','expired','cancelled')
starts_at timestamptz
ends_at timestamptz
approved_by uuid FK → profiles NULL                   -- SuperAdmin que autoriza
approved_at timestamptz NULL
created_by uuid FK → profiles
created_at, updated_at
```

**`dc_budget_transactions`**:

```text
id uuid PK
dc_budget_id uuid FK → dc_budgets
user_id uuid FK → profiles NULL
challenge_id uuid FK → challenges NULL
participant_id uuid FK → challenge_participants NULL
direction text CHECK IN ('grant','reversal','adjustment')
amount bigint NOT NULL CHECK > 0
balance_after bigint NOT NULL
reason text                                           -- 'reward_payout'|'budget_exhausted'|'reversal'|...
external_source text                                  -- tipo/origen
external_id uuid NULL
idempotency_key text UNIQUE NOT NULL
created_at, created_by
```

### Columnas nuevas (aditivas)

- `challenges.dc_budget_id uuid FK → dc_budgets NULL` — todo reto con `reward_coins > 0` patrocinado por partner debe referenciarlo.
- `challenge_participants.dc_block_reason text` — distinguir `pair_cooldown`/`daily_limit` de `dc_budget_exhausted`.
- `organizations`: ninguna; config va a `partner_point_configs`.
- `seasons`: ninguna obligatoria; `sponsor_organization_id` ya existe.

### Mapeo de wallets existentes (KEEP)

```text
organization_type = 'gym'           → gym_point_wallets       (Partner Points del gym)
organization_type IN ('brand','sponsor','company','other')
                                   → sponsor_point_wallets    (Partner Points del partner)
```

No hay migración masiva; se mantiene la FK por `organization_id` y se presenta como "Partner Points".

---

## 8. Partner Points Architecture

- Identidad de wallet = `(user_id, organization_id)`. Se mantiene en las tablas actuales según tipo de org.
- Config visual y económica vive en `partner_point_configs`. Wallet identity NO cambia al renombrar `points_name`.
- Otorgamiento: reusar `grant_gym_points`/`grant_sponsor_points` según `organization_type`. Wrapper futuro: `grant_partner_points(p_user, p_org, ...)` que delega al grantor existente según tipo.
- Gasto: reusar `spend_gym_points_internal`/`spend_sponsor_points_internal` vía `redeem_reward` (ya aisla por org y membresía activa en GP; SP es is_brand_organization).
- Score: `score_events` y agregados permanecen; el trigger ECO-2 ya alimenta `gym_point_wallets` desde score sin restar ranking.

---

## 9. DadoCoins Budget Architecture

Toda emisión de DC, tanto interna de DadoFit como proveniente de convenio/campaign, debe pasar por `dc_budgets`. No existe payout válido de DC sin presupuesto en el estado final de DadoFit 2.1.

Flujo:

1. SuperAdmin crea y **aprueba** un `dc_budgets` row (`budget_dc`, `used_dc=0`, `status='active'`, ventanas, org/season/campaign).
2. Challenge con `reward_coins > 0` y `dc_budget_id` apunta al budget.
3. Al aprobarse la evidencia, la RPC de reto primero aplica anti-farming, luego intenta consumir DC del budget de forma atómica (ver §14).
4. Si `remaining_dc >= reward_dc`: `used_dc += reward_dc`, grant DC, `dc_budget_transactions(direction='grant')`, `wallet_transactions` con su idempotency.
5. Si `remaining_dc < reward_dc`: **no** otorgar DC; grant XP y Partner Points igualmente si corresponden; registrar `dc_block_reason='dc_budget_exhausted'`. **No** insertar una fila de monto cero en `dc_budget_transactions`, porque el ledger financiero registra únicamente movimientos que cambian el presupuesto. El bloqueo queda trazado en el participante y, si se requiere auditoría adicional, en el audit log existente.
6. Al expirar ventanas o cancelarse campaña: `status` pasa a `expired/cancelled`; payouts futuros bloqueados pero XP/Partner Points continúan según campaña.

Presupuesto interno DadoFit: `is_dadofit_internal=true`, `organization_id` NULL, `budget_dc` fijado por ops; se consume igual que uno de partner.

---

## 10. DC Budget Ledger

`dc_budget_transactions` registra:

- grants exitosos de DC con `amount` y `balance_after`;
- reversals si un payout certificadamente falla (no implementado en 2.1 salvo ajuste manual);
- adjustments manuales por SuperAdmin con `idempotency_key` externa;
- **no** registra bloqueos con monto cero; los bloqueos por agotamiento se registran en `challenge_participants.dc_block_reason` y/o audit log.

Todo payout real de DC debe tener su par `wallet_transactions` y su `dc_budget_transactions` con la misma `external_id = challenge_participant.id` e idempotency comparable.

---

## 11. Challenge Reward Architecture

| Challenge | XP | DC | Competitive Score | Partner Points | DC Budget requerido |
|---|---:|---:|---:|---:|---|
| 1v1 (`direct`) | hasta 50 | hasta 25 | — | — | **Sí**. Usa un DC Budget interno de DadoFit; ningún `reward_coins > 0` puede pagarse sin budget válido. |
| Squad (`group`) | — | — | Squad Competitive Score (`team_points` legacy) | — | No |
| Organization / Gym | 0–50 | 0–25 | Gym Competitive Score (`gym_points` legacy) | Partner Points del Gym | Sí si DC>0 |
| Gym vs Gym | 0–50 | 0–25 | Gym Competitive Score | Partner Points del Gym si aplica | Sí si DC>0 |
| Sponsored (Brand) | 0–100 | 0–50 | — | Partner Points de la Brand (`sponsor_*` legacy) | Sí si DC>0 |
| Sponsored Gym Competition | vía campaign | vía campaign | Gym Competitive Score por ventana propia | Partner Points del Partner si aplica | Sí si DC>0 |

Regla de Partner challenge normal:

```text
challenge.organization sin convenio DadoFit:
  reward_coins debe ser 0 (o forzado a 0 si no hay dc_budget_id válido)
  reward_xp + Partner Points permitidos
```

Regla de convenio:

```text
challenge.dc_budget_id válido + campaign activa:
  puede configurar DC
```

---

## 12. Marketplace Architecture

Decisión: **inferencia + columna aditiva mínima**.

Añadir a `rewards`:

```text
marketplace_scope text NOT NULL DEFAULT 'partner'
  CHECK (marketplace_scope IN ('dadofit','partner'))
```

Reglas:

- `marketplace_scope='dadofit'` → `payment_currency` debe ser `'dc'`, `organization_id` puede ser NULL o DadoFit HQ, `native_cost` NULL. Solo SuperAdmin/DadoFit crea.
- `marketplace_scope='partner'` → `organization_id` obligatorio, `payment_currency` debe ser nativa (`'gp'` si gym, `'sp'` si brand/sponsor), `native_cost` obligatorio, `coin_cost` puede mantenerse para degradación compatible pero no principal.

Justificación: el modelo `rewards.organization_id` + `native_cost` ya separa ownership; el flag evita ambigüedad cuando un reward DC es cross-promocional y permite filtrar UI sin reescribir tablas.

RPCs:

- `get_dadofit_marketplace()` → filtra `marketplace_scope='dadofit'`.
- `get_partner_marketplace(p_organization_id)` → filtra `organization_id + marketplace_scope='partner'`.
- `get_reward_marketplace()` se mantiene como fallback (DEPRECATE LATER).

---

## 13. Reward Redemption Rules

Invariantes conservadas:

- 1 redemption = 1 `payment_currency`.
- DC solo con `marketplace_scope='dadofit'` rewards.
- Partner Marketplace solo acepta los Partner Points de su misma `organization_id`. Internamente ECO-3 puede resolverlos mediante `gp`/`sp` legacy según `organization_type`, pero esos códigos no son conceptos visibles de producto.
- Stock, max_per_user, ventana, org verificada, coupon pool semantics intactos.
- `payment_organization_id` en `reward_redemptions` siempre igual al `organization_id` del wallet cobrado.
- QR/fulfillment/events/analytics reutilizan la columna `payment_currency`.

---

## 14. Score vs Spendable Balance

| Dato | Fuente | Cambia al gastar |
|---|---|---|
| Spendable Balance | `wallets.balance` / `gym_point_wallets.balance` / `sponsor_point_wallets.balance` | Sí |
| Lifetime Earned | `*_wallets.lifetime_earned` | Solo al ganar |
| Lifetime Spent | `*_wallets.lifetime_spent` | Solo al gastar |
| Competitive Score | `score_events` agregados (`team_points`, `gym_points`, legacy `sponsor_points`=GP) | **No** |
| XP | `user_progress.xp` | No aplica (no gastable) |

Postcondición obligatoria de todo spend: el rank/season total del usuario **no disminuye**.

---

## 15. Partner Economy Configuration

Partner (Owner/Admin) puede configurar en `partner_point_configs`:

- `points_name` (visible)
- `points_short_name`
- `points_icon`, `points_color`
- `enabled` (soft off; no borra wallets)

DadoFit/SuperAdmin controla:

- caps de otorgamiento por challenge type;
- DC budgets;
- verificación de org;
- `organization_type`;
- activar/bloquear economía de una org abusiva.

Restricción de naming: `points_short_name` no puede colisionar con identificadores reservados de plataforma o legacy (`DC`, `XP`, `TP`, `GP`, `SP`). Los valores GP/SP creados automáticamente por backfill legacy pueden mantenerse temporalmente, pero nuevas personalizaciones no deben reforzar esa taxonomía.

---

## 16. Roles / Permissions / RLS

- Leer propio wallet: usuario autenticado sobre sus filas (wallets/gym/sponsor wallets) ya existe; mantener.
- Configurar `partner_point_configs`: org owner/admin o platform admin.
- Crear rewards Partner: `can_manage_rewards_for_org` (owner/admin/platform admin) existente.
- Crear rewards DadoFit (`marketplace_scope='dadofit'`): solo SuperAdmin.
- Crear/aprobar `dc_budgets`: SuperAdmin (`require_platform_admin()`).
- Leer `dc_budgets`: org admin del partner asignado + SuperAdmin.
- Consumir budget y emitir DC: RPCs internas service_role/security definer; nunca frontend directo.
- Emitir/grant Partner Points: RPCs internas existentes; sponsor/gym grants service_role only.
- Spend Partner Points: solo vía `redeem_reward`.

---

## 17. SuperAdmin Governance

MUST:

- CRUD `dc_budgets` (crear, aprobar, pausar, cancelar).
- Ver `used_dc`/`remaining_dc`/utilización por campaña/partner.
- Aprobar conversiones de org a economy activa (`partner_point_configs.enabled`).
- Bloquear rewards DadoFit.

SHOULD:

- Dashboard de circulación DC (`admin_reward_analytics` existente) extendido con budgets.
- Partner Points issued/spent por organization_id.

LATER:

- Ajustes manuales con motivo obligatorio y audit row.

---

## 18. Analytics

Mantener reportes actuales:

- `provider_reward_analytics`: `dc_consumed`, `gp_consumed`, `sp_consumed`, trend diario, low stock.
- `admin_reward_analytics`: `dc_issued`, `dc_circulation`, `dc_consumed`.

Evolución:

- Añadir agregado `partner_points_consumed_by_organization` manteniendo columnas legacy para no romper UI hasta 2.1 frontend.
- `dc_budget_transactions` alimenta `budget utilization` report.

---

## 19. Notifications

Alcance:

- Mensajes legacy "Ganaste X GP/SP" → parametrizar por `partner_point_configs.points_name`; la UI final nunca debe presentar GP/SP como monedas distintas.
- Mensajes de convenio agotado → añadir `DC budget exhausted` cuando `dc_block_reason='dc_budget_exhausted'`.
- Templates en RPCs (`complete_sponsored_approval_v133`, `review_organization_challenge`, etc.) actualizadas en ECO-4C.

No cambiar rutas ni tablas de notificaciones.

---

## 20. Frontend Impact

Componentes reutilizados:

- `RewardsMarketplacePage.tsx`: refactor a tabs **DadoFit / Mis comunidades**, conservando `redeem_reward` y chips de wallet.
- `ProfilePage.tsx` / `SocialSummaryBar.tsx`: mostrar `XP | DadoCoins` y lista de Partner Points con labels dinámicos.
- `SeasonHubPage.tsx` / `SquadsPage.tsx`: mostrar `Competitive Score`/puntos de temporada; `TP` queda como nombre técnico interno, no como economía visible.
- `RewardManagementPage.tsx`: `create/update_reward` añade `marketplace_scope`; partner flow fuerza `native_cost`.
- `BrandCampaignsPage.tsx` / `BrandCompetitionsPage.tsx`: mostrar `dc_budget_id`, `remaining_dc`, bloqueo de DC sin budget.
- `OrganizationChallengeButton.tsx` / `SquadChallengeButton.tsx` / `SponsorChallenges`: labels dinámicos.
- `AdminPage.tsx`: sección DC Budgets + Partner Points analytics.
- `LegalPage.tsx` / `SiteFooter.tsx`: copy ya aclara DC no es dinero; actualizar con Partner Points no transferible.

---

## 21. Backward Compatibility

- `get_reward_marketplace()` sigue devolviendo shape actual durante 2 releases.
- `redeem_reward` acepta `p_payment_method` antiguo; sin `marketplace_scope` en rewards antiguas, `coin_cost>0` se interpreta DadoFit solo si `native_cost` NULL, en caso contrario partner.
- `challenges.sponsor_points`/`score_events.sponsor_points` permanecen como espejo GP.
- Saldos actuales en `wallets/gym/sponsor` se conservan sin migración.
- RPCs grant/spend internas no cambian firmas.

---

## 22. Migration Strategy

Aditiva y reversible por milestone:

1. Nuevas tablas `partner_point_configs`, `dc_budgets`, `dc_budget_transactions`.
2. `ALTER TABLE rewards ADD marketplace_scope ...` con default por inferencia.
3. `ALTER TABLE challenges ADD dc_budget_id ...` nullable.
4. `ALTER TABLE challenge_participants ADD dc_block_reason ...` nullable.
5. Backfill: `rewards.marketplace_scope='dadofit'` donde `native_cost IS NULL AND native_currency IS NULL`; resto `'partner'`.
6. Backfill: `partner_point_configs` conserva defaults legacy por compatibilidad (gym→"Gym Points"/GP, brand/sponsor→"Sponsor Points"/SP), pero estos defaults no definen la taxonomía final de producto. ECO-4E debe mostrar el nombre configurable del Partner y retirar GP/SP como categorías visibles.
7. Nuevas RPCs `get_dadofit_marketplace`, `get_partner_marketplace`, `superadmin_*_dc_budgets`, enforcement en reviews.
8. Frontend conmutación gradual por flags de rollout.

No DROP, no rename destructivo, no migración masiva de wallets.

---

## 23. Rollout Strategy

Feature flags opcionales (solo si reducen riesgo; defaults OFF):

```text
partner_points_ui_enabled        -- labels dinámicos en headers/profile
dc_budget_enforced               -- si OFF, budgets existen pero no bloquean
partner_marketplace_split        -- si OFF, marketplace sigue unificado filtrando
```

Orden: DB aditiva → RPCs internas → flags OFF → QA negativo → pricing OFF enforcement → UI split → enforcement ON en staging → producción incremental.

---

## 24. Risks and Mitigations

- **Confusión sponsor_points legacy**: Mitigación §5 invariante; forzar lecturas de GP ranking via `gym_points`.
- **Overspend concurrente de budget**: Mitigación §14 atomic UPDATE + FOR UPDATE; tests de dos payouts simultáneos.
- **Rewards antiguas con native_cost NULL**: Mitigación inferencia de marketplace_scope + bloqueo de publicación sin native price (ECO-3 ya lo exige).
- **Rewinding de ranking al gastar**: test de aceptación obligatorio "spend does not reduce competitive_score".
- **RLS de dc_budgets**: solo service_role consume; org admin solo lee; tests de permisos.
- **Confusión de identificadores legacy TP/GP/SP con economía visible**: naming guard + UI basada en `points_name`; los códigos legacy quedan solo en persistencia/compatibilidad.
- **Frontend hardcoded labels**: audit de strings + tests de render.

---

## 25. Acceptance Criteria

DC Budget:

- GIVEN `remaining_dc=25` AND dos approvals concurrentes de `reward_coins=25` THEN exactly one `dc_budget_transactions(direction='grant')` row with amount 25 y `budget_dc-used_dc=0`; el otro participante recibe `+0 DC`, `dc_block_reason='dc_budget_exhausted'`, y conserva XP/Partner Points otorgados.
- GIVEN `remaining_dc=0` AND challenge con `reward_coins=25` THEN approvals no emiten DC; `challenge_participants.rewarded_at` se mantiene para XP/Partner; wallet_transactions no contiene DC.
- GIVEN cualquier challenge con `reward_coins>0` AND no existe DC Budget válido THEN se otorgan `0 DC`, se registra razón explícita de bloqueo y no se crea `wallet_transactions` de DC; XP/Partner Points elegibles continúan según sus propias reglas.
- GIVEN idempotency_key duplicada THEN no se duplica `dc_budget_transactions` ni `wallet_transactions`.

Partner Points:

- GIVEN org gym con membresía active THEN `redeem_reward(payment_method='gp')` descuenta `gym_point_wallets.balance` y deja `score_events.gym_points` intacto.
- GIVEN org brand y reward con `native_currency='sp'` THEN `payment_method='sp'` descuenta `sponsor_point_wallets.balance`; `payment_method='gp'` falla.
- GIVEN member sin membresía active THEN spend GP falla; spend SP en su marca funciona según reglas.

Marketplace:

- GIVEN `marketplace_scope='dadofit'` reward THEN solo `payment_method='dc'` posible.
- GIVEN `marketplace_scope='partner'` reward THEN solo su `native_currency` posible; mezcla DC+SP/GP rechazada por CHECK/RPC.
- GIVEN pago con moneda incorrecta THEN transacción hace rollback y no emite fulfillment.

Score:

- GIVEN usuario con `competitive_score=1840` y spend de 500 Partner Points THEN `organization_scores`/`score_events` sums para ese usuario no disminuyen.

RLS:

- GIVEN org member role=member THEN no puede crear `partner_point_configs`; owner/admin sí.
- GIVEN authenticated THEN no puede insertar en `dc_budget_transactions`; solo RPC service_role.

Compat:

- GIVEN saldos existentes pre-migración THEN `wallets.balance`, `gym_point_wallets.balance`, `sponsor_point_wallets.balance` iguales post-migración.
- GIVEN `get_reward_marketplace()` llamado por cliente antiguo THEN shape actual conservado.

---

## 26. Test Matrix

DC:
- grant normal, anti-farming block, budget exhausted, exact remainder, dos concurrentes, idempotent retry, reversal manual (audit).

Partner Points:
- gym earns via score_event trigger, brand earns via sponsored approval, spend ok, insufficient balance, wrong org, inactive membership, idempotency.

Marketplace:
- DC reward with DC, Partner reward with Partner Points, wrong currency, mixed payment impossible, stock, limit/user, QR, coupon pool.

Score:
- spending Partner Points does not reduce ranking.

Permissions:
- Member/Coach/Owner/Admin/SuperAdmin: create config, create reward, create budget, consume budget, fulfill.

---

## 27. Out of Scope

```text
P2P transfers
cash-out
crypto
Partner Points → DC
DC → Partner Points
pago mixto
multi-partner wallet (multi-sede unificada)
marketplace abierto entre partners
expiración automática de puntos
conversión fiat automática
billing automático
DROP/rename destructivo de wallets
```

---

## 28. Implementation Milestones

Nota: nombres siguen ECO-4* porque ECO-3 ya cerró multi-moneda básica.

### ECO-4A — Partner Economy Foundation ✅ IMPLEMENTADO

Objetivo: formalizar Partner Points y config sin tocar wallets.

- BD: `partner_point_configs` + backfill por org; `organizations` sin cambios.
- RPC/backend: `get_partner_point_config`, `upsert_partner_point_config` (RBAC); wrapper `get_partner_wallets_for_user` (opcional, delega).
- Frontend: ninguno obligatorio (labels pueden esperar a ECO-4E).
- Compatibilidad: wallets y ledgers intactos.
- Tests: config CRUD, defaults por type, naming guard (no "DC"/"TP").
- DoD: org puede guardar nombre/icono/color y leerlos en 2 requests; no cambia ningún balance.

### ECO-4B — DC Budget Governance

Objetivo: introducir budgets y ledger de emisión.

- BD: `dc_budgets`, `dc_budget_transactions`, FKs nullables en challenges; RLS app-managed por RPCs.
- RPC/backend: `superadmin_create_dc_budget`, `_approve`, `_pause`, `_cancel`, `_get`; `consume_dc_budget_internal`.
- Frontend: AdminPage tabla de budgets (read-only o CRUD según scope).
- Compatibilidad/transición: durante ECO-4B el enforcement puede permanecer OFF únicamente para no romper el sistema antes de ECO-4C. Esto es un estado técnico transitorio, **no** una regla válida del modelo 2.1 final. Antes de declarar 2.1 completado, todo payout DC debe requerir budget.
- Tests: crear/aprobar, estados, RLS, idempotencia de consume, dos concurrentes.
- DoD: se puede aprobar un budget activo y registrar grants auditables sin emitir DC todavía.

### ECO-4C — Challenge Reward Enforcement

Objetivo: que reviews de retos consuman budget antes de emitir DC.

- BD: `challenge_participants.dc_block_reason`; backfill NULL.
- RPC/backend: modificar (aditivamente) `review_direct_challenge`, `review_organization_challenge`, `complete_sponsored_approval_v133` para: anti-farming → budget check → grant DC/XP/Partner Points → ledger rows.
- Frontend: mostrar `dc_block_reason='dc_budget_exhausted'` en participant rewards UI.
- Compatibilidad: para retos internos de DadoFit, la RPC debe resolver/asociar un **DC Budget interno activo**. Para retos de Partner, `dc_budget_id` válido es obligatorio cuando `reward_coins > 0`. Una vez activado el enforcement ECO-4C, si no existe budget válido se otorgan `0 DC` con razón explícita y se preservan XP/Partner Points elegibles.
- Tests: aprobado con budget, budget agotado, anti-farming vs budget exhausted distintos, idempotente.
- DoD: payout de DC exitoso y bloqueado ambos auditables; XP/Partner Points inalterados.

### ECO-4D — Marketplace Split

Objetivo: separar getters y reforzar reglas de pago.

- BD: `rewards.marketplace_scope` + backfill.
- RPC/backend: `get_dadofit_marketplace`, `get_partner_marketplace`, ajustar `provider_create/update_reward` para exigir scope coherente; `get_reward_marketplace` deprecated wrapper.
- Frontend: `RewardsMarketplacePage` tabs DadoFit/Mis comunidades; `RewardManagementPage` select marketplace_scope.
- Compatibilidad: RPC viejo sigue; reward sin scope se infiere por native_cost/native_currency.
- Tests: filtro por scope, rejection wrong currency, mixed payment impossible.
- DoD: dos listados independientes; legacy endpoint responde igual que antes.

### ECO-4E — Frontend Economy UX

Objetivo: UI de "Mi economía" con DC + lista de Partner Points.

- Frontend: `ProfilePage`, `SocialSummaryBar`, `SeasonHubPage`, `SquadsPage` labels dinámicos desde `partner_point_configs`; notifications con "Ganaste 100 <Org> Points".
- Compatibilidad: una org sin branding personalizado puede usar temporalmente defaults legacy de config, pero la UI debe tratar esos saldos como Partner Points de esa organización, no como monedas GP/SP globales.
- Tests: render dinámico, empty community state, org renamed points no migra wallet.
- DoD: usuario ve "Titanes Points", "Nike Points" según config sin tocar SQL.

### ECO-4F — Admin Analytics / Governance

Objetivo: visibilidad operativa de presupuestos y Partner Points.

- BD: views/aggregates sobre `dc_budget_transactions` y wallets por org.
- RPC/backend: `admin_dc_budget_summary`, `admin_partner_points_summary`.
- Frontend: `AdminPage` paneles DC budgets + Partner Points consumed por org.
- Compatibilidad: endpoints admin existentes intactos.
- Tests: agregados correctos, permisos SuperAdmin.
- DoD: SuperAdmin puede auditar issued/consumed/remaining por campaña y org.

### ECO-4G — Compatibility + Final QA

Objetivo: endurecer reglas, deprecation LATER y regression.

- BD: CHECK constraints finales, índices por `marketplace_scope`/`organization_id`/`dc_budget_id`.
- RPC/backend: `redeem_reward` strict scope validation; deprecation notices en RPCs viejas.
- Frontend: eliminar paths viejos solo tras telemetry 0.
- Compatibilidad: confirmada por test matrix; legacy sponsor_points sigue siendo GP mirror.
- Tests: full Test Matrix §26 en staging, performance de getters marketplace, anti-farming suite.
- DoD: todas las AC §25 pasan; AGENT_DadoFit_2_1.md actualizado.

---

## 29. Exact Files Expected to Change

| File | Change |
|---|---|
| `supabase/migrations/<ts>_eco4a_partner_point_configs.sql` | ADD table + RLS + backfill |
| `supabase/migrations/<ts>_eco4b_dc_budgets.sql` | ADD dc_budgets + dc_budget_transactions |
| `supabase/migrations/<ts>_eco4c_challenge_dc_budget.sql` | ADD challenge.dc_budget_id, participant.dc_block_reason, review RPCs |
| `supabase/migrations/<ts>_eco4d_marketplace_scope.sql` | ADD rewards.marketplace_scope + getters |
| `supabase/migrations/<ts>_eco4g_constraints_indexes.sql` | ADD CHECKs/indexes/dep consts |
| `src/pages/RewardsMarketplacePage.tsx` | MODIFY tabs/marketplace split |
| `src/pages/RewardManagementPage.tsx` | MODIFY scope selector + native_cost enforcement UX |
| `src/pages/ProfilePage.tsx` | MODIFY economy widget |
| `src/components/SocialSummaryBar.tsx` | MODIFY labels dinámicos |
| `src/pages/SeasonHubPage.tsx` | MODIFY para mostrar Competitive Score y retirar taxonomía visible TP/GP |
| `src/pages/SquadsPage.tsx` | MODIFY copy: score competitivo, no moneda TP |
| `src/pages/BrandCampaignsPage.tsx` | MODIFY dc_budget display/enforce |
| `src/pages/BrandCompetitionsPage.tsx` | MODIFY dc_budget display |
| `src/pages/OrganizationChallengesPage.tsx` | MODIFY dc_block_reason display |
| `src/pages/GymBattlesPage.tsx` | MODIFY labels |
| `src/pages/SponsoredChallengesPage.tsx` | MODIFY dc_block_reason + labels |
| `src/pages/AdminPage.tsx` | MODIFY budgets + partner points panels |
| `src/pages/RewardValidationPage.tsx` | MODIFY payment currency copy |
| `src/pages/RewardAnalyticsPage.tsx` | MODIFY terminology + partner breakdown |
| `src/lib/translations.ts` | MODIFY (optional) economy labels |
| `src/styles/v15.7.11-economy-foundation.css` | MODIFY tokens por partner |
| `AGENT_DadoFit_2_1.md` | MODIFY documenting ECO-4* |
| `docs/SPEC_DADOFIT_2_1_ECONOMY.md` | esta SPEC |
| `docs/DADOFIT_2_1_ECONOMY_AUDIT.md` | KEEP (baseline) |
| `scripts/*`, `src/lib/*`, `index.html`, `package.json` | KEEP mostly |

---

## 30. Open Questions

No quedan preguntas abiertas que bloqueen la implementación de DadoFit 2.1.

Decisiones cerradas:

1. **Todo payout de DC requiere budget.** Los retos propios de DadoFit usan budget interno; los convenios usan budget asociado a partner/campaña.
2. Multi-sede permanece estrictamente por `organization_id` en 2.1; wallet unificada queda fuera de alcance.
3. Partner Points no expiran automáticamente en 2.1; cualquier modelo de expiración se evaluará en una versión futura si existe necesidad comercial real.

---

SPEC RESULT

AGENT.md reviewed: YES (`AGENT_DadoFit_2_1.md`)
Economy audit reviewed: YES (`docs/DADOFIT_2_1_ECONOMY_AUDIT.md`)
Repository validated where necessary: YES

Implementation performed: NO
Migration created: NO
Application code modified: NO

SPEC:
docs/SPEC_DADOFIT_2_1_ECONOMY.md

Recommended next implementation milestone:
ECO-4B — DC Budget Governance
