# SPEC - MARKETPLACE-PARTNER-001: Marketplace dedicado por marca / organizacion

Estado: IMPLEMENTED / AUTOMATED QA COMPLETE / MANUAL QA PENDING
Modo: SDD - implementacion T01-T16 completada; T17 parcial y cierre T18 documentado sin declarar QA manual completa.
Ruta principal propuesta: `/rewards` (sin ruta nueva en v1).
Identidad economica canonica: `organization_id`.

---

## 1. Contexto

DadoFit 2.1 separa cuatro conceptos economicos:

- XP: progreso personal.
- DadoCoins (DC): moneda universal DadoFit.
- Partner Points: saldo propio de cada organizacion.
- Competitive Score: puntuacion historica para rankings y temporadas.

El producto ya distingue conceptualmente:

- Marketplace DadoFit: rewards pagados exclusivamente con DC.
- Marketplace Partner: rewards pagados exclusivamente con Partner Points de la organizacion propietaria.

La base tecnica de Rewards ya incluye catalogo, redenciones, stock, limites por usuario, codigos, QR, fulfillment, wallets Partner, gestion por organizaciones y analytics. Esta feature no crea marketplaces hardcodeados para Nike, Titanes, Adidas ni otra marca. Extiende una unica arquitectura parametrizada por `organization_id`.

Ejemplos de producto, no seeds:

- Nike -> Nike Points -> Marketplace Nike.
- Titanes -> Titanes Points -> Marketplace Titanes.
- Adidas -> Adidas Points -> Marketplace Adidas.

## 2. Estado actual

Estimacion reutilizable: **70%**.

| Capacidad | Estado | Evidencia / observacion |
|---|---|---|
| Ruta de consumo `/rewards` | EXISTE | `src/App.tsx`; restringida al workspace personal |
| Separacion `dadofit` / `partner` | EXISTE | `rewards.marketplace_scope` y RPCs segmentados |
| Catalogo Partner por organizacion | PARCIAL | Existe RPC, pero retorna `SETOF rewards`, no valida relacion economica ni disponibilidad completa |
| Discovery autoritativo de comunidades | FALTA | El frontend parte de wallets existentes |
| Wallet Gym por organizacion | EXISTE | `gym_point_wallets`, PK usuario + organizacion |
| Wallet Brand/Company por organizacion | EXISTE | `sponsor_point_wallets`, PK usuario + organizacion; nombre fisico legacy |
| Lectura unificada de Partner Points | FALTA | Hay dos RPCs y dos contratos fisicos |
| Configuracion Partner Points | PARCIAL | Existe tabla/RPC; falta gobierno separado y ausencia segura por defecto |
| Uso de nombre/abreviatura | PARCIAL | Se usa en varias vistas; existen fallbacks legacy |
| Uso de icono/color | FALTA | Campos disponibles, no aplicados de forma consistente |
| Enforcement de `enabled` | FALTA | Actualmente declarativo |
| Rewards por `organization_id` | EXISTE | FK y gestion por proveedor |
| Stock real | PARCIAL | Autoritativo en canje; los catalogos segmentados no lo entregan correctamente |
| `max_per_user` | EXISTE | Validacion backend serializada |
| Vigencia | EXISTE | Validada por `redeem_reward` |
| DTO seguro de catalogo | FALTA | Los RPCs segmentados retornan `SETOF rewards` |
| Canje atomico | EXISTE | `redeem_reward` con locks, debito y redencion |
| Bloqueo de mixed payment | EXISTE | Un canje usa una sola moneda |
| Aislamiento cross-org oficial | EXISTE | Reward determina organizacion y wallet debitada |
| Integridad cross-org universal | PARCIAL | Faltan constraints/guards para escrituras privilegiadas |
| Generated/shared/code pool | PARCIAL | Infraestructura existe; falta cerrar exposicion pre-canje y copias historicas de secretos |
| QR y entrega presencial | PARCIAL | Flujo existe; falta DTO operacional allowlisted y lookup sin oracle de existencia |
| Historial de redenciones | EXISTE | Dentro de `/rewards` |
| Historial filtrado por organizacion | FALTA | No existe filtro inicial Partner |
| Reward detail | FALTA | Las cards canjean directamente |
| Gestion Partner | EXISTE | `/rewards/manage`, Owner/Admin |
| Gobierno visual de puntos | PARCIAL | RPC actual no separa presentacion de `enabled` |
| Analytics Partner | EXISTE | `provider_reward_analytics` y Partner Points analytics |
| Semantica analytics multi-moneda | PARCIAL | SuperAdmin y algunas vistas conservan `coin_cost` DC legacy |
| Responsive | EXISTE | Breakpoints actuales para marketplace y operacion |
| Accesibilidad especifica | PARCIAL | Faltan semantica de tabs, live regions y dialog accesible |
| Grants/RLS/`SECURITY DEFINER` | PARCIAL | Existen protecciones, pero falta hardening integral de firmas, grants, owners y `search_path` |
| Retencion historica de organizacion | PARCIAL | Existen snapshots parciales; FK `SET NULL` puede perder contexto de filtro |
| Refund/cancelacion | FALTA | Fuera de alcance de esta feature |
| Seeds Nike/Titanes | N/A | No deben crearse datos productivos artificiales |

## 3. Problema

La infraestructura permite operar rewards Partner, pero la experiencia y los contratos aun no representan de forma completa un marketplace dedicado por organizacion:

- El usuario ve comunidades inferidas desde wallets, no desde una relacion economica resuelta por backend.
- Los catalogos segmentados pueden exponer columnas sensibles porque retornan filas completas de `rewards`.
- La disponibilidad visible se reconstruye parcialmente en frontend y puede diferir de stock, vigencia y limites reales.
- El branding Partner no usa todos los campos existentes.
- No hay detalle previo al canje ni historial contextual por organizacion.
- `enabled=false` no suspende efectivamente la economia Partner.
- Existen protecciones cross-org en el flujo normal, pero no todas las combinaciones invalidas estan prohibidas a nivel de persistencia.
- Analytics antiguos pueden interpretar `coin_cost` como DC consumidos en redenciones Partner.

## 4. Objetivo

Permitir que cada organizacion tenga, dentro del shell DadoFit:

- Marketplace dedicado y parametrizado por `organization_id`.
- Branding ligero basado en configuracion existente.
- Catalogo, stock, reglas y Partner Points propios.
- Saldo contextual del usuario.
- Redenciones estrictamente aisladas por organizacion.
- Historial contextual reutilizando `/rewards`.
- Gestion exclusiva para Owner/Admin de la organizacion.
- Analytics correctos por moneda y organizacion.

La feature debe evolucionar lo existente sin crear una moneda, wallet o sistema de fulfillment nuevo.

## 5. Modelo de dominio

### Identidad economica

La identidad de Partner Points es:

```text
(user_id, organization_id)
```

Para una redencion Partner:

```text
(reward_id, payment_currency, payment_organization_id)
```

`gp` y `sp` son detalles fisicos legacy. No identifican por si solos una economia. Ningun contrato nuevo debe sumar o intercambiar puntos usando solo `native_currency`, `points_name`, `brand_name` o un nombre visual.

### Entidades existentes

- `organizations`: propietario y tipo de organizacion.
- `organization_members`: relacion y roles.
- `partner_point_configs`: presentacion y habilitacion de Partner Points.
- `gym_point_wallets` / `gym_point_ledger`: implementacion fisica Gym.
- `sponsor_point_wallets` / `sponsor_point_ledger`: implementacion fisica legacy para Brand/Company.
- `rewards`: oferta, scope, costo, inventario, vigencia y fulfillment.
- `reward_redemptions`: compra emitida y snapshot de pago/fulfillment.
- `reward_coupon_codes`: pool de codigos.
- `reward_offer_events` / `reward_redemption_events`: auditoria.

### Invariantes

- DadoFit reward se paga solo con DC.
- Partner reward se paga solo con Partner Points de su `organization_id`.
- Partner Points de organizaciones distintas nunca se mezclan.
- Competitive Score no se debita ni convierte al canjear.
- No existe mixed payment.
- El backend es autoridad de catalogo, saldo, elegibilidad y canje.

### Decisiones normativas cerradas

- Config Partner ausente: branding visual basico permitido, pero `economy_enabled=false`.
- Tipos Partner soportados: `gym`, `brand` y `company`. Cualquier otro tipo se rechaza de forma segura.
- La resolucion fisica de wallet es explicita y cerrada; nunca se usa `CASE ... ELSE 'sp'`.
- Reward DadoFit: `marketplace_scope='dadofit'` y `organization_id IS NULL`.
- Reward Partner: `marketplace_scope='partner'` y `organization_id IS NOT NULL`.
- `terms` puede ser publico. `fulfillment_instructions` siempre es privado/post-canje. No se crea `public_instructions` en v1.
- Organizaciones con historia economica usan suspension logica; su borrado fisico queda fuera de alcance.
- No existe catalogo operativo agregado “Todos”. Una vista “Todos”, si permanece temporalmente por compatibilidad, solo puede ser overview/navegacion.
- SuperAdmin no obtiene bypass economico al canjear.

## 6. Arquitectura actual encontrada

### Backend

- `supabase/migrations/20260903210000_rewards_marketplace_foundation.sql`: rewards, redenciones, gestion y marketplace base.
- `supabase/migrations/20260903224500_reward_fulfillment_coupon_inventory.sql`: pools, stock y modos de fulfillment.
- `supabase/migrations/20260904190000_reward_qr_fulfillment.sql`: QR, lookup y entrega.
- `supabase/migrations/20260907223000_eco1_sponsor_points_wallet.sql`: wallet fisica legacy usada por Brand/Company.
- `supabase/migrations/20260911181500_eco2_gym_points_wallet.sql`: wallet Gym.
- `supabase/migrations/20260911204500_eco3_marketplace_multi_currency.sql`: pago DC/GP/SP y analytics por proveedor.
- `supabase/migrations/20261007140000_eco4a_partner_point_configs.sql`: configuracion visual Partner.
- `supabase/migrations/20261007170000_eco4d_marketplace_scope.sql`: scopes DadoFit/Partner.
- `supabase/migrations/20261008110000_eco4h_economy_operations.sql`: operaciones finales, config batch y analytics Partner Points.

### Frontend

- `src/pages/RewardsMarketplacePage.tsx`: catalogo, wallets, canje e historial.
- `src/pages/RewardManagementPage.tsx`: gestion Partner.
- `src/pages/RewardValidationPage.tsx`: validacion y fulfillment.
- `src/pages/RewardAnalyticsPage.tsx`: analytics Partner.
- `src/pages/WorkspaceHomePage.tsx`: resumen economico de la organizacion.
- `src/pages/AdminPage.tsx`: analytics y budgets globales.
- `src/lib/partnerPoints.ts`: lectura y normalizacion visual.
- `src/lib/workspaceNavigation.ts`: rutas por workspace y rol.
- `src/components/RewardQrCode.tsx`: QR de redencion.

### Rutas vigentes

- `/rewards`: marketplace de consumo, workspace personal.
- `/rewards/manage`: gestion Owner/Admin.
- `/rewards/analytics`: analytics Owner/Admin.
- `/rewards/validate`: fulfillment Owner/Admin.
- `/admin/rewards`: supervision SuperAdmin existente.

Decision: conservar `/rewards` como ruta canonica. No crear `/rewards/partner/:organizationId` en v1.

## 7. Gaps

### Criticos

1. Los catalogos no deben retornar `SETOF rewards` porque la tabla contiene secretos de fulfillment.
2. La lectura directa de rewards activos debe impedir acceso previo al canje a `shared_code`, URL privada, valores de pool e instrucciones sensibles.
3. Discovery y catalogo deben ser backend-authoritative.
4. La persistencia debe rechazar combinaciones cross-org invalidas incluso desde service role o futuras RPC.

### Funcionales

1. Selector de comunidad dentro de “Mis comunidades”.
2. Branding completo con icono/color existente.
3. Detalle responsive antes del canje.
4. Historial inicialmente filtrado por organizacion.
5. Estado explicito para economia deshabilitada.
6. UI de configuracion de presentacion para Owner/Admin.

### Operativos

1. Analytics debe usar pago efectivo, no `coin_cost` legacy.
2. Accesibilidad especifica y tests de flujo son parciales.
3. No hay dataset versionado que garantice Nike/Titanes en el ambiente.

## 8. Experiencia de usuario

La vista `/rewards` mantiene el shell DadoFit y presenta dos destinos principales:

```text
Premios

[DadoFit] [Mis comunidades]
```

### DadoFit

- Saldo DC.
- Catalogo universal.
- Rewards `marketplace_scope='dadofit'`.

### Mis comunidades

Lista de organizaciones resueltas por backend, por ejemplo:

```text
Nike
120 Nike Points
Ver Marketplace

Titanes Gym
265 Titanes Points
Ver Marketplace
```

Al seleccionar una comunidad:

- Se muestra identidad de organizacion y Partner Points.
- Solo aparecen rewards de esa organizacion.
- El saldo corresponde a esa organizacion.
- El historial se inicializa filtrado por `organization_id`.
- El usuario puede volver a “Todas” las redenciones.

No se muestran indiscriminadamente todas las organizaciones del sistema.

### Discovery autoritativo

El backend resuelve una fila unica por `organization_id`. La UI no infiere comunidades desde una lista local de wallets. El resultado distingue visibilidad, estado operativo y acceso historico.

Estados cerrados de `marketplace_state`:

- `OPERATIONAL`: visible, catalogo activo y potencialmente canjeable.
- `DISABLED`: visible, economia suspendida o config ausente; sin catalogo operativo ni nuevos canjes.
- `HISTORY_ONLY`: visible solo para saldo/historico/fulfillment ya emitido.

`NOT_VISIBLE` no se retorna como fila: representa ausencia segura del resultado. `VISIBLE` es una propiedad derivada de retornar cualquiera de los tres estados anteriores, no un valor adicional del enum.

Tabla de verdad normativa (`activity` incluye ledger, campaña economica o redencion valida asociada al usuario y organizacion):

| Tipo | Estado org | Config | Enabled | Membresia activa | Membresia historica | Wallet | Balance | Activity/redemption | Resultado |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| Gym | activa/verificada | existe | si | si | cualquiera | cualquiera | cualquiera | cualquiera | `OPERATIONAL` |
| Gym | activa/verificada | existe | si | no | si | si/no | cualquiera | si | `HISTORY_ONLY`; membresia activa requerida para nuevos canjes Gym |
| Gym | activa/verificada | existe | si | no | no | si | > 0 | si | `HISTORY_ONLY`; saldo e historico visibles, nuevos canjes bloqueados |
| Gym | activa/verificada | existe | si | no | no | si | 0 | si | `HISTORY_ONLY` salvo relacion canjeable demostrable |
| Gym | activa/verificada | existe | si | no | no | si | 0 | no | `NOT_VISIBLE` |
| Gym | cualquiera | ausente | no | cualquiera | cualquiera | cualquiera | cualquiera | si | `DISABLED` o `HISTORY_ONLY` segun estado org; nunca operacional |
| Gym | cualquiera | existe | no | cualquiera | cualquiera | cualquiera | cualquiera | si/no | `DISABLED` si hay relacion; en otro caso `NOT_VISIBLE` |
| Brand/Company | activa/verificada | existe | si | no requerida | cualquiera | si | cualquiera | cualquiera | `OPERATIONAL` |
| Brand/Company | activa/verificada | existe | si | no requerida | cualquiera | no | 0 | si | `OPERATIONAL` si la actividad genera relacion economica vigente; de otro modo `HISTORY_ONLY` |
| Brand/Company | activa/verificada | existe | si | no requerida | cualquiera | no | 0 | no | `NOT_VISIBLE` |
| Brand/Company | cualquiera | ausente | no | cualquiera | cualquiera | cualquiera | cualquiera | si | `DISABLED` o `HISTORY_ONLY`; nunca operacional |
| Brand/Company | cualquiera | existe | no | cualquiera | cualquiera | cualquiera | cualquiera | si/no | `DISABLED` si hay relacion; en otro caso `NOT_VISIBLE` |
| Soportada | suspendida/inactiva | cualquiera | cualquiera | cualquiera | cualquiera | cualquiera | cualquiera | si | `HISTORY_ONLY`; fulfillment emitido e historial disponibles |
| Soportada | suspendida/inactiva | cualquiera | cualquiera | cualquiera | cualquiera | cualquiera | cualquiera | no | `NOT_VISIBLE` |
| No soportada | cualquiera | cualquiera | cualquiera | cualquiera | cualquiera | cualquiera | cualquiera | cualquiera | `NOT_VISIBLE` y rechazo seguro |

Una wallet con balance cero no crea por si sola relacion economica; debe existir membresia o actividad valida. Una wallet con saldo positivo constituye relacion economica. El estado de organizacion y `enabled` prevalecen sobre la posibilidad de nuevas operaciones.

Enum cerrado `relationship_reason`, con precedencia para deduplicacion:

1. `ACTIVE_MEMBERSHIP`.
2. `PARTNER_WALLET`.
3. `PARTNER_ACTIVITY`.
4. `REDEMPTION_HISTORY`.
5. `HISTORICAL_MEMBERSHIP`.

El RPC retorna una sola razon primaria por organizacion segun esa precedencia. Puede calcular internamente varias evidencias, pero no devuelve strings libres ni filas duplicadas.

Deep links a una organizacion no elegible retornan una respuesta vacia/no disponible indistinguible de una organizacion inexistente para impedir enumeracion.

## 9. Navegacion

- Ruta de consumo: `/rewards`.
- Estado seleccionado: query param no sensible `?scope=partner&organization=<uuid>`; no concede autorizacion.
- El enlace “Ver Marketplace” selecciona la organizacion sin crear una pantalla nueva.
- Cambiar al tab DadoFit limpia el contexto Partner.
- Cambiar a “Mis comunidades” conserva o selecciona una comunidad disponible.
- Historial permanece dentro de `/rewards`.
- Management, analytics y validation conservan sus rutas actuales.
- WorkspaceHome puede agregar accesos a gestion/analytics/validation sin duplicar superficies.

No existe una lista operativa “Todos” que mezcle rewards DadoFit y Partner. Una compatibilidad visual con ese nombre solo puede mostrar accesos/resumen, nunca CTAs de canje de monedas diferentes en un mismo catalogo.

La URL no concede autorizacion. Toda consulta vuelve a validar la relacion economica en backend.

## 10. Branding

Fuente primaria: `partner_point_configs`.

Campos permitidos:

- `points_name`.
- `points_short_name`.
- `points_icon`.
- `points_color`.

Se reutilizan nombre, logo u otros datos seguros ya disponibles en `organizations`. No se crea un theme engine nuevo.

Reglas:

- DadoFit conserva shell, tipografia, navegacion y componentes base.
- El color Partner se usa como acento con contraste accesible; nunca sustituye controles o estados criticos basados solo en color.
- Iconos/URLs deben validarse o limitarse a formatos admitidos.
- Si falta config, usar fallback neutral `Partner Points / PP`.
- `enabled` no es branding y no debe formar parte del RPC de edicion para Owner/Admin.

## 11. Catalogo

Un reward Partner elegible debe cumplir:

- `marketplace_scope='partner'`.
- `organization_id` no nulo y coincidente con el marketplace solicitado.
- Organizacion apta segun reglas actuales.
- `partner_point_configs.enabled=true`.
- Estado publicado/activo.
- Vigencia valida.
- Moneda nativa coherente con la implementacion fisica de la organizacion.

### Marketplace discovery DTO

Contrato conceptual exacto, una fila por organizacion:

```text
organization_id: uuid
organization_name: text
organization_type: 'gym' | 'brand' | 'company'
organization_logo: text | null              -- URL/asset publico validado
points_name: text
points_short_name: text
points_icon: text | null                     -- valor sanitizado/allowlisted
points_color: text                           -- #RRGGBB con contraste validado por UI
enabled: boolean                             -- false si config ausente
balance: bigint                              -- nunca agregado cross-org
relationship_reason: RelationshipReason
marketplace_state: 'OPERATIONAL' | 'DISABLED' | 'HISTORY_ONLY'
```

No contiene secretos, IDs de wallet/ledger ni detalles de actividad que revelen campañas privadas.

### Catalog Reward DTO

El DTO de catalogo usa allowlist explicita. Campos conceptuales permitidos:

```text
reward_id
organization_id
organization_name
organization_logo
marketplace_scope
title
description
reward_type
image_url
native_cost
points_name
points_short_name
points_icon
points_color
remaining_stock
starts_at
ends_at
max_per_user
user_redemptions
fulfillment_type
terms
can_redeem
blocked_reason
```

Tipos y semantica:

- `reward_id`, `organization_id`: UUID; `organization_id` coincide con el marketplace Partner solicitado.
- `native_cost`: bigint positivo.
- `remaining_stock`: bigint no negativo; `null` significa stock abierto/ilimitado.
- `user_redemptions`: bigint no negativo para el usuario autenticado.
- `terms`: texto publico; no contiene instrucciones para consumir el beneficio.
- `can_redeem`: boolean calculado por backend en la misma respuesta.
- `blocked_reason`: enum cerrado, nunca texto libre.

Enum `blocked_reason`:

```text
NONE
ECONOMY_DISABLED
NOT_ELIGIBLE
INSUFFICIENT_BALANCE
OUT_OF_STOCK
CODE_POOL_EMPTY
NOT_STARTED
EXPIRED
MAX_PER_USER_REACHED
REWARD_INACTIVE
ORGANIZATION_INACTIVE
```

`can_redeem=true` exige `blocked_reason=NONE`. El frontend traduce el enum a copy y no usa mensajes SQL como autoridad.

Campos prohibidos antes del canje:

- `shared_code`.
- Codigo generado de redencion.
- Valores del code pool.
- `redemption_url` privada.
- Instrucciones sensibles o post-canje.
- Tokens de validacion.
- Metadata interna o datos que permitan consumir el beneficio.

El catalogo devuelve `remaining_stock`, limites y elegibilidad calculados por backend. El frontend no reconstruye reglas criticas.

No se crea `public_instructions` en v1. `fulfillment_instructions` siempre pertenece al contrato privado post-canje.

## 12. Saldo

Se propone una fachada de lectura no destructiva sobre las wallets existentes. Contrato conceptual:

```text
get_my_partner_point_wallets()

organization_id
organization_name
organization_type
organization_logo
balance
lifetime_earned
lifetime_spent
redeemable
relationship_reason
points_name
points_short_name
points_icon
points_color
enabled
```

### Partner balance DTO

Contrato minimo reutilizable:

```text
organization_id: uuid
partner_currency: 'PARTNER_POINTS'           -- tipo logico de producto
physical_wallet_kind: 'GYM' | 'BRAND_COMPANY' -- interno; no identidad economica
balance: bigint
points_name: text
points_short_name: text
points_icon: text | null
points_color: text
enabled: boolean
```

La fachada realiza `UNION ALL`/delegacion interna:

- Gym -> `gym_point_wallets`.
- Brand/Company -> `sponsor_point_wallets` mientras esa sea la implementacion fisica vigente.

No migra ni combina saldos. No crea una wallet nueva. La UI nunca suma Partner Points de organizaciones distintas.

El saldo mostrado en un Marketplace Partner debe provenir del mismo resultado autoritativo usado para la elegibilidad o del DTO del marketplace, no de una suma local.

La resolucion usa una funcion cerrada de tipo Partner. `gym` resuelve wallet Gym; `brand` y `company` resuelven wallet Brand/Company. Cualquier otro tipo produce rechazo seguro. Nunca se implementa un `ELSE 'sp'`.

## 13. Reward detail

Se implementara un unico componente logico reutilizable:

- Desktop: dialog modal.
- Mobile: drawer / bottom sheet.

No se crea ruta de detalle en v1.

Contenido minimo:

- Reward e imagen.
- Organizacion.
- Costo y denominacion Partner.
- Saldo disponible.
- Stock/disponibilidad.
- Vigencia.
- `max_per_user` y cantidad ya canjeada.
- Tipo de fulfillment.
- Terminos publicos. Las instrucciones de fulfillment no aparecen antes del canje.
- Estado de elegibilidad y razon segura de bloqueo.
- Confirmacion explicita antes del canje.

El detalle consume el mismo DTO seguro del catalogo. Nunca solicita ni muestra secretos de fulfillment antes del canje.

## 14. Redemption

`redeem_reward` permanece como autoridad transaccional final. No se duplica.

Flujo:

1. Usuario abre detalle.
2. UI presenta costo, saldo, condiciones y disponibilidad reportados por backend.
3. Usuario confirma.
4. Cliente envia `reward_id` y metodo compatible.
5. Backend vuelve a validar scope, organizacion, config enabled, saldo, moneda, vigencia, stock y limite.
6. Backend bloquea filas, debita wallet correcta, reserva fulfillment y crea redencion atomicamente.
7. Cliente recarga marketplace, saldo e historial.
8. Solo el resultado autorizado/post-canje puede revelar fulfillment.

Reglas:

- Partner reward rechaza DC.
- DadoFit reward rechaza Partner Points.
- Partner reward rechaza puntos de otra organizacion.
- No mixed payment.
- La organizacion de pago se deriva del reward; no se confia en una seleccion arbitraria del cliente.

`redeem_reward` continua siendo el unico entrypoint transaccional de canje. Debe preservar locks, validacion de balance/organizacion, stock, `max_per_user`, reserva de code pool, asignacion de fulfillment, ledger, redencion y auditoria dentro de una unica transaccion. Si cualquier paso falla se ejecuta rollback completo: nunca puede existir debito sin redencion, redencion sin debito, codigo consumido sin redencion o stock parcialmente actualizado.

La comprobacion de `enabled` y estado organizacional se repite bajo el flujo autoritativo, aunque el detalle se haya cargado antes de una suspension.

## 15. Fulfillment

Se preserva completamente la infraestructura existente:

- `generated_code`.
- `shared_code`.
- `code_pool`.
- `redemption_url`.
- `instructions_only`.
- Digital benefit.
- Physical product.
- In-person fulfillment.
- QR/token y referencia manual.
- Stock, vigencia, auditoria y cola de entrega.

Seguridad post-canje:

- El propietario de la redencion puede consultar exclusivamente su fulfillment.
- Owner/Admin de la organizacion correspondiente puede consultar lo necesario para operar la entrega.
- SuperAdmin conserva acceso autorizado de auditoria/operacion.
- Member/Coach ajenos y administradores de otra organizacion no pueden consultar secretos.
- El catalogo nunca comparte el contrato de fulfillment privado.

### Fulfillment Owner DTO

Solo para `auth.uid() = reward_redemptions.user_id`. La autorizacion forma parte del `WHERE` de la consulta, no de una comprobacion posterior.

```text
redemption_id
reward_title_snapshot
organization_id_snapshot
organization_name_snapshot
status
fulfillment_type
fulfillment_mode
fulfillment_instructions
assigned_code                     -- solo codigo asignado a esta redencion
redemption_url                    -- snapshot privado de esta redencion
validation_token                  -- solo cuando el flujo QR lo requiere
redemption_reference
expires_at
fulfilled_at
```

### Fulfillment Operator/Admin DTO

Disponible para Owner/Admin activo de la misma organizacion y SuperAdmin autorizado. Coach, Member y administradores de otra organizacion no acceden.

```text
redemption_id
reward_id
reward_title_snapshot
organization_id_snapshot
user_display_fields_minimos       -- solo los necesarios para entregar
status
fulfillment_type
fulfillment_mode
assigned_code                     -- si es necesario para validar entrega
redemption_reference
validation_token                  -- si el flujo operacional lo requiere
expires_at
fulfilled_at
fulfillment_notes
```

No retorna pools completos, secretos de otras redenciones, ledger ni metadata interna. Lookup por token/referencia filtra autorizacion dentro de la query y usa la misma respuesta segura para “no existe” y “no autorizado”.

### Cierre de exposicion existente

- Reemplazar `SETOF rewards` por DTOs allowlisted.
- Revisar y revocar `SELECT` directo inseguro de `rewards` para clientes no autorizados.
- Auditar views, RPCs legacy, overloads y grants; crear un RPC nuevo no elimina exposiciones anteriores.
- Revisar acceso directo a redenciones, codigos y eventos; mantener solo entrypoints necesarios.
- Auditar `reward_offer_events`, metadata JSON, snapshots, logs y cualquier copia historica de una fila completa de reward.
- Detectar copias de `shared_code`, URL privada, instrucciones, pool o metadata secreta.
- Remediar acceso y retencion sin destruir evidencia de auditoria necesaria: retirar secretos innecesarios, cifrar/restringir lo imprescindible o reemplazar valores por indicadores de cambio. Ningun cliente final puede leer esas copias.

No se reescribe el motor de fulfillment.

## 16. Historial

El historial permanece en `/rewards`.

Comportamiento:

- Desde Marketplace DadoFit: vista general o filtro DadoFit segun estado actual.
- Desde un Marketplace Partner: filtro inicial por `organization_id`.
- Opcion “Todos” para volver al historial completo.
- El filtro es de presentacion y tambien debe enviarse al backend o aplicarse sobre resultados ya autorizados.

### Redemption History DTO

RPC con parametro opcional `p_organization_id uuid DEFAULT NULL`:

- `NULL`: historial global autorizado del usuario.
- UUID: solo redenciones cuyo snapshot corresponde a esa organizacion.

```text
redemption_id
reward_id
organization_id_snapshot
organization_name_snapshot
marketplace_scope_snapshot
reward_title_snapshot
reward_image_snapshot
redeemed_at
status
payment_currency
payment_amount
points_name_snapshot
points_short_name_snapshot
fulfillment_type
redemption_reference
expires_at
fulfilled_at
```

El contexto historico no depende exclusivamente de FK vivas sujetas a `ON DELETE SET NULL`. Una migracion aditiva debe completar snapshots seguros para nuevas redenciones y definir backfill conservador cuando la evidencia existente lo permita. No copiar secretos innecesarios en estos snapshots.

Campos utiles:

- Reward.
- Organizacion.
- Fecha.
- Estado traducido.
- Importe y nombre correcto de Partner Points.
- Codigo/QR/URL solo cuando corresponda y este autorizado.
- Instrucciones post-canje.
- Referencia y expiracion.

No mostrar IDs internos, detalles de pool, eventos de auditoria ni datos de otros usuarios.

## 17. Partner management

Se conserva `/rewards/manage` y `RewardManagementPage`.

Owner/Admin puede, solo para su organizacion:

- Crear reward Partner.
- Editar campos actualmente soportados.
- Publicar, pausar o finalizar.
- Configurar costo Partner Points.
- Configurar stock, vigencia y `max_per_user`.
- Configurar modos de fulfillment vigentes.
- Cargar pools de codigos.
- Editar presentacion de Partner Points: nombre, abreviatura, icono y color.

No puede:

- Crear/publicar Marketplace DadoFit.
- Cobrar DC por reward Partner.
- Elegir una moneda Partner de otra organizacion.
- Gestionar rewards, codigos, redenciones o analytics de otra organizacion.
- Cambiar `partner_point_configs.enabled`.

La UI debe eliminar copy/campos DC legacy que impliquen un segundo precio Partner, salvo compatibilidad interna no editable.

Gobierno de configuracion:

- RPC Owner/Admin: acepta exclusivamente `points_name`, `points_short_name`, `points_icon` y `points_color`; preserva `enabled`.
- RPC SuperAdmin: puede editar presentacion y cambiar `enabled`.
- La firma vigente que permite a Owner/Admin enviar `p_enabled` debe revocarse, reemplazarse o endurecerse.
- Deben revisarse y revocarse grants de firmas/overloads antiguas para impedir bypass por PostgREST.
- `points_icon` debe usar una representacion cerrada y validada (clave de icono/asset seguro o formato explicitamente permitido), nunca HTML/SVG arbitrario.

## 18. SuperAdmin

SuperAdmin conserva herramientas actuales y puede:

- Revisar marketplaces Partner y rewards.
- Auditar redenciones y fulfillment segun arquitectura vigente.
- Consultar analytics globales corregidos.
- Editar presentacion de Partner Points.
- Activar o suspender `partner_point_configs.enabled`.

Fuera de alcance:

- Crear una herramienta nueva de administracion del Marketplace DadoFit.
- Redisenar `/admin/rewards`.

Solo se permiten cambios minimos de compatibilidad/seguridad necesarios para separar scopes, ocultar secretos y reportar monedas correctamente.

El poder administrativo de SuperAdmin no crea saldo ni omite reglas economicas. Si actua como consumidor debe cumplir exactamente discovery/eligibility, wallet, balance, organizacion, `enabled`, stock y `max_per_user`.

## 19. Analytics

Fuentes canonicas para consumo:

- `reward_redemptions.payment_currency`.
- `reward_redemptions.payment_amount`.
- `reward_redemptions.payment_organization_id` y/o organizacion del reward validada.

No inferir Partner Points gastados mediante `rewards.coin_cost`.

Metricas Partner existentes a conservar/corregir:

- Rewards activos.
- Redenciones.
- Partner Points gastados.
- Usuarios unicos.
- Stock bajo.
- Tendencia y actividad reciente.

Reglas:

- Analytics de Owner/Admin siempre filtrado por su `organization_id`.
- SuperAdmin puede agregar, pero separa DC de Partner Points y conserva organizacion.
- No sumar GP/SP de organizaciones distintas como si fueran una moneda fungible.
- T01 identifica consumidores activos. Solo los contratos legacy con consumidores verificados se mantienen temporalmente, documentados como legacy y versionados; firmas sin consumidores se revocan.
- Historico permanece visible cuando `enabled=false`.

Se debe auditar y corregir expresamente `admin_reward_analytics`, `provider_reward_analytics`, `get_partner_point_analytics` y cualquier view/RPC consumidor actual. Para redenciones Partner, `coin_cost` conserva solo significado legacy/informativo si un consumidor antiguo lo requiere; nunca representa el pago Partner efectivo. Las columnas legacy que sobrevivan deben nombrarse/documentarse como legacy y no alimentar KPIs de consumo.

QA incluye un vector donde `coin_cost != payment_amount` y exige que todos los reportes muestren `payment_amount` en la moneda y `organization_id` efectivos.

## 20. RBAC / RLS

| Rol | Ver marketplace elegible | Canjear | Editar presentacion | Controlar enabled | Gestionar rewards | Ver analytics | Fulfillment |
|---|---:|---:|---:|---:|---:|---:|---:|
| Member | Si | Si | No | No | No | No | No |
| Coach | Si | Si | No | No | No | No | No |
| Owner | Si | Si | Si, su org | No | Si, su org | Si, su org | Si, su org |
| Admin org | Si | Si | Si, su org | No | Si, su org | Si, su org | Si, su org |
| SuperAdmin | Si | Solo como consumidor normal, sin bypass | Si | Si | Si | Si | Si |

Notas:

- “Admin org” no equivale a Platform Admin.
- Coach permanece excluido de gestion Rewards.
- Gym requiere membresia activa para nuevos canjes. Una relacion historica valida permite discovery `HISTORY_ONLY`, pero no bypass de membresia.
- Brand/Company no exige membresia universal si existe wallet o actividad economica legitima.
- RLS y RPC deben aplicar el mismo limite por organizacion.

Matriz own/cross-org normativa:

| Recurso | Member/Coach propio | Owner/Admin misma org | Owner/Admin otra org | SuperAdmin |
|---|---:|---:|---:|---:|
| Catalogo elegible | Si | Si como consumidor elegible | Solo si elegible como consumidor | Si como consumidor elegible |
| Reward management | No | Si | No | Si |
| Redemption propia | Si | Si si ademas es propia | Si si ademas es propia | Si segun permiso global |
| Redemptions operativas | No | Si, misma org | No | Si |
| Fulfillment owner | Solo redencion propia | Solo propia por este DTO | Solo propia por este DTO | Solo propia como consumidor |
| Fulfillment operator | No | Si, misma org | No | Si |
| Codes/pools | No | Si, misma org | No | Si |
| Offer/redemption events | No, salvo estado publico derivado | Si, misma org y sin secretos innecesarios | No | Si |
| Analytics | No | Si, misma org | No | Si |
| Partner config presentacion | No | Si, misma org | No | Si |
| Partner config `enabled` | No | No | No | Si |

### Hardening de RPC/RLS

- Inventariar owners, grants, `EXECUTE`, RLS y todas las sobrecargas vigentes.
- Revocar `PUBLIC`, `anon` o `authenticated` en funciones internas y conceder solo entrypoints necesarios.
- Todo `SECURITY DEFINER` sensible usa `search_path` seguro, objetos schema-qualified y actor obtenido de `auth.uid()`.
- Ningun RPC confia en roles, user IDs u organization IDs enviados por cliente sin validarlos contra membresias/permisos reales.
- Revisar permisos de creacion en schemas usados por resolucion de nombres.
- Autorizar dentro de la query para evitar oracles de existencia.

## 21. Cross-org

### Constraints/guards requeridos

Sin migracion destructiva, endurecer las invariantes:

1. `marketplace_scope='partner'` exige `organization_id IS NOT NULL`.
2. `marketplace_scope='dadofit'` exige `organization_id IS NULL`, no admite pago Partner ni organizacion de pago.
3. Reward Partner exige `native_currency` y `native_cost > 0`.
4. Reward DadoFit exige `native_currency IS NULL` y `native_cost IS NULL`; su precio efectivo es DC.
5. Redencion DC exige `payment_organization_id IS NULL`.
6. Redencion Partner exige `payment_organization_id IS NOT NULL`.
7. Redencion Partner exige `payment_organization_id = rewards.organization_id`.
8. Redencion Partner exige `payment_currency = rewards.native_currency` o su contrato canonico equivalente.
9. GP solo puede resolver una organizacion Gym.
10. La implementacion fisica Brand/Company solo puede resolver `brand` o `company`; tipos ambiguos deben rechazarse explicitamente.
11. `payment_amount > 0` para nuevas redenciones pagadas.
12. El guard no debe omitir validacion cuando `payment_organization_id` sea nulo.

Aplicar CHECK constraints a reglas de una sola fila y trigger/funcion de integridad a reglas que requieren consultar reward/organization. Antes de validar constraints sobre datos historicos debe ejecutarse auditoria de inconsistencias y estrategia `NOT VALID` + validacion posterior.

Estrategia de migracion obligatoria y ordenada:

1. Auditar datos actuales y producir conteos/evidencia reproducible.
2. Detectar combinaciones inconsistentes de scope, organizacion, moneda, importe y wallet.
3. Reparar cuando exista evidencia inequívoca o poner filas en cuarentena administrativa sin inventar datos.
4. Agregar constraints como `NOT VALID` cuando aplique para no bloquear despliegue por historico no auditado.
5. Endurecer trigger/funcion de integridad y la resolucion cerrada de tipo Partner.
6. Verificar comportamiento de entrypoints normales y escrituras privilegiadas.
7. Ejecutar `VALIDATE CONSTRAINT` solo cuando no queden inconsistencias sin resolver.
8. Repetir pruebas con service role y confirmar que no existe bypass.

No se migran balances GP/SP ni se reinterpreta `score_events.sponsor_points` como wallet real.

Todas las migraciones de esta feature son aditivas y no destructivas. Los objetos dependientes que hoy exigen `organization_id` no nulo para eventos/analytics deben adaptarse para representar DadoFit con scope/snapshots y `organization_id=NULL`, sin crear una organizacion sistema artificial. La compatibilidad se mantiene mediante versionado o wrappers solo para consumidores verificados en T01.

### `enabled=false` y suspension logica

La ausencia de config equivale a `economy_enabled=false`. El fallback visual nunca modifica ese valor.

Se debe inventariar todos los emisores actuales: RPCs, triggers, jobs, aprobaciones de challenges, recompensas de campañas, operaciones admin y cualquier flujo indirecto GP/SP. `enabled=false` bloquea toda nueva emision, create/update que deje reward activo, publicacion/activacion, discovery operacional, catalogo y redencion.

No bloquea lectura de balances/ledgers, historico, fulfillment emitido ni analytics historicos. Una organizacion con historia economica se suspende logicamente. El borrado fisico de organizaciones historicas queda fuera de alcance.

## 22. Empty / error / loading

Estados requeridos:

- Sin comunidades: “Aun no tienes comunidades con Partner Points”. Mantener Marketplace DadoFit disponible.
- Organizacion sin Partner Points habilitados: “Marketplace temporalmente no disponible”.
- Saldo cero: mostrar catalogo si la relacion economica es valida, con CTA deshabilitado por saldo.
- Sin rewards: estado contextual con nombre de organizacion.
- Reward agotado: CTA deshabilitado y razon “Agotado”.
- Reward vencido/no iniciado: CTA deshabilitado con razon segura.
- Saldo insuficiente: mostrar faltante en la moneda correcta.
- `max_per_user` alcanzado: CTA deshabilitado.
- Sin relacion economica: la organizacion no aparece; acceso directo retorna resultado no autorizado/no encontrado sin filtrar existencia sensible.
- Error parcial de una comunidad: informar el catalogo afectado; no descartarlo silenciosamente.
- Loading: skeletons para comunidades, saldo, catalogo y detalle.
- Error de canje: mensaje util y seguro; no exponer SQL, nombres de tablas o reglas internas.

## 23. Responsive

QA obligatorio en 1440, 768 y 375 px.

Validar:

- Navegacion DadoFit / Mis comunidades.
- Lista o selector de organizaciones.
- Encabezado y branding Partner.
- Saldo y denominacion.
- Grid/cards de rewards.
- Modal desktop.
- Bottom sheet mobile con scroll interno y safe area.
- CTA fijo o visible sin tapar contenido.
- Historial y filtros.
- Management, analytics y validation existentes.
- Tablas con scroll controlado y sin overflow de pagina.

No duplicar markup funcional entre modal y bottom sheet; solo adaptar presentacion.

## 24. Accessibility

- Tabs con `role="tablist"`, `role="tab"`, `aria-selected` y panel asociado, o botones con `aria-pressed` si el patron final es filtro.
- Selector de comunidad con nombre accesible y estado seleccionado.
- Dialog desktop con `role="dialog"`, `aria-modal`, titulo asociado, focus trap, Escape y retorno de foco.
- Bottom sheet con la misma semantica de dialog y cierre accesible.
- Confirmacion de canje explicita; no depender de `window.confirm` como solucion final.
- Focus visible en botones, enlaces, inputs, selects y textareas.
- Imagen de reward con alt util o decorativo deliberado segun contexto.
- Estados disabled reales con razon visible.
- Loading anunciado sin bloquear lectores de pantalla indefinidamente.
- Errores con `role="alert"`; exito con `role="status"`/`aria-live`.
- Icono/color Partner nunca son el unico indicador.
- Graficos con resumen o tabla alternativa.
- Targets tactiles adecuados en 375 px.
- Respetar `prefers-reduced-motion`.

## 25. Casos limite

- Usuario con multiples wallets de organizaciones del mismo tipo.
- Wallet existente con saldo cero.
- Wallet historica y membresia Gym finalizada.
- Brand/Company sin membresia pero con puntos legitimos.
- Organizacion suspendida despues de emitir una redencion.
- `enabled=false` mientras el detalle esta abierto.
- Reward agotado entre apertura y confirmacion.
- Dos canjes concurrentes por la ultima unidad/codigo.
- Pool con inventario nominal pero sin codigos disponibles.
- `max_per_user` alcanzado por una operacion concurrente.
- Reward vence entre carga y confirmacion.
- Config Partner ausente o con branding invalido.
- Organizacion eliminada/suspendida con historial existente.
- Deep link/query a una organizacion no elegible.
- Respuesta parcial cuando una comunidad falla.
- Nombres largos, caracteres Unicode y colores con contraste insuficiente.
- Campos legacy GP/SP presentes en datos historicos.

En todos los casos, `redeem_reward` vuelve a validar y prevalece sobre el estado mostrado.

## 26. No regresion

Debe mantenerse:

- Marketplace DadoFit y pago exclusivo DC.
- Balances, ledgers y score existentes.
- Rewards y redenciones historicas.
- `redeem_reward` atomico.
- Stock e inventario.
- `max_per_user`.
- Generated/shared/code pool.
- QR y fulfillment fisico/presencial.
- URLs e instrucciones post-canje autorizadas.
- Gestion Owner/Admin actual.
- Analytics Partner actual, corrigiendo semantica sin perder datos.
- Rutas `/rewards`, `/rewards/manage`, `/rewards/analytics`, `/rewards/validate` y `/admin/rewards`.
- Permisos SuperAdmin vigentes.
- Separacion de Competitive Score frente a saldo gastable.

No migrar destructivamente GP/SP ni recalcular saldos.

## 27. Fuera de alcance

- Nueva moneda o wallet fisica.
- Conversion Partner Points <-> DC.
- Transferencia P2P.
- Cash-out, crypto o mixed payment.
- Marketplace cross-partner.
- Expiracion automatica de Partner Points.
- Reescritura de fulfillment.
- Migracion destructiva de GP/SP.
- Refund, reversal o cancelacion financiera. Requiere SPEC operativa independiente.
- Nueva herramienta SuperAdmin para administrar Marketplace DadoFit.
- Ruta nueva de reward detail.
- Theme engine por partner.
- Seeds productivos artificiales de Nike/Titanes.
- Nuevo BI o data warehouse.

## 28. Archivos / sistemas afectados

Cambios previstos para una futura implementacion, sujetos a aprobacion:

| Sistema/archivo | Cambio esperado |
|---|---|
| Nueva migracion aditiva Supabase | DTOs seguros, discovery, fachada wallet, guards, gobierno config y analytics |
| `src/pages/RewardsMarketplacePage.tsx` | Navegacion por comunidad, catalogo autoritativo, detalle e historial contextual |
| `src/pages/RewardManagementPage.tsx` | Config de presentacion y limpieza de semantica DC legacy |
| `src/pages/RewardAnalyticsPage.tsx` | Metricas y copy Partner correctos |
| `src/pages/WorkspaceHomePage.tsx` | Accesos operativos minimos a gestion/analytics/validacion sin duplicar superficies |
| `src/pages/AdminPage.tsx` | Compatibilidad minima de analytics/estado enabled, sin nueva herramienta DadoFit |
| `src/lib/partnerPoints.ts` | Contratos/fachada unificada y branding seguro |
| Tipos compartidos de rewards | DTOs de catalogo, comunidad, detalle e historial |
| Estilos marketplace existentes | Tabs, community selector, dialog/sheet y estados responsive |
| Tests SQL | RLS, secretos, cross-org, enabled, stock y concurrencia |
| Tests frontend | Discovery, detalle, historial, a11y y estados |

Intocables salvo correccion minima aprobada:

- Algoritmo base de fulfillment.
- Ledgers historicos.
- Competitive Score.
- Rutas publicadas.
- Refund/cancelacion.

## 29. Criterios de aceptacion

1. `/rewards` presenta DadoFit y Mis comunidades sin mezclar monedas.
2. Discovery proviene de backend y solo incluye relaciones economicas validas.
3. Gym aparece por membresia activa o wallet/actividad historica valida.
4. Brand/Company aparece sin membresia cuando existe wallet/actividad legitima.
5. Una organizacion sin relacion economica no aparece.
6. Cada marketplace muestra saldo, config y rewards de un solo `organization_id`.
7. DTOs de catalogo no contienen secretos de fulfillment.
8. Stock, vigencia, limite, redenciones propias y elegibilidad vienen del backend.
9. `enabled=false` bloquea nuevas emisiones, publicaciones/activaciones, catalogo y canjes.
10. `enabled=false` preserva balances, ledgers, score, historico, redenciones, fulfillment y analytics.
11. Owner/Admin solo edita presentacion; SuperAdmin controla `enabled`.
12. Detail funciona como modal desktop y bottom sheet mobile.
13. Detail muestra toda la informacion publica requerida y confirmacion.
14. Historial se filtra inicialmente por organizacion y permite “Todos”.
15. `redeem_reward` sigue siendo autoridad final y unico flujo de canje.
16. DC no paga Partner; Partner Points no pagan DadoFit; puntos A no pagan reward B.
17. Constraints/guards rechazan combinaciones invalidas incluso en escrituras privilegiadas.
18. Fulfillment privado solo aparece despues del canje a actores autorizados.
19. Analytics usa moneda, importe y organizacion efectivos.
20. Owner/Admin no accede a rewards, codigos, redenciones o analytics de otra organizacion.
21. QA responsive y accesibilidad pasa en los viewports definidos.
22. No se crea nueva wallet, moneda, ruta de detalle o herramienta DadoFit Admin.
23. Config ausente usa branding fallback pero equivale a economia deshabilitada.
24. Solo `gym`, `brand` y `company` resuelven una implementacion Partner soportada.
25. Reward DadoFit exige `organization_id IS NULL`; reward Partner exige valor no nulo.
26. Lectura directa, RPCs legacy, views, overloads y eventos no exponen secretos pre-canje.
27. DTOs Owner/Operator aplican autorizacion dentro de la query y no permiten enumeracion.
28. Auditoria previa documenta y resuelve/cuarentena inconsistencias antes de validar constraints.
29. `redeem_reward` conserva autoridad unica, locks, atomicidad y rollback integral.
30. Los contratos frontend se derivan de DTOs centralizados y no recalculan elegibilidad critica.
31. Branding usa fallback seguro, icono validado y contraste accesible sin alterar `enabled`.
32. Organizaciones con historia se suspenden logicamente y conservan snapshots historicos seguros.

## 30. Plan QA

### Datos

- Buscar dos organizaciones reales aptas en el ambiente.
- Preferir una Gym y una Brand/Company cuando sea posible.
- Si no existen dos aptas, crear fixtures aislados de test; no insertar organizaciones productivas arbitrarias.

### Casos obligatorios

| Caso | Escenario | Resultado |
|---|---|---|
| A | Nike Points -> Nike reward | Permitido |
| B | Titanes Points -> Nike reward | Bloqueado backend |
| C | DC -> Nike reward | Bloqueado backend |
| D | Nike Points -> DadoFit reward | Bloqueado backend |
| E | Economia Partner disabled | Catalogo/canje bloqueados; historico preservado |
| F | Reward agotado | Bloqueado |
| G | `max_per_user` alcanzado | Bloqueado |
| H | Reward vencido | Bloqueado |
| I | Usuario Brand sin membership pero con wallet valida | Marketplace visible |
| J | Usuario sin relacion economica | Marketplace ausente |
| K | Inspeccion DTO catalogo | Sin `shared_code`, URL privada ni secretos |
| L | Consulta fulfillment | Solo despues de redencion y con actor autorizado |
| M | Gym con membership activa sin wallet | Visible; balance 0; operacion segun catalogo/config |
| N | Gym con membership historica y actividad | Visible como `OPERATIONAL` o `HISTORY_ONLY` segun tabla normativa |
| O | Wallet valida con balance 0 y relacion valida | Visible; canje bloqueado si saldo insuficiente |
| P | `partner_point_configs` ausente | Branding fallback; `DISABLED`; sin nuevas operaciones |
| Q | Organizacion suspendida | `HISTORY_ONLY`; sin catalogo/canje; fulfillment emitido preservado |
| R | Organizacion no verificada/inactiva | No operacional conforme estados reales |
| S | Owner/Admin intenta cambiar `enabled` | Bloqueado backend |
| T | SuperAdmin cambia `enabled` | Permitido y auditado |
| U | Emision con `enabled=false` | Bloqueada en todos los emisores |
| V | Publicacion/activacion con `enabled=false` | Bloqueada backend |
| W | Detail abierto y economia deshabilitada antes del canje | `redeem_reward` bloquea y no debita |
| X | `starts_at` futuro | Bloqueado con `NOT_STARTED` |
| Y | Pool vacio con inventario nominal | Bloqueado con `CODE_POOL_EMPTY` |
| Z | Dos canjes por ultima unidad | Solo uno completa |
| AA | Dos canjes por ultimo codigo | Solo uno recibe el codigo |
| AB | `max_per_user` concurrente | Limite preservado |
| AC | Fallo de fulfillment durante canje | Rollback completo |
| AD | `SELECT`/RPC/view legacy intenta obtener secretos | Denegado o DTO allowlisted |
| AE | Matriz fulfillment por actor | Owner de redencion y operadores autorizados pasan; resto bloqueado |
| AF | `coin_cost != payment_amount` | Analytics usa pago efectivo |
| AG | Deep link a org no elegible | Respuesta segura no enumerable |
| AH | Multiples wallets/orgs | No existe suma ni gasto cross-org |
| AI | Metadata/event snapshots | Sin secretos accesibles; remediacion verificada |
| AJ | DadoFit reward con `organization_id != NULL` | Rechazado |
| AK | Partner reward con `organization_id NULL` | Rechazado |

Nike/Titanes son nombres ilustrativos. Sustituir por organizaciones reales del ambiente en la ejecucion QA.

### Seguridad/backend

- Tests de Member, Coach, Owner, Admin y SuperAdmin.
- Acceso directo a org ajena.
- Escritura privilegiada inconsistente.
- Concurrencia por ultima unidad y ultimo codigo.
- Catalogo y fulfillment con allowlists.
- RLS sobre redenciones/codigos/eventos.
- `enabled` en todos los puntos de entrada.
- Matriz own/cross-org para rewards, redemptions, fulfillment, codes, events, analytics y config.
- Grants, overloads, owners, `SECURITY DEFINER`, `search_path` y schema qualification.
- Escrituras service role para cada invariante cross-org.
- Ausencia de secretos en eventos/snapshots historicos.

### Frontend

- Discovery, seleccion y cambio DadoFit/Partner.
- Saldo cero, insuficiente y actualizado tras canje.
- Modal/sheet, Escape, trap y retorno de foco.
- Historial contextual y “Todos”.
- Empty/loading/error.
- 1440, 768 y 375 px.
- Teclado y lector de pantalla basico.
- `prefers-reduced-motion`, contraste de color dinamico, targets tactiles y alternativa accesible de graficos.
- Contenido completo del detail y refresco de saldo/catalogo/historial tras canje.

### No regresion

- Marketplace DadoFit.
- Management, analytics y validation.
- QR/codigos/URLs.
- Inventario, limites y vigencia.
- Wallets, ledgers y Competitive Score.

## 31. Tasks

1. `T01 - Auditoria integral`: inventariar datos inconsistentes, RPCs/overloads, views, grants, owners, policies, funciones `SECURITY DEFINER`, secretos copiados, consumidores legacy y todos los emisores GP/SP. Entregable: reporte reproducible con conteos, clasificacion y remediacion propuesta. Bloquea T03-T10.
2. `T02 - DTOs y contratos seguros`: definir tipos exactos de discovery, balance, catalogo, historial, fulfillment owner/operator y enums. Reemplazar `SETOF rewards`/`SELECT *`; congelar version de contrato. Depende de T01 y bloquea frontend.
3. `T03 - Cierre de exposicion y hardening`: revocar lectura/grants inseguros, migrar consumidores, endurecer RLS, overloads, owners, `EXECUTE`, `SECURITY DEFINER`, `search_path` y schema qualification. Remediar acceso a secretos historicos sin destruir auditoria necesaria. Depende de T01-T02.
4. `T04 - Datos e integridad cross-org`: reparar o poner en cuarentena inconsistencias; agregar constraints `NOT VALID`, resolucion cerrada Gym/Brand/Company, trigger endurecido, pruebas privilegiadas y `VALIDATE CONSTRAINT`. Depende de T01 y T03.
5. `T05 - Gobierno config y enabled`: separar RPC Owner/Admin de RPC SuperAdmin, revocar firma insegura, tratar config ausente como disabled e imponer `enabled` en todos los emisores, publicacion/activacion, discovery, catalogo y canje. Preservar historico. Depende de T01, T03 y T04.
6. `T06 - Discovery y balance facade`: implementar tabla normativa, enum `relationship_reason`, deduplicacion, estados y fachada de wallets sin migrar saldos. Depende de T02, T04 y T05.
7. `T07 - Catalogo autoritativo`: entregar allowlist, stock/pool, vigencia, consumo propio, saldo, eligibility y `blocked_reason`; impedir enumeracion. Depende de T02, T05 y T06.
8. `T08 - redeem_reward`: conservarlo como unico flujo; aplicar config/estado bajo validacion autoritativa y verificar locks, debito, stock, limites, codigo, fulfillment, ledger, redencion, auditoria y rollback. Depende de T04-T07.
9. `T09 - Historial y fulfillment seguro`: agregar snapshots historicos, filtro opcional de organizacion, DTOs owner/operator, autorizacion dentro de query y lookup sin oracle. Depende de T02-T04 y T08.
10. `T10 - Analytics`: corregir `admin_reward_analytics`, `provider_reward_analytics`, Partner Points analytics y consumidores para usar pago efectivo; documentar compatibilidad legacy. Depende de T04, T05 y T09.
11. `T11 - Frontend marketplace`: centralizar tipos DTO, eliminar recomputacion local y catalogo mixto; implementar landing DadoFit/Mis comunidades/organizacion e historial contextual. Depende de T02 y T06-T10.
12. `T12 - Branding y detail`: aplicar branding validado y componente unico modal/bottom-sheet con terminos publicos, elegibilidad y confirmacion. Depende de T07 y T11.
13. `T13 - Partner management`: UI de presentacion, retiro de precio DC editable, estados enabled y accesos operativos sin ampliar permisos. Depende de T05 y T10-T12.
14. `T14 - Accesibilidad/responsive/states`: tabs/dialog, foco, live regions, errores seguros, loading/empty/disabled, contraste, reduced motion y 1440/768/375. Depende de T11-T13.
15. `T15 - Tests SQL/security/concurrency`: cubrir matriz RBAC, grants, secretos, invariantes, enabled, discovery, atomicidad, ultima unidad/codigo, limite concurrente, rollback y analytics. Depende de T03-T10.
16. `T16 - Tests frontend`: cubrir navegacion, branding, detail, historial, management, estados, responsive y a11y. Depende de T11-T14.
17. `T17 - QA integral`: ejecutar A-AK con dos organizaciones reales o fixtures aislados y la matriz de no regresion; adjuntar evidencia. Depende de T15-T16.
18. `T18 - Cierre SDD`: actualizar estado, resultados, issues, migraciones ejecutadas y DoD. Depende de T17.

No crear tasks para refund, conversion, wallet nueva, ruta de detalle, borrado fisico historico o nueva administracion DadoFit.

### 31.1 Estado de implementacion y evidencia

- `T01-T14`: implementados. Auditoria reproducible en `docs/MARKETPLACE_PARTNER_001_BACKEND_AUDIT.md`; backend aditivo en `supabase/migrations/20261016120000_marketplace_partner_001_backend.sql`; frontend y contratos en los archivos indicados por esta SPEC.
- `T15`: implementado en `supabase/tests/marketplace_partner_001.sql`. Reset limpio y pgTAP: **41/41 PASS**. Cubre RBAC, grants, DTOs, secretos persistidos, config, discovery, canje/rollback, snapshots, wallet guards y analytics. La concurrencia multisesion real permanece como prueba de integracion pendiente.
- `T16`: helpers frontend cubiertos por Vitest. Suite completa: **13 archivos, 144/144 PASS**. No existe aun suite component/E2E para todos los flujos visuales.
- `T17`: QA automatizable ejecutado el 2026-10-16: `npm test` PASS, `npm run build` PASS, `git diff --check` sin errores y `node scripts/check-supabase.mjs` PASS. Pendientes QA manual A-AK, 1440/768/375, lector de pantalla y dos organizaciones reales.
- `T18`: SPEC y evidencia actualizadas. No se declara `QA COMPLETE` mientras existan los pendientes manuales anteriores.
- Migracion local verificada desde base limpia: `20261016120000_marketplace_partner_001_backend.sql`. El remoto permanece en `v15.7.21-eco4h-economy-operations`; no se ejecuto deploy ni `db push`.
- Build Vite generado correctamente. Warning no bloqueante: chunk principal de aproximadamente 875 kB supera el umbral de 500 kB.
- `supabase db lint --level warning` no reporto hallazgos en la nueva migracion. Conserva warnings legacy en funciones de ad analytics y el error legacy ambiguo de `eco4c_grant_dc`.
- Tipos Partner soportados por decision cerrada: `gym`, `brand`, `company`. El tipo legacy `sponsor` no entra a discovery/config/canje de MARKETPLACE-PARTNER-001 y no se migra implicitamente.
- No se realizo commit ni push.

## 32. Definition of Done

- [x] DTOs de discovery, balance, catalogo, historial y fulfillment usan allowlist y no exponen secretos.
- [x] Discovery es backend-authoritative y cumple la tabla Gym/Brand/Company.
- [x] Fachada Partner Points conserva wallets y ledgers existentes.
- [x] `enabled=false` bloquea nuevas operaciones y preserva todo el historico.
- [x] Gobierno de configuracion separa presentacion Partner de control SuperAdmin.
- [x] Catalogo entrega saldo, stock, vigencia, limite, consumo y elegibilidad autoritativos.
- [x] Cross-org queda protegido por RPC, RLS y constraints/guards de persistencia.
- [x] Auditoria T01 adjunta evidencia; inconsistencias se auditan/cuarentenan y constraints se validan cuando el entorno esta limpio.
- [x] Lectura directa, RPCs/views legacy, overloads y snapshots no exponen secretos.
- [x] Matriz RLS/grants/`SECURITY DEFINER` automatizada pasa por rol y organizacion.
- [x] `redeem_reward` demuestra atomicidad y rollback en pgTAP; concurrencia multisesion queda pendiente de integracion.
- [ ] Reward detail modal/sheet cumple contenido, responsive y accesibilidad en QA manual.
- [x] Historial contextual por organizacion funciona dentro de `/rewards` segun contratos y build.
- [x] Fulfillment privado solo es visible post-canje para actores autorizados.
- [x] Analytics usa pago efectivo y conserva compatibilidad requerida.
- [x] Owner/Admin solo gestiona su organizacion; Coach/Member no administran.
- [x] Marketplace DadoFit conserva pago DC y comportamiento vigente en contratos automatizados.
- [x] Tests SQL y frontend pasan.
- [ ] QA A-AK pasa con evidencia.
- [ ] Responsive 1440/768/375 y accesibilidad pasan.
- [x] No hay regresion automatizada detectada en fulfillment, stock, limites, wallets, ledgers o score; QA manual permanece pendiente.
- [x] Analytics coincide con pago efectivo cuando `coin_cost != payment_amount`.
- [ ] Branding fallback, icono permitido y contraste pasan sin alterar `enabled` en QA visual manual.
- [x] No se implementan refund, mixed payment, wallet nueva ni nueva herramienta DadoFit Admin.
- [x] SPEC actualizada al cierre de implementacion automatizable.
- [x] Commit/push solo bajo solicitud explicita.

---

*SPEC MARKETPLACE-PARTNER-001 - IMPLEMENTED / AUTOMATED QA COMPLETE / MANUAL QA PENDING. Decisiones funcionales pendientes: NONE. Deploy remoto, QA visual/a11y y concurrencia multisesion pendientes.*
