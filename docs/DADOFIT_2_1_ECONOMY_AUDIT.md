# DadoFit — DadoFit 2.1 Context Economy Audit

Auditoría técnica del estado real de la economía de DadoFit basada en el código del repositorio (migraciones, RPCs, tablas, componentes, rutas y lógica). Sin cambios implementados.

---

## 1. Executive Summary

DadoFit ya opera con una economía multi-moneda en tres wallets aisladas + XP:

| Sistema | Saldo gastable | Score histórico |
|---|---|---|
| XP | No gastable | `user_progress.xp` / `progress_transactions` |
| DC (DadoCoins) | `wallets.balance` + `wallet_transactions` | — |
| GP (Gym Points) | `gym_point_wallets.balance` (por gym) | `score_events.gym_points` |
| SP (Sponsor Points) | `sponsor_point_wallets.balance` (por marca) | `score_events` legacy espejo GP |
| TP (Team Points) | No gastable | `score_events.team_points` |

ECO-3 ya implementó parcialmente el modelo objetivo de 2.1: `redeem_reward(p_payment_method 'dc'|'gp'|'sp')` permite pagar un reward con UNA sola moneda, y `rewards` tiene `native_currency`/`native_cost`. Lo que falta conceptualmente para 2.1 es:

- Unificar GP/SP/"sponsor_points legacy" bajo el concepto `Partner Points` con configuración por organización (`points_name`, `points_short_name`, `points_icon`, `points_color`, `enabled`).
- Resolver la emisión de DC: hoy el backend fija caps por RPC, pero no existe un presupuesto formal (`campaign_budget` de DadoCoins por partner).
- Aclarar que `challenges.sponsor_points`/`score_events.sponsor_points` son espejo legacy de GP, no SP real.
- Separar formalmente saldo gastable vs score histórico en rankings.

Magnitud del cambio: **media-grande pero evolutiva**. El 80% del modelo objetivo ya existe (ECO-1/2/3). El trabajo es de abstracción conceptual, configuración de Partner Points, presupuestos de DC, y aclaración de semántica legacy.

---

## 2. Current Architecture

Cuatro sistemas económicos conceptuales (AGENT.md §17):

```text
XP   → progreso personal (user_progress), no gastable
DC   → moneda universal DadoFit (wallets), gastable en Marketplace DadoFit
TP   → puntos competitivos de Squad (score_events.team_points), histórico
GP   → puntos del Gym (score_events.gym_points + gym_point_wallets), gastables en su Gym
SP   → puntos por Marca/Brand (sponsor_point_wallets), gastables en su marca (ECO-1)
```

Capas:

```text
ProfilePage / SocialSummaryBar
  └─ get_dadofit_dashboard_summary, get_my_gym_point_balances, get_my_sponsor_point_balances
RewardsMarketplacePage
  └─ get_reward_marketplace, redeem_reward(p_payment_method)
RewardManagementPage
  └─ provider_create_reward / provider_update_reward
Challenges / Review RPCs
  └─ review_direct_challenge, review_organization_challenge, complete_sponsored_approval_v133
Score/Seasons
  └─ score_events → triggers ECO-2 → gym_point_wallets
```

Todas las RPCs de otorgamiento son `security definer`, idempotentes (`idempotency_key`), con advisory locks y límites anti-farming.

---

## 3. Current Database Model

### DC — DadoCoins

| Tabla | Columnas clave | PK | FKs | Rol |
|---|---|---|---|---|
| `wallets` | `user_id`, `balance` (≥0) | `id` uuid | `user_id → profiles` | Saldo global por usuario |
| `wallet_transactions` | `wallet_id`, `amount` (≠0), `source_type`, `source_id`, `idempotency_key` UNIQUE | `id` | `wallet_id → wallets` | Ledger inmutable de DC |

### XP

| Tabla | Columnas clave | PK | FKs | Rol |
|---|---|---|---|---|
| `user_progress` | `user_id`, `xp`, `level`, `current_streak`, `challenges_completed` | `user_id` | `user_id → profiles` | Progresión personal, no gastable |
| `progress_transactions` | `user_id`, `amount`, `source_type`, `idempotency_key` UNIQUE | `id` | `user_id → profiles` | Ledger de XP |

### Challenges

| Tabla | Columnas clave | PK | FKs | Rol |
|---|---|---|---|---|
| `challenges` | `creator_kind`, `creator_user_id/group_id/organization_id`, `challenge_type`, `reward_coins`, `reward_xp`, `team_points`, `sponsor_points` (legacy GP), `sponsor_campaign_id`, `season_id` | `id` | creators, sponsor_campaigns, seasons | Contrato del reto |
| `challenge_participants` | `challenge_id`, `user_id`, `group_id`, `status`, `rewarded_at`, `reward_coins_granted`, `reward_xp_granted`, `sponsor_points_granted`, `sponsor_reward_points_granted` (SP real), `reward_block_reason` | `id` | challenges, profiles, groups | Participación y otorgamiento |
| `challenge_reviews` | `participant_id`, `reviewer_user_id`, `decision`, `notes` | `id` | participants, users | Decisión de evidencia |

### Score / Seasons

| Tabla | Columnas clave | PK | FKs | Rol |
|---|---|---|---|---|
| `score_events` | `season_id`, `challenge_id`, `participant_id`, `group_id`, `organization_id`, `team_points`, `sponsor_points` (legacy=GP), `gym_points`, UNIQUE(participant_id) | `id` | seasons, challenges, … | Score competitivo histórico, nunca se debita |
| `group_scores` / `organization_scores` | agregados por (season, group/organization) | compuesta | seasons, groups/orgs | Agregados de ranking |
| `seasons` | `slug`, `status`, `season_type`, `sponsor_organization_id` | `id` | orgs | Temporada |
| `season_organization_entries` | PK(season, organization), `status` | compuesta | seasons, orgs | Entradas de competencias patrocinadas |

### Wallets de partner (ECO-1 / ECO-2)

| Tabla | Columnas clave | PK | FKs | Rol |
|---|---|---|---|---|
| `sponsor_point_wallets` | PK(user_id, sponsor_organization_id), `balance`, `lifetime_earned`, `lifetime_spent` | compuesta | users, orgs | Saldo gastable de SP por marca |
| `sponsor_point_ledger` | `user_id`, `sponsor_organization_id`, `amount`, `balance_after`, `entry_type`, `idempotency_key` | `id` | users, orgs | Ledger de SP |
| `gym_point_wallets` | PK(user_id, gym_organization_id), `balance`, `lifetime_*` | compuesta | users, orgs | Saldo gastable de GP por gym |
| `gym_point_ledger` | análogo a SP ledger | `id` | users, orgs | Ledger de GP |

### Organizations

| Tabla | Columnas clave | PK | FKs | Rol |
|---|---|---|---|---|
| `organizations` | `organization_type` ('gym'\|'brand'\|'sponsor'\|'company'\|'other'), `verification_status` | `id` | — | Un modelo único para Gym/Brand/Sponsor |
| `organization_members` | PK(organization_id, user_id), `role` owner/admin/coach/member, `status` | compuesta | orgs, users | RBAC por organización |
| `sponsor_campaigns` | `organization_id`, `default_reward_coins/xp/sp`, `max_participants`, `status` | `id` | orgs | Campaña de Marca con defaults de recompensa |

### Rewards

| Tabla | Columnas clave | PK | FKs | Rol |
|---|---|---|---|---|
| `rewards` | `organization_id`, `title`, `reward_type`, `coin_cost` (DC), `native_currency` ('gp'\|'sp'), `native_cost`, `inventory`, `max_per_user`, `status`, `fulfillment_type/mode` | `id` | orgs | Oferta de recompensa |
| `reward_redemptions` | `reward_id`, `user_id`, `coin_cost`, `payment_currency`, `payment_amount`, `payment_organization_id`, `status`, `validation_token`, `redemption_code` | `id` | rewards, users | Canje con una sola moneda |
| `reward_coupon_codes` | `reward_id`, `code`, `status`, `assigned_*` | `id` | rewards, redemptions | Pool de códigos |
| `reward_offer_events` / `reward_redemption_events` | auditoría append-only | `id` | — | Trazabilidad |

---

## 4. Current Wallet / Ledger

- **DC**: `grant_wallet_coins` (service_role) escribe en `wallet_transactions` con `idempotency_key` y actualiza `wallets.balance`. No permite saldo negativo (check ≥0). Spend: `redeem_reward` decrementa `wallets.balance` + `wallet_transactions` con key `reward-redemption:<id>`.
- **GP**: `grant_gym_points` / trigger `credit_gym_wallet_from_score_event_eco2` acreditan por cada `score_event` de gym con GP>0 con key `gym-score-event:<id>` (desacopla ranking de saldo). Spend: `spend_gym_points_internal` exige membresía gym 'active'.
- **SP**: `grant_sponsor_points` / `spend_sponsor_points_internal` (ECO-3) con el mismo patrón de ledger.
- **Idempotency**: todas las operaciones de mint/spend usan `idempotency_key` UNIQUE; advisory locks por (usuario, par org) en aprobaciones.
- **Sin ledger de "emisión a partners"**: DC se crea como reward de retos sin registrar de dónde sale el cupo — anti-farming limita tasas pero no presupuestos.

---

## 5. Current Challenge Reward Engine

| Challenge actual | XP | DC | TP | GP/SP | Configurable | Backend |
|---|---:|---:|---:|---:|---|---|
| 1v1 (`direct`) | 50 | 25 | 0 | 0 | No (fijo) | `create_direct_challenge` / `review_direct_challenge` |
| Squad (`group`) | — | — | ✓ | 0 | Sí | Squad battles; capa sobre `score_events.team_points` |
| Organization / Gym | 0–50 | 0–25 | 0 | 0–100 GP | Sí | `create/review_organization_challenge` |
| Gym vs Gym | 0–50 | 0–25 | — | GP vía score_event | Sí | `submit/review/finalize_organization_battle` |
| Sponsored (Brand) | 0–100 | 0–50 | 0 | 0–500 SP | Sí | `complete_sponsored_approval_v133` |
| Sponsored Gym Competition | vía campaign | vía campaign | 0 | GP | Sí | `brand_create_sponsored_gym_competition` |

Reglas anti-farming: pair_cooldown 24h (retador→destinatario), daily_limit 5/24h (retos org) seq 3/24h (sponsored), idempotency por participante+dimensión, caps por RPC.

---

## 6. Current TP / GP / SP Model

- **TP** = `score_events.team_points`: score histórico de Squads, rankings y temporadas. Nunca se gasta.
- **GP** = `score_events.gym_points` (histórico) + `gym_point_wallets` (gastable por gym). El trigger ECO-2 mantiene `gym_points = max(gym_points, sponsor_points)` en score_events para compatibilidad legacy.
- **SP** = `sponsor_point_wallets` (gastable por marca) + `sponsor_reward_points_granted` en participants. **No es** el `sponsor_points` de challenges/score_events — ese campo es espejo legacy de GP.
- Compatibilidad legacy: AGENT.md §17 reconoce que `sponsor_points` debería mostrarse como `GP` en Gym; ECO-2 añadió `gym_points` explícito, ECO-3 añadió wallets, ECO-1 añadió wallets SP. Display ya lo migró (frontend usa "GP disponibles" / "Sponsor Points").

---

## 7. Current Rewards Marketplace

- **Catálogo**: tabla `rewards` por `organization_id`, estado draft/active/paused/ended, con `coin_cost` (DC) obligatorio y `native_cost` (GP/SP) obligatorio para publicar (ECO-3).
- **Pago**: `redeem_reward(p_reward_id, p_payment_method 'dc'|'gp'|'sp')` — 1 redención = 1 moneda, nunca mixto. Valida org verificada, stock (`reward_remaining_stock`), max por usuario, fenêtre temporal; debita la wallet correspondiente con idempotency.
- **Fulfillment**: cuatro modos (`generated_code`, `shared_code`, `code_pool`, `redemption_url`, `instructions_only`), pool FOR UPDATE SKIP LOCKED, QR (`validation_token`) para canje presencial (`provider_fulfill_reward_redemption`), notificaciones al usuario.
- **Análisis**: `provider_reward_analytics` separa `dc_consumed`/`gp_consumed`/`sp_consumed`; `admin_reward_analytics` reporta `dc_issued`, `dc_circulation`, `dc_consumed`.
- **Reutilizable para 2.1**: estructura de tabla, fulfillment, QR, analytics. Lo que cambia conceptualmente: el "Marketplace DadoFit" filtra `payment_currency='dc'` y el "Marketplace Partner" filtra por `organization_id` + `payment_currency` nativa.

---

## 8. Current Organizations Model

Una sola tabla `organizations` con `organization_type` distingue Gym/Brand/Sponsor/Company/Other. `organization_members` da RBAC (owner/admin/coach/member). `verification_status` actúa como gate para publicar rewards/campañas.

**Conclusión**: `organization_id` SÍ sirve como base para Partner Points. Cada organización puede tener su propia configuración (`points_name`, `points_short_name`, `points_icon`, `points_color`, `enabled`) sin nueva entidad.

---

## 9. Frontend Dependency Map

| Archivo | Rol económico |
|---|---|
| `src/pages/ProfilePage.tsx` | XP, DadoCoins, GP disponibles, SP disponibles (`get_dadofit_dashboard_summary`, `get_my_*_balances`) |
| `src/components/SocialSummaryBar.tsx` | XP/DC/TP/GP aporte histórico y saldo (`get_dadofit_dashboard_summary`) |
| `src/pages/RewardsMarketplacePage.tsx` | Marketplace único actual con chips DC/GP/SP, `get_reward_marketplace`, `redeem_reward` |
| `src/pages/RewardManagementPage.tsx` | Provider de ofertas: `provider_*` RPCs, `coin_cost`+`native_cost` |
| `src/pages/RewardValidationPage.tsx` | Fulfillment QR: `provider_fulfill_reward_redemption` |
| `src/pages/RewardAnalyticsPage.tsx` | KPIs de canjes: `provider_reward_analytics` |
| `src/pages/AdminPage.tsx` | `admin_reward_analytics`, `admin_dashboard_stats`, temporadas |
| `src/pages/SeasonHubPage.tsx` | Rankings TP/GP, competencias patrocinadas |
| `src/pages/GymBattlesPage.tsx` / `OrganizationChallengesPage.tsx` | Retos org con `sponsor_points` mostrado como GP |
| `src/pages/SponsoredChallengesPage.tsx` | Retos Brand con `sponsor_reward_points` = SP real |
| `src/pages/ChallengesPage.tsx` | 1v1 con `reward_coins`/`reward_xp` |
| `src/pages/SquadsPage.tsx` | TP por `score_events.team_points` |
| `src/pages/BrandCampaignsPage.tsx` | Crear campaña con DC/XP/SP defaults |
| `src/pages/BrandCompetitionsPage.tsx` | Competencias gym-vs-gym con GP |
| `src/pages/LegalPage.tsx` / `SiteFooter.tsx` | Disclaimer DC ≠ dinero |

Términos hardcodeados en español en componentes; `translations.ts` y `src/config` no contienen terminología económica.

---

## 10. AGENT.md Drift Report

- **Estado de versiones**: ⚠️ Parcialmente vigente — lista hasta V15.7 pero migraciones reales llegan a `v15.7.15-eco3-marketplace-multi-currency` (ECO-1/2/3 existen en migraciones y CSS de economía pero no se mencionan en VERSIONES de AGENT.md).
- **§17 Economía DadoFit**: ✅ XP y DC vigentes; ⚠️ GP "migrar visualmente desde sponsor_points" ya completado (ECO-2 añadió `gym_points` y wallets; frontend ya usa "GP disponibles"); ❌ No menciona SP (Sponsor Points) ni ECO-1/ECO-3.
- **§18 DadoCoins fuentes confirmadas**: ✅ vigente para 1v1/squads/gym/gym-vs-gym/sponsored.
- **Anti-farming §19**: ✅ vigente (cooldowns + daily limits descritos coinciden con RPC reales).
- **Rewards §22–27**: ✅ vigente para fulfillment/QR/pools/notifications; ⚠️ No describe pago multi-moneda (ECO-3) ni `native_currency/native_cost`.
- **Marketplace §22**: ⚠️ Describe catálogo DC; no documenta `payment_currency ('dc'|'gp'|'sp')` ni separación Saldo vs Score en `reward_redemptions`.
- **Roadmap / última tarea**: ❌ No refleja ECO-1/2/3 ni V15.7–V15.8.
- **Término "sponsor_points = SP"**: ❌ Conceptualmente obsoleto; en BD `sponsor_points` es espejo legacy de GP; SP real vive en `sponsor_point_wallets`/`sponsor_point_ledger`/`sponsor_reward_points_granted`.

---

## 11. Reusable Components

- Wallets y ledgers existentes (`wallets`, `gym_point_wallets`, `sponsor_point_wallets`) con idempotency + lifetime fields → reutilizar como `Partner Points Wallets`.
- Trigger ECO-2 de acreditación desde `score_events` → patrón reusable para emitir Partner Points desde scoring.
- `redeem_reward` con `payment_currency` único → base para Marketplace DadoFit (solo 'dc') y Marketplace Partner (solo 'gp'/'sp' nativos).
- `rewards.native_currency`/`native_cost` + validaciones de `provider_*` → se mapean a "Partner Marketplace".
- `season_organization_entries`, `sponsor_campaigns`, `brand_*` RPCs → ya soportan competencias y campañas patrocinadas; se conservan.
- Anti-farming global (cooldowns, daily limits, idempotency, advisory locks) → conservar intacto.

---

## 12. Required Changes for DadoFit 2.1

### KEEP
- XP como progresión no gastable.
- DC como única moneda universal; `wallets`/`wallet_transactions`; ledger idempotente.
- Score histórico separado (`score_events`, `group_scores`, `organization_scores`) nunca se debita.
- Anti-farming RPCs y caps existentes.
- ECO-2 trigger que alimenta `gym_point_wallets` desde `score_events`.
- ECO-3 pago único por redención.

### ADAPT
- Renombrar conceptualmente "GP/SP" → **Partner Points** por organización; sin renombrar tablas físicas todavía.
- Añadir configuración de Partner Points en `organizations` o tabla `organization_point_configs` (`points_name`, `points_short_name`, `points_icon`, `points_color`, `enabled`).
- Marketplace: filtrar `rewards` por tipo de pago (`payment_currency='dc'` → Marketplace DadoFit; `payment_currency` nativa + `organization_id` → Marketplace Partner). Catálogo ya es por organización, solo falta separar UI.
- AGENT.md: actualizar §17/18 para documentar ECO-1/2/3, SP real, Partner Points y eliminar "sponsor_points = SP".

### ADD
- Presupuesto de emisión de DC por campaña/partner (`campaign_budget_dc`, `budget_used_dc`); RPCs de otorgamiento de DC desde retos patrocinados deben consumir este cupo.
- Flag `organization_type`→`points_engine_enabled` para activar Partner Points solo en orgs verificadas.
- UI/Config por partner para `points_name/icon/color`.

### DEPRECATE LATER
- Columna legacy `challenges.sponsor_points` / `score_events.sponsor_points`: mantener como espejo de GP hasta que rankings usen `gym_points` exclusivamente; no borrar en 2.1.
- Nomenclatura "sponsor_points" en UI: reemplazar por "SP" (ya hecho) y luego por `<Org> Points`.
- `rewards.coin_cost` como precio principal: mantener por compatibilidad pero resaltar `native_cost` cuando `native_currency` exista.

---

## 13. Migration Risks

- **Datos existentes**: millones de `wallet_transactions`/ledgers con `source_type` históricos; rebautizar a Partner Points sin doble contabilidad.
- **Rankings**: `score_events.sponsor_points` legacy podría reinterpretarse como SP; forzar lectura de `gym_points` en seasons/rankings.
- **Rewards antiguas**: `native_cost` NULL en drafts → no publicables hasta configurar; migración aditiva.
- **Redemptions mixtas**: hoy imposible (1 moneda); cualquier cambio a pagos combinados rompe invariante.
- **RLS**: nuevas columnas de `organizations` requieren policies; revisar `can_manage_rewards_for_org`.
- **RPCs internas**: `grant/spend_*_internal` son service_role only; exponer Partner Points spend a UI requiere nuevas RPCs con RBAC.
- **Analytics**: reportes que agrupan por `payment_currency` se verán afectados al añadir Partner Points; ajustar `provider_reward_analytics`.
- **Notificaciones**: templates con "DC/GP/SP" deben parametrizarse por `points_name`.
- **Frontend**: terminología hardcodeada (DadoCoins/GP/SP) en ~10 páginas; introducir config pone en riesgo consistencia visual.

---

## 14. Recommended Migration Order

1. **Foundation (docs + AGENT.md)**: documentar ECO-1/2/3, aclarar `sponsor_points`=legacy GP, definir concepto Partner Points y su configuración. Sin migraciones.
2. **Partner Points config**: añadir columna/tabla de configuración en `organizations` (`points_name`, etc.) con defaults por `organization_type`. Migración aditiva.
3. **Budgets DC**: tabla `organization_campaign_budgets` (`budget_dc`, `spent_dc`) + enforcement en RPCs de retos patrocinados que emiten DC. Migración nueva.
4. **Challenge reward abstraction**: RPCs de otorgamiento de DC consultan presupuesto; GP/SP siguen desde `score_events`/wallets. Lógica.
5. **Marketplace split**: RPCs `get_dadofit_marketplace()` (`payment_currency='dc'`) y `get_partner_marketplace(org_id)` (nativa). Reutilizar `get_reward_marketplace`.
6. **Frontend**: RewardsMarketplacePage → tabs DadoFit vs Partner; ProfilePage/SocialSummaryBar → labels dinámicos desde config.
7. **Compatibility layer**: mantener `get_reward_marketplace()` y RPCs viejas durante 1–2 releases; deprecate LATER.
8. **QA anti-farming**: tests idempotency + caps + presupuesto + RLS.

---

## 15. Files That Would Change

| Archivo | Motivo | KEEP/MODIFY/ADD |
|---|---|---|
| `AGENT.md` | Actualizar §14–19 y §22–27 con ECO-1/2/3, Partner Points, budgets | MODIFY |
| `docs/DADOFIT_2_1_ECONOMY_AUDIT.md` | Este documento | ADD (presente) |
| `supabase/migrations/<new>_partner_points_config.sql` | Config de puntos por organización | ADD |
| `supabase/migrations/<new>_dc_campaign_budgets.sql` | Presupuestos de emisión de DC | ADD |
| `supabase/migrations/<new>_partner_marketplace_rpcs.sql` | `get_partner_marketplace`, budget checks | ADD |
| `src/pages/RewardsMarketplacePage.tsx` | Split Marketplace DadoFit vs Partner | MODIFY |
| `src/pages/ProfilePage.tsx` | Labels dinámicos de puntos | MODIFY |
| `src/components/SocialSummaryBar.tsx` | Config-driven labels | MODIFY |
| `src/pages/RewardManagementPage.tsx` | UI de `native_currency` ya existe; añadir preview de nombre de puntos | MODIFY |
| `src/pages/BrandCampaignsPage.tsx` | Presupuesto DC en campañas | MODIFY |
| `src/pages/AdminPage.tsx` | Métricas de budget y Partner Points | MODIFY |
| `src/styles/v15.7.11-economy-foundation.css` | Tokens visuales para puntos por partner | MODIFY |
| `scripts/prepare-dataset.mjs` | Sin cambios esperados | KEEP |
| `src/lib/translations.ts` | Posiblemente integrar labels dinámicos | MODIFY (optional) |

---

## 16. Open Questions

1. ¿El presupuesto de DC por campaña debe ser en DC nominales fijos o con conversión ajustable desde moneda fiat para pactos comerciales?
2. ¿Un mismo usuario puede canjear Partner Points de una org verificada en otra org del mismo Partner (multi-sede) o estrictamente por `organization_id`?
3. ¿Los Partner Points expirados (ej. membresía vencida) deben trasladarse a otra wallet o perderse?
4. ¿`redeem_reward` debe permitir en el futuro pagos combinados (DC + Partner Points) o el modelo de 2.1 mantiene estrictamente un solo método?
5. ¿Los rankings de Squads/Gym deben exponer GP/SP históricos como "lifetime" independiente del saldo, ya lo existe en `lifetime_earned` pero falta en UI de ranking?

---

AUDIT RESULT

Repository inspected: YES

Implementation performed: NO

Migrations created: NO

AGENT.md modified: NO

Audit document:
docs/DADOFIT_2_1_ECONOMY_AUDIT.md

Recommended next step:
Actualizar AGENT.md y definir SPEC de migración económica DadoFit 2.1.
