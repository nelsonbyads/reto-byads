# AGENT.md — DadoFit Project Continuation Guide

## 1. Objetivo de este archivo

Este archivo sirve como **handoff completo del proyecto DadoFit** para continuar el desarrollo en otro chat/agente sin perder contexto.

El agente debe actuar como **socio técnico de producto**, no como simple generador de código.

Principios:

- preservar lo que ya funciona;
- trabajar incrementalmente;
- entregar ZIPs pequeños;
- validar cada milestone;
- evitar regresiones;
- diagnosticar con evidencia real;
- proteger reglas de negocio en backend;
- pensar siempre en producto, operación y monetización.

## 1.1 Regla de autoridad documental — DadoFit 2.1

Para economía y rewards, usar este orden de autoridad:

```text
1. repositorio real / migraciones aplicadas
2. docs/DADOFIT_2_1_ECONOMY_AUDIT.md
3. este AGENT.md
4. documentación histórica anterior
```

Si existe contradicción, no asumir: verificar código y migraciones reales.

Modelo económico oficial desde 2.1:

```text
XP = progreso no gastable
DadoCoins = única moneda universal
Partner Points = puntos gastables por organización
Competitive Score = histórico separado del wallet
```

---

# 2. Proyecto

Nombre:

```text
DadoFit
```

Concepto:

```text
Fitness + Juego + Social + Competencia + Recompensas + Marcas
```

Loop principal:

```text
Entrenar
→ lanzar dados
→ ejercicio + repeticiones
→ subir evidencia
→ completar
→ retar / competir
→ recibir recompensas
→ ganar DadoCoins
→ canjear premios
```

---

# 3. Repositorio

Repositorio GitHub:

```text
https://github.com/nelsonbyads/reto-byads.git
```

Branch principal:

```text
main
```

Ruta local habitual:

```text
C:\Users\USUARIO\Documents\Dice-Fitness\reto-byads
```

---

# 4. Estructura base

```text
reto-byads/
├── .git/
├── data/
├── images/
├── videos/
├── public/
├── scripts/
├── src/
├── supabase/
├── docs/
├── docker/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .gitignore
├── .env.local
├── .env.example
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── LICENSE
├── NOTICE.md
└── README.md
```

NO existe subcarpeta oficial `dice-app/`.

---

# 5. Stack tecnológico

Frontend:

```text
React 18
TypeScript
Vite
React Router DOM
Lucide React
CSS custom
localStorage
```

Backend / BaaS:

```text
Supabase
PostgreSQL
Supabase Auth
Supabase Storage
RLS
RPCs
SECURITY DEFINER
SQL migrations
```

Testing:

```text
Vitest
TypeScript build
Vite build
```

Infraestructura:

```text
Docker
Docker Compose
Node 22 builder
Nginx runtime
Git
GitHub
```

---

# 6. Desarrollo local

Vite:

```text
http://localhost:5175
```

Comandos mínimos:

```bash
npm test
npm run build
npm run dev
```

---

# 7. Docker

URL:

```text
http://localhost:8781
```

Build recomendado:

```bash
docker compose --env-file .env.local down --remove-orphans
docker compose --env-file .env.local build --no-cache
docker compose --env-file .env.local up -d --force-recreate
docker compose --env-file .env.local ps
```

Builder Node:

```text
Node 22
```

No ejecutar:

```bash
npm audit fix --force
```

sin una razón concreta.

---

# 8. Supabase

Proyecto:

```text
DadoFit Development
```

Project ref:

```text
hobsttxpvgxqneqaynyi
```

URL:

```text
https://hobsttxpvgxqneqaynyi.supabase.co
```

Variables:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Nunca:

- publicar keys privadas;
- pedir service role innecesariamente;
- exponer database password;
- meter `.env.local` en ZIPs.

Health:

```bash
node scripts/check-supabase.mjs
```

---

# 9. Regla de migraciones

Nunca modificar una migración que ya aparece como aplicada en:

```bash
npx supabase migration list
```

Si Local + Remote tienen el mismo timestamp:

```text
NO editar y esperar que vuelva a correr.
```

Crear otra migración:

```text
YYYYMMDDHHMMSS_fix_description.sql
```

Si existe inconsistencia:

```text
crear migración de reconciliación
```

No borrar historial.

---

# 10. Identidad, roles y workspaces

Principio central:

```text
IDENTIDAD
≠
ROL
≠
WORKSPACE
≠
PERMISO GLOBAL
```

Una persona puede tener:

```text
Mi perfil
Gym
Marca
```

Ejemplo selector:

```text
Mi perfil
Titanes
Nike
```

SuperAdmin es independiente:

```text
Owner Nike ≠ SuperAdmin DadoFit
Owner Titanes ≠ SuperAdmin DadoFit
```

---

# 11. Roles de organización

Roles:

```text
owner
admin
coach
member
```

Reglas generales:

```text
Owner/Admin
→ administración completa

Coach
→ gestión operativa en ciertas funciones

Member
→ participación
```

Para Rewards:

```text
Owner/Admin
→ crear/editar/publicar ofertas

Coach
→ NO

Member
→ NO
```

---

# 12. Workspaces actuales

## Personal

Menú conceptual:

```text
Entrenar
Retos
Premios
Más
```

Dentro de Más:

```text
Gymbros
Squads
Organizaciones
Patrocinados
```

El header se volvió compacto porque en resoluciones laptop quedaba demasiado apretado.

## Gym

Ejemplo:

```text
Titanes
```

Dashboard:

```text
Dashboard
Ofertas
Retos
Gym vs Gym
Equipo
```

## Brand

Ejemplo:

```text
Nike
```

Funciones:

```text
Dashboard
Campañas
Retos patrocinados
Ofertas
Auditoría
Equipo
```

---

# 13. SuperAdmin

Ruta:

```text
/admin
```

Módulos:

```text
Dashboard
Usuarios
Organizaciones
Marcas
Campañas
Solicitudes
Publicidad
Auditoría
```

SuperAdmin está separado de roles de organización.

Acceso no autorizado probado:

```text
Owner Nike        ❌ /admin
Owner Titanes     ❌ /admin
Perfil normal     ❌ /admin
SuperAdmin        ✅ /admin
```

---

# 14. Estado de versiones

Completado y validado históricamente:

```text
V8      MVP Individual
V9.0    Social Foundation
V9.1    Real Auth & Profiles
V9.2    Gymbros
V10     1v1 Challenges + Reward Engine
V10.1   Docker + Supabase
V10.2   Anti-Farming 1v1
V11     Squads + Group vs Group
V11.1   Squad Anti-Farming
V11.2   Social Dashboard + Notifications
V11.2.1 Migration-order health hotfix
V11.3   Notifications + Evidence Guard
V12.0   Organizations / Gyms Foundation
V12.1   Gym vs Gym
V12.2   Identity + Workspaces + RBAC
V13     Brands / Sponsors / Branded Challenges
V13.1   Exercise Catalog Picker
V13.2   Sponsored Goal Types
V13.2.1 Sponsored review history hotfix
V13.3   UX/UI + Brand Governance
V13.3.1 UX/Notifications Hotfix
V13.4   Final UX/UI Polish
V13.4.1 Final Polish Hotfix
V13.5   Responsive Monetization
V13.5.1 Multi-slot Desktop Ads
V14     SuperAdmin Backoffice
V14.1   Footer + Legal Center
V14.1.1 Legal Footer Pre-login
V14.2   Global Monetized Shell
V14.2.1 Campaign RPC + visual hotfix
V14.3   Rotating Billboard Ads
V14.4   Ad Analytics
V14.4.1 Analytics reconcile
V14.4.2 Health schema sync
V14.5   Ad Campaign Management
V14.6   Responsive Ad Fallback
V15.0   Rewards Marketplace Foundation
V15.1   Reward Fulfillment + Coupon Inventory
V15.2   QR / Physical Reward Fulfillment
V15.2.1 Filter Overlay + Instructions Legibility
V15.2.2 Gym Reward Offer Notifications
V15.3   Gym Challenge Economy + Reward Clarity
V15.4   Rewards Analytics Partner/Gym + SuperAdmin
V15.4.1 Responsive Header Hotfix
V15.7   Unified Challenges + TP/GP Seasons + Sponsored Gym Competitions
ECO-1   Sponsor Point Wallets / Sponsor economy foundation
ECO-2   Gym Point Wallets + score-to-wallet separation
ECO-3   Rewards multi-currency payment foundation
```

Estado real confirmado por auditoría 2.1:

```text
La base ECO-1 / ECO-2 / ECO-3 ya existe en código y migraciones.
La economía 2.1 NO parte de cero.
No se considera terminada la migración conceptual a Partner Points.
No existe todavía gobierno formal de presupuesto/cupo DC por convenio.
```

Milestone actual:

```text
DadoFit / Reto ByAds Reloaded 2.1
ECO-4A — PARTNER ECONOMY FOUNDATION ✅
ECO-4B — DC Budget Governance ✅
ECO-4C — CHALLENGE REWARD BUDGET ENFORCEMENT
SIGUIENTE PASO
```

Fuente de verdad para esta fase:

```text
docs/DADOFIT_2_1_ECONOMY_AUDIT.md
+ repositorio real
+ este AGENT.md actualizado
```

# 15. Flujo de trabajo oficial

El usuario prefiere:

```text
Agente analiza
→ implementa cambio
→ entrega ZIP pequeño
→ usuario reemplaza
→ migraciones
→ npm test
→ npm run build
→ npm run dev
→ pruebas click-by-click
→ screenshots
→ diagnóstico
→ hotfix si hace falta
→ Docker al final
→ Git checkpoint
```

No pedirle al usuario que reconstruya manualmente muchos cambios de código.

Preferir:

```text
ZIP incremental
```

---

# 16. ZIPs

Cada ZIP debe contener únicamente lo necesario.

Sí:

```text
src/
supabase/migrations/
scripts/
docs/
```

No:

```text
node_modules
.git
dist
data/
images/ masivas
videos/
.env.local
secretos
```

---

# 17. Economía DadoFit — modelo oficial 2.1

A nivel de producto, DadoFit 2.1 expone únicamente cuatro conceptos económicos/de progreso:

```text
XP
DADOCOINS (DC)
PARTNER POINTS
COMPETITIVE SCORE
```

Solo **DadoCoins** y **Partner Points** son gastables.

```text
XP                → progreso personal; no se gasta
DadoCoins         → única moneda universal de DadoFit
Partner Points    → puntos gastables propios de cada organization_id
Competitive Score → ranking/temporadas; no se gasta
```

Los identificadores históricos `TP`, `GP`, `SP`, `team_points`, `gym_points` y `sponsor_points` pueden seguir existiendo internamente mientras dure la compatibilidad técnica, pero **NO son economías visibles ni monedas adicionales del producto 2.1**.

## XP

```text
Progreso personal
No es moneda
No se gasta
```

Persistencia actual:

```text
user_progress.xp
progress_transactions
```

XP puede participar en progresión, nivel, streaks y métricas personales, pero no paga rewards.

## DC — DadoCoins

DadoCoins es la **única moneda universal** de DadoFit.

Reglas oficiales:

```text
- un único saldo global por usuario;
- pertenece a DadoFit;
- no pertenece a Gym, Brand ni Sponsor;
- no es crypto;
- no es cash;
- no es P2P;
- no es transferible entre usuarios;
- Partner Points NO se convierten a DC;
- un Partner NO puede emitir DC libremente.
```

Persistencia actual:

```text
wallets
wallet_transactions
```

El ledger de DC es obligatorio. El frontend nunca modifica saldos directamente.

Principio de gobierno 2.1:

```text
DadoFit es el emisor y gobernador de DadoCoins.
```

Los retos oficiales pueden entregar DC y los retos/campañas de Partner solo pueden hacerlo con presupuesto aprobado por DadoFit.

Regla final 2.1:

```text
TODO payout de DC debe consumir un DC Budget válido.
```

Para retos propios de DadoFit se usa un **budget interno DadoFit**. Para convenios se usa un budget asociado a campaña/partner. Los caps y el anti-farming siguen existiendo, pero no sustituyen el presupuesto de emisión.

## Partner Points

`Partner Points` es el **único concepto de producto** para puntos gastables de organizaciones.

Ejemplos visibles:

```text
Titanes Gym → Titanes Points
Nike        → Nike Points
Adidas      → Adidas Points
```

Cada organización puede configurar:

```text
points_name
points_short_name
points_icon
points_color
enabled
```

Reglas:

```text
- pertenecen a una organization_id;
- son saldo gastable;
- no son universales;
- no se comparten entre organizaciones;
- no se convierten a DC;
- cada Partner gobierna únicamente sus propios puntos;
- se canjean únicamente en el Marketplace de ese Partner.
```

Infraestructura física legacy reutilizada durante 2.1:

```text
gym_point_wallets
gym_point_ledger
sponsor_point_wallets
sponsor_point_ledger
```

Estas tablas son implementación interna. **No significan que el producto tenga monedas GP y SP.** No renombrarlas destructivamente en 2.1; abstraerlas detrás del dominio Partner Points.

## Competitive Score

El score competitivo es una dimensión separada de la economía gastable. Sirve para rankings, temporadas y competencias.

Persistencia histórica actual puede incluir:

```text
score_events.team_points
score_events.gym_points
score_events.sponsor_points   -- legacy GP mirror
group_scores
organization_scores
```

Reglas:

```text
- no es wallet;
- no se gasta;
- no aparece como moneda;
- gastar Partner Points nunca reduce el score;
- TP/GP históricos son nombres técnicos/legacy de score, no productos económicos visibles.
```

## Legacy GP / SP / TP

A partir de DadoFit 2.1:

```text
GP / SP gastables en tablas existentes
→ implementación legacy de Partner Points

TP / GP de score
→ implementación legacy de Competitive Score
```

ATENCIÓN — legacy crítico:

```text
challenges.sponsor_points
score_events.sponsor_points
```

NO representan los Partner Points de una Brand. Funcionan como compatibilidad/espejo legacy de score de Gym.

Los Partner Points reales de una Brand/Sponsor se apoyan actualmente en:

```text
sponsor_point_wallets
sponsor_point_ledger
challenge_participants.sponsor_reward_points_granted
```

No interpretar nombres legacy por su etiqueta histórica.

## Saldo vs score histórico

Siempre separar:

```text
balance
lifetime_earned
lifetime_spent
competitive_score
```

Ejemplo:

```text
Titanes Points

lifetime_earned   1840
lifetime_spent     600
balance           1240
competitive_score 1840
```

Si el usuario gasta 500:

```text
balance            740
competitive_score 1840
```

El ranking NO baja por un canje.

# 18. DadoCoins — fuentes actuales y gobierno 2.1

El backend actual ya emite DC mediante RPCs con caps, idempotencia, locks y anti-farming. Esto se conserva.

Lo nuevo en 2.1 es distinguir:

```text
CAP DE RECOMPENSA
!=
PRESUPUESTO DE EMISIÓN
```

Un límite como `máx. 50 DC por aprobación` no reemplaza un presupuesto comercial.

## Retos 1 vs 1

Aprobación elegible actual:

```text
hasta 25 DC
hasta 50 XP
```

Anti-farming existente se conserva.

## Squad battles

Aprobación elegible actual:

```text
hasta 25 DC
hasta 50 XP
hasta 100 TP
```

TP es score competitivo, no Partner Points.

## Retos de Gym / Organización

Aprobación actual puede configurar:

```text
0..25 DC
0..50 XP
0..100 GP
```

En 2.1:

```text
GP gastable
→ se presenta conceptualmente como Partner Points del Gym
```

Si el Gym entrega DC, esa emisión deberá quedar sujeta al modelo de autorización/presupuesto DadoFit cuando se implemente la capa 2.1.

## Gym vs Gym

Puede otorgar actualmente:

```text
DC
XP
GP / score de Gym
```

Conservar score histórico separado del saldo gastable.

## Retos patrocinados

Actualmente pueden otorgar:

```text
0..50 DC
0..100 XP
0..500 SP reales
```

En 2.1:

```text
SP gastable
→ Partner Points de la Brand/Sponsor
```

Y DC:

```text
solo con presupuesto/cupo aprobado por DadoFit
```

Ejemplo objetivo:

```text
DadoFit x Nike
+250 XP
+50 DC            ← presupuesto DadoFit/convenio
+150 Nike Points  ← economía Nike
```

## Invariante

```text
COMPLETAR UN RETO
!=
TENER DERECHO A RECOMPENSA
```

Anti-farming, presupuesto agotado, vigencia, elegibilidad o idempotencia pueden producir aprobación con payout parcial o cero según reglas de negocio.

# 19. Anti-farming

Una aprobación puede quedar:

```text
APROBADO
```

pero con:

```text
0 DC
0 XP
0 TP/GP
```

si anti-farming bloquea la recompensa.

Debe mostrarse claramente al usuario.

Nunca engañar visualmente mostrando una recompensa potencial como si hubiera sido otorgada.

---

# 20. ISSUE CERRADO — Organization Challenges Reward Clarity

Cerrado en V15.3.

La UI diferencia ahora:

```text
Recompensa potencial
vs
Recompensa otorgada
```

Si anti-farming bloquea payout:

```text
Reto aprobado · sin recompensa
0 DC · 0 XP · 0 GP
```

No volver a mostrar recompensa potencial como si hubiera sido entregada.
# 21. ISSUE CERRADO — Configuración de recompensa al crear reto Gym

Cerrado en V15.3.

Owner/Admin configura:

```text
DC  0..25
XP  0..50
GP  0..100
```

Backend persiste GP en `sponsor_points` por compatibilidad histórica.

Semántica oficial de producto:

```text
TP = Team Points = Squads
GP = Gym Points  = Gyms
```
# 22. Rewards Marketplace — modelo 2.1

La infraestructura actual de Rewards se conserva y se generaliza.

Estado real confirmado:

```text
rewards
reward_redemptions
reward_coupon_codes
reward_offer_events
reward_redemption_events
```

ECO-3 ya permite una redención con un único método:

```text
redeem_reward(..., p_payment_method)

p_payment_method:
'dc'
'gp'
'sp'
```

Esto demuestra que la base multi-economía ya existe.

## Marketplace DadoFit

Pago permitido:

```text
DADOCOINS
```

Puede contener rewards propios o convenios globales.

## Marketplace Partner

Pago permitido:

```text
PARTNER_POINTS de esa organization_id
```

Ejemplos:

```text
Titanes Rewards → Titanes Points
Nike Rewards    → Nike Points
```

## Regla de pago

Una redención usa UNA sola economía.

Permitido:

```text
100 DC
```

o:

```text
500 Nike Points
```

No permitido:

```text
50 DC + 300 Nike Points
```

No introducir pagos combinados sin una decisión explícita de producto futura.

## Compatibilidad física actual

Mientras se implementa la abstracción:

```text
native_currency = 'gp' | 'sp'
native_cost
coin_cost
```

pueden mantenerse internamente.

La UI 2.1 debe ocultar la complejidad GP/SP y mostrar el nombre configurado del Partner.

## Reutilizar

Conservar:

```text
inventario
stock
max_per_user
vigencia
coupon pools
QR
redemption URL
instrucciones
fulfillment físico/digital
auditoría
analytics
```

# 23. Gestión de ofertas — 2.1

Owner/Admin del Partner puede mantener el ciclo existente:

```text
crear
editar
publicar
pausar
finalizar
```

Campos actuales de Rewards se preservan.

En 2.1 la gestión debe distinguir claramente:

```text
Marketplace DadoFit
→ costo en DC

Marketplace Partner
→ costo en Partner Points
```

Nunca hacer que el operador seleccione GP/SP como conceptos de producto finales.

Debe ver el nombre configurado, por ejemplo:

```text
Costo
500 Titanes Points
```

Backend puede mantener compatibilidad con `native_currency` / `native_cost` mientras la capa de producto evoluciona.

# 24. Reward Fulfillment

V15.1 separó:

```text
DF-XXXXXXXX
= referencia interna DadoFit
```

de:

```text
código promocional real
```

Tipos de fulfillment:

```text
Código compartido
Pool de códigos únicos
URL de redención
Código DadoFit
Instrucciones / presencial
```

---

# 25. Pool de códigos

Ejemplo:

```text
NIKE-A001
NIKE-A002
NIKE-A003
```

Estados conceptuales:

```text
available
assigned
redeemed / consumed
```

Al canjear:

```text
Gymbro 1 → NIKE-A001
Gymbro 2 → NIKE-A002
```

Nunca reutilizar automáticamente el mismo código único.

---

# 26. Canje presencial V15.2

Flujo:

```text
Gymbro canjea
→ se descuentan DC
→ reward_redemption ISSUED
→ DadoFit genera token QR
→ Gym escanea / ingresa DF-...
→ Owner/Admin verifica
→ confirma entrega
→ REDEEMED
```

Ruta partner:

```text
/rewards/validate
```

El QR no debe contener:

```text
email
nombre
saldo
datos sensibles
```

Solo token / URL verificable.

---

# 27. ISSUE CERRADO — Notificación al publicar oferta

Cerrado en V15.2.2 / V15.3.

Cuando una oferta de Gym pasa realmente de `draft` a `active`, DadoFit notifica a miembros activos del Gym excepto al actor que publica. Ediciones `active -> active` no deben duplicar la notificación.
# 28. Publicidad

Inventario inicial:

```text
6 desktop
1 mobile
```

Placements:

```text
workout-left-top
workout-left-middle
workout-left-bottom

workout-right-top
workout-right-middle
workout-right-bottom

workout-mobile
```

---

# 29. Publicidad rotativa

V14.3:

Un placement puede tener varias campañas.

Ejemplo:

```text
workout-left-top

Nike
Adidas
Gatorade
```

Rotación configurable:

```text
5s
8s
10s
12s
15s
20s
30s
45s
60s
```

---

# 30. Responsive Ads

V14.6 evita perder monetización cuando no caben rails laterales.

Comportamiento:

```text
Desktop amplio
→ vallas laterales

Laptop / ventana reducida
→ dock comercial inferior

Mobile
→ banner mobile / fallback
```

La misma campaña conserva:

```text
Campaign ID
Placement
Impresiones
Clicks
CTR
Usuario
Ruta
Device
```

---

# 31. Analytics publicitario

Se registran:

```text
impression
click
campaign_id
placement
user_id si existe
session_id
route
device_type
timestamp
```

No registrar innecesariamente:

```text
IP
fingerprint
user-agent completo
```

Impresión válida:

```text
>= 50% visible
durante >= 1 segundo
```

---

# 32. Gestión de campañas Ads

SuperAdmin puede:

```text
crear
editar
duplicar
activar
pausar
```

No eliminar libremente campañas con histórico.

Mantener:

```text
impresiones
clics
CTR
auditoría
```

---

# 33. Footer / Legal

Páginas públicas:

```text
/contact
/terms
/privacy
/data-policy
/cookies
/community-guidelines
```

Login/Register deben tener links legales antes de autenticación.

Si se añade:

```text
Meta Pixel
Google Analytics
trackers externos
```

evaluar consentimiento explícito.

---

# 34. Contacto

Debe almacenarse estructuradamente.

Categorías:

```text
Soporte
Comercial
Publicidad
Registrar Gym
Registrar Marca
Reportar problema
Otro
```

Estados:

```text
Nuevo
En revisión
En proceso
Respondido
Cerrado
```

SuperAdmin:

```text
/admin/requests
```

---

# 35. Publicidad — regla visual

No dejar media tarjeta vacía.

Cuando creatividad no coincide con placement:

```text
imagen principal = contain
background copy = cover + blur
overlay inferior = marca + campaña + CTA
```

---

# 36. UX pendiente ya corregido

V15.2.1 corrigió:

## Filter drawer

Problema:

```text
header quedaba por encima del drawer
```

Solución:

```text
drawer / backdrop por encima del header
body scroll locked
ESC cierra
```

## Cómo hacerlo

Problema:

```text
pasos demasiado claros / parecía disabled
```

Solución:

```text
mayor contraste
```

---

# 37. Estilo visual

Brand tokens históricos:

```text
Shadow   #201F1F
Beige    #FFF8E2
Acid     #E3FD63
Electric #2384E3
Flare    #FD572A
```

Themes:

```text
Pastel
Light
Dark
```

No introducir colores arbitrarios.

---

# 38. Header

Problema ya detectado:

demasiados módulos en laptop.

Solución conceptual actual:

```text
Entrenar
Retos
Premios
Más
```

Dentro de Más:

```text
Gymbros
Squads
Organizaciones
Patrocinados
```

No reducir tipografía indiscriminadamente.

---

# 39. Reglas de Rewards

Canje:

```text
frontend NO descuenta saldos
```

Debe hacerlo backend de forma transaccional.

Validar:

```text
saldo
stock
vigencia
estado
límite por usuario
elegibilidad
organización / marketplace
método de pago permitido
código disponible
```

Para DC validar wallet global.

Para Partner Points validar wallet correspondiente al `organization_id` del marketplace/reward.

Una redención:

```text
1 reward
1 payment_currency
1 payment_amount
1 payment_organization_id cuando aplique
```

No pagos mixtos.

Si falla algo:

```text
ROLLBACK completo
```

# 40. Wallet / Ledger

DadoFit ya posee tres familias de wallets/ledgers gastables:

```text
DC
wallets
wallet_transactions

GP
 gym_point_wallets
 gym_point_ledger

SP real
 sponsor_point_wallets
 sponsor_point_ledger
```

En 2.1:

```text
DC
→ sigue siendo wallet global DadoFit

GP/SP gastables
→ se abstraen como Partner Points
```

No unificar físicamente tablas en una sola migración destructiva.

Primero:

```text
API/configuración común
labels dinámicos
marketplace por organization_id
reglas comunes de emisión/spend
```

Luego evaluar deprecación física.

Todo movimiento debe dejar ledger e idempotency key.

Ejemplo DC:

```text
+25 DC reto oficial
+50 DC convenio aprobado
-50 DC reward DadoFit
```

Ejemplo Partner Points:

```text
+100 Titanes Points reto Gym
-50 Titanes Points batido
+150 Nike Points campaña Nike
-300 Nike Points cupón Nike
```

Score histórico se mantiene separado en `score_events` y agregados de ranking.

# 41. SuperAdmin — estado probado

Checklist aprobado:

```text
Acceso exclusivo SuperAdmin        ✅
Inventario publicitario real       ✅
Listado global de usuarios         ✅
Suspensión administrativa          ✅
Bloqueo efectivo del usuario       ✅
Reactivación                       ✅
Conservación de datos              ✅
```

Campañas Admin RPC también fue corregido.

---

# 42. Pruebas de Rewards realizadas

V15.0 probado:

```text
Crear oferta                       ✅
Publicar                           ✅
Gymbro ve oferta                   ✅
Canjear                            ✅
Descuento de DC                    ✅
Stock                              ✅
Límite por usuario                 ✅
Historial                          ✅
Referencia DF                      ✅
```

V15.2:

continuar pruebas completas del QR físico.

---

# 43. Dataset

Catálogo:

```text
1324 ejercicios
```

No romper carga del dataset ni mover:

```text
data/
images/
videos/
```

innecesariamente.

---

# 44. Testing click-by-click

El usuario prefiere pruebas concretas.

Ejemplo:

```text
Paso 1
Titanes → Ofertas

Paso 2
Crear Batido

Paso 3
Mi perfil → Premios

Paso 4
Canjear

Paso 5
Titanes → Validar canjes

Paso 6
Confirmar entrega

Paso 7
Volver a Mis canjes
```

Resultado esperado visible en cada paso.

---

# 45. Diagnóstico

Cuando hay error:

```text
leer mensaje exacto
→ identificar capa
→ revisar código real
→ revisar migration/RPC
→ plantear causa
→ corregir causa raíz
```

No probar cambios aleatorios.

---

# 46. Git checkpoints

Después de aprobar milestone:

```bash
git status
git add .
git commit -m "feat: ..."
git push origin main
git status
```

Esperar:

```text
nothing to commit, working tree clean
```

---

# 47. Milestone actual — DadoFit / Reto ByAds Reloaded 2.1

La auditoría técnica 2.1 confirmó que ECO-1 / ECO-2 / ECO-3 ya implementaron aproximadamente la mayor parte de la infraestructura necesaria para la nueva economía.

Estado:

```text
AUDITORÍA ECONÓMICA 2.1     ✅
AGENT.md 2.1                ✅ este documento
SPEC DE IMPLEMENTACIÓN      ✅ aprobada
ECO-4A Partner Economy       ✅ implementado y probado
ECO-4B DC Budget Governance  ✅
ECO-4C Challenge Reward Budget Enforcement  ⏳ siguiente paso
QA 2.1                      ⏳ pendiente
```

Objetivo del milestone:

```text
Una moneda universal DadoCoins
+
N economías Partner Points
+
score competitivo separado
+
gobierno formal de emisión DC
+
Marketplace DadoFit / Marketplace Partner
```

## A. Foundation existente — KEEP

```text
wallets / wallet_transactions
XP / progress_transactions
gym_point_wallets / ledger
sponsor_point_wallets / ledger
score_events
anti-farming
idempotency
advisory locks
Rewards fulfillment
QR / coupon pools
organizations / RBAC
```

## B. Partner Points abstraction — ADAPT

Agregar configuración por organización:

```text
points_name
points_short_name
points_icon
points_color
enabled
```

No borrar GP/SP físicos todavía.

## C. DC Budget Governance — ADD

Crear una capa de presupuesto/cupo para campañas o convenios que puedan entregar DC.

Debe permitir conocer:

```text
asignados
emitidos
restantes
vigencia
máximo premiados
```

## D. Marketplace split — ADAPT

Separar experiencia:

```text
Marketplace DadoFit
Marketplace Partner
```

sin reescribir fulfillment existente.

## E. Historical Score — KEEP

```text
Competitive Score (persistencia legacy TP/GP)
```

no se debita cuando el usuario gasta Partner Points.

# 48. Diseño propuesto para crear reto Gym

Modal:

```text
PUBLICAR RETO EN TITANES

Ejercicio
Dumbbell alternate preacher curl

Repeticiones
14

Duración
72 h

RECOMPENSA POR APROBACIÓN

DadoCoins
[ 25 ]

XP
[ 50 ]

Titanes Points
[ 100 ]

[ Publicar en Titanes ]
```

Mostrar helper:

```text
Máximos:
25 DC · 50 XP · 100 Titanes Points
```

Permitir 0:

```text
0 DC
50 XP
100 Titanes Points
```

o:

```text
25 DC
0 XP
0 Titanes Points
```

No obligar siempre las tres.

---

# 49. Reglas backend para Gym Rewards

RPC de creación debe recibir:

```text
p_reward_coins
p_reward_xp
p_gym_points
```

Validar:

```text
0 <= DC <= 25
0 <= XP <= 50
0 <= GP <= 100
```

Persistir:

```text
reward_coins
reward_xp
sponsor_points
```

Aunque el backend conserve `p_gym_points` / `sponsor_points` por compatibilidad, la UI 2.1 debe mostrar el nombre configurado del Partner, por ejemplo `Titanes Points`.

---

# 50. Notificación de oferta Gym — regla recomendada

Cuando:

```text
reward status
draft → active
```

entonces:

```text
for each active member
where user_id != actor
→ insert notification
```

Título:

```text
Nuevo premio en Titanes
```

Body:

```text
Batido proteína Titanes · 50 Titanes Points
```

Data:

```json
{
  "reward_id": "...",
  "organization_id": "...",
  "route": "/rewards"
}
```

Idempotencia:

no duplicar si:

```text
active → active
```

por edición.

---

# 51. Qué NO hacer ahora

Durante la migración económica 2.1 NO:

```text
- renombrar o borrar tablas GP/SP de forma destructiva;
- reinterpretar sponsor_points legacy como Sponsor Points reales;
- mezclar wallet y score histórico;
- permitir conversión Partner Points → DC;
- permitir transferencias P2P;
- habilitar cash-out;
- introducir crypto;
- permitir pagos mixtos DC + Partner Points;
- permitir que un Partner emita DC sin presupuesto/autorización;
- editar migraciones ya aplicadas;
- romper RPCs legacy antes de tener compatibilidad;
- reescribir Rewards/QR/fulfillment que ya funciona.
```

Evitar refactors cosméticos mientras se implementa la capa económica.

# 52. Roadmap real desde aquí

Orden oficial recomendado para DadoFit 2.1:

```text
1. AUDITORÍA ECONOMÍA 2.1                    ✅
2. AGENT.md 2.1                              ✅
3. SPEC DadoFit 2.1 Economy                  ✅
4. ECO-4A Partner Economy Foundation         ✅
5. ECO-4B DC Budget Governance               ✅
6. ECO-4C Challenge Reward Budget Enforcement     ⏳ siguiente paso
6. Challenge Reward Budget Enforcement       ⏳
7. Marketplace DadoFit / Partner split       ⏳
8. Frontend dynamic economy labels           ⏳
9. Compatibility layer legacy identifiers    ⏳
10. Analytics + Notifications adaptation     ⏳
11. QA anti-farming / idempotency / RLS      ⏳
12. Responsive QA                            ⏳
13. Docker final                             ⏳
14. Git release                              ⏳
```

No hacer deprecaciones destructivas antes de completar QA y al menos una ventana de compatibilidad.

# 53. Brechas comerciales aún relevantes

Para la economía 2.1 revisar:

```text
Presupuesto DC por convenio/campaña
Owner explícito del presupuesto
DC asignados / emitidos / restantes
Partner Points emitidos / gastados
Stock bajo / alertas
Segmentación de ofertas
Analytics por Marketplace
Atribución de campañas
Moderación de rewards
Reportes comerciales
Expiración de Partner Points
Reglas multi-sede
```

No todas bloquean la primera implementación, pero presupuesto DC sí es requisito central del modelo 2.1.

# 54. Definición de Done

Una feature está terminada cuando:

```text
Código                             ✅
Migration                          ✅
Backend enforcement                ✅
npm test                           ✅
npm run build                      ✅
UI                                 ✅
Caso positivo                      ✅
Caso negativo                      ✅
Permisos                           ✅
Datos conservados                  ✅
Docker si corresponde              ✅
Git limpio                         ✅
```

---

# 55. Forma esperada de trabajar del próximo agente

Cuando el usuario reporta problema:

```text
1. revisar evidencia / screenshot
2. inspeccionar repo real
3. identificar causa
4. implementar cambio mínimo
5. entregar ZIP
6. explicar instalación
7. dar prueba exacta
```

Cuando entrega:

```text
Listo — VXX.X

[Descargar ZIP]

Qué cambia
Qué no toca
Migración
Tests
Prueba click-by-click
```

---

# 56. Importante sobre confianza y continuidad

El usuario prefiere avanzar rápido, pero no quiere cambios improvisados.

Si algo ya está aprobado:

```text
NO rediseñarlo sin necesidad.
```

Preservar especialmente:

```text
arquitectura de organizations
RBAC
RLS
anti-farming
idempotency
Rewards fulfillment
QR
coupon pools
wallet ledgers
score_events
ads
workspaces
brand governance
SuperAdmin
```

Nueva regla de continuidad 2.1:

```text
NO volver al modelo de múltiples monedas globales.
```

Modelo oficial:

```text
DadoCoins = única moneda universal
Partner Points = economía propia por organization_id
Score histórico = separado y no gastable
```

# 57. Último estado exacto de conversación

Último estado funcional histórico validado antes de abrir 2.1:

```text
Rewards Marketplace                 ✅
Canje DC                            ✅
QR generado                         ✅
Mis canjes                          ✅
Rewards Analytics                   ✅
Header Personal                     ✅
Unified Challenges                  ✅ implementado previamente
Competitive Seasons (legacy TP/GP storage) ✅ implementado previamente
Sponsored Gym Competitions          ✅ implementado previamente
```

Auditoría DadoFit 2.1 confirmó adicionalmente:

```text
DC wallet + ledger                  ✅
GP wallet + ledger                  ✅
SP real wallet + ledger             ✅
Single-currency reward redemption   ✅
Score histórico separado            ✅ parcialmente consolidado
Partner Points abstraction          ✅ ECO-4A
DC campaign budgets                 ❌ todavía no existe
Marketplace UX split                ⏳
```

Documento de auditoría:

```text
docs/DADOFIT_2_1_ECONOMY_AUDIT.md
```

# 58. Primera tarea recomendada al iniciar el siguiente chat

La auditoría, el AGENT 2.1, la SPEC económica y ECO-4A ya están completados.

Estado inmediato:

```text
ECO-4A Partner Economy Foundation   ✅
ECO-4B DC Budget Governance         ✅
ECO-4C Challenge Reward Budget Enforcement  ⏳ siguiente paso
```

Antes de ECO-4B recordar el contrato de producto:

```text
XP                = progreso no gastable
DadoCoins         = única moneda universal
Partner Points    = único sistema de puntos gastables por organization_id
Competitive Score = ranking/temporadas no gastable

GP / SP / TP      = únicamente identificadores técnicos/legacy donde todavía existan
```

La siguiente implementación debe ser **ECO-4B — DC Budget Governance**, basada en:

```text
- AGENT.md actualizado
- docs/SPEC_DADOFIT_2_1_ECONOMY.md
- docs/DADOFIT_2_1_ECONOMY_AUDIT.md
- repositorio real
```

ECO-4B debe introducir presupuesto y ledger de emisión DC sin cambiar todavía el Marketplace ni los payouts de challenges.

Después:

```text
ECO-4B
→ QA
→ Git checkpoint
→ ECO-4C Challenge Reward Budget Enforcement
```

No avanzar a ECO-4C sin validar ECO-4B.
