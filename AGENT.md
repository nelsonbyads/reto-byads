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

Completado:

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
V15.3   Gym Challenge Economy + configurable DC/XP/GP + reward clarity
V15.4   Rewards Analytics Partner/Gym + SuperAdmin
V15.4.1 Responsive Header Hotfix
V15.7   Pre-Release Feature Pack: Unified Challenges + TP/GP Seasons + Sponsored Gym Competitions
```

---

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

# 17. Economía DadoFit

Hay cuatro sistemas conceptuales.

## XP

```text
Progreso personal
```

No gastable.

## DC — DadoCoins

```text
Moneda de fidelización / rewards
```

Sí gastable.

No es:

```text
crypto
cash
P2P
```

Principio:

```text
COMPLETAR UN RETO
≠
TENER DERECHO A RECOMPENSA
```

## TP — Team Points

```text
Puntos competitivos de Squad
```

Sirven para:

```text
rankings de Squad
temporadas
competencias
premios colectivos
```

No deberían gastarse como moneda.

## GP — Gym Points

Actualmente el backend usa históricamente:

```text
sponsor_points
SP
```

pero conceptualmente debe migrarse visualmente a:

```text
GP — Gym Points
```

Sirven para:

```text
ranking de Gyms
Gym vs Gym
temporadas
activaciones patrocinadas
```

NO confundir con DadoCoins.

Puede mantenerse `sponsor_points` internamente por compatibilidad y mostrar `GP` en frontend.

---

# 18. DadoCoins — fuentes confirmadas

## Retos 1 vs 1

Aprobación elegible:

```text
hasta 25 DC
hasta 50 XP
```

Anti-farming:

```text
mismo challenger → mismo Gymbro:
máx. 1 recompensa / 24h

mismo receptor:
máx. 5 recompensas 1v1 / 24h
```

## Squad battles

Aprobación elegible:

```text
hasta 25 DC
hasta 50 XP
hasta 100 TP
```

Anti-farming:

```text
misma pareja de Squads:
máx. 1 batalla recompensada / 24h

mismo usuario:
máx. 5 contribuciones recompensadas / 24h
```

## Retos de Gym / Organización

Aprobación elegible actual:

```text
hasta 25 DC
hasta 50 XP
hasta 100 SP
```

SP debe presentarse en producto como:

```text
GP
```

Anti-farming:

```text
mismo usuario / misma organización:
cooldown 24h

máx. 5 recompensas de organización / 24h
```

## Gym vs Gym

Aprobación elegible:

```text
hasta 25 DC
hasta 50 XP
hasta 100 GP
```

## Retos patrocinados

Aprobación elegible:

```text
hasta 50 DC
hasta 100 XP
```

Anti-farming:

```text
máx. 3 recompensas patrocinadas / 24h
```

La marca no puede farmear su propia campaña.

---

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
# 22. Rewards Marketplace

Ruta Gymbro:

```text
/rewards
```

Funciones:

```text
Premios
Mis canjes
Saldo DC
Búsqueda
Filtros
Stock
Límite por usuario
```

---

# 23. Gestión de ofertas

Ruta:

```text
/rewards/manage
```

Owner/Admin puede:

```text
crear
editar
publicar
pausar
finalizar
```

Campos:

```text
Nombre
Descripción
Tipo
Costo DC
Stock
Máx. por usuario
Imagen URL
Tipo de entrega
Instrucciones
Términos
Inicio
Fin
```

---

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
frontend NO descuenta DC
```

Debe hacerlo backend de forma transaccional.

Validar:

```text
saldo
stock
vigencia
estado
límite por usuario
eligibilidad
código disponible
```

Si falla algo:

```text
ROLLBACK completo
```

---

# 40. Wallet / Ledger

DadoFit ya tiene:

```text
wallets
wallet_transactions
```

Ledger conceptual:

```text
+25 DC reto 1v1
+25 DC reto Gym
+50 DC patrocinado
-50 DC batido Titanes
-250 DC descuento Nike
```

Mantener trazabilidad.

---

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

# 47. Milestone actual — V15.7 Pre-Release Feature Pack

Implementado como último paquete funcional antes del feature freeze:

### A. Unified Challenges

```text
/challenges
/organization-challenges
/squads
/sponsored-challenges
/seasons
```

Comparten navegación contextual para que el Gymbro no tenga que entender la separación técnica interna.

### B. TP / GP Seasons

```text
TP → ranking de Squads
GP → ranking de Gyms
```

La temporada no borra puntos históricos. `score_events` conserva el ledger y `season_id` define la ventana global.

### C. Sponsored Gym Competitions

Brands verificadas pueden invitar Gyms verificados a una competencia por GP con fecha de inicio/fin. Los Gyms Owner/Admin aceptan o rechazan. La tabla patrocinada calcula GP por ventana temporal, por lo que no roba puntos a la temporada global.
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

Gym Points
[ 100 ]

[ Publicar en Titanes ]
```

Mostrar helper:

```text
Máximos:
25 DC · 50 XP · 100 GP
```

Permitir 0:

```text
0 DC
50 XP
100 GP
```

o:

```text
25 DC
0 XP
0 GP
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

Aunque frontend diga:

```text
Gym Points
```

por compatibilidad.

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
Batido proteína Titanes · 50 DC
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

No abrir grandes features nuevas antes de cerrar:

```text
Rewards QA
Gym challenge reward configuration
notifications
TP/GP semantics
partner analytics
```

Evitar todavía:

```text
Marketplace abierto P2P
cash-out
crypto
billing complejo
seasons enormes
```

---

# 52. Roadmap real desde aquí

```text
V15.2.1   Filter/legibility hotfix                 ✅
V15.2.2   Gym reward notifications                 ✅
V15.3     Gym Challenge Economy / Reward Clarity   ✅
V15.4     Rewards Analytics                         ✅
V15.4.1   Responsive Header Hotfix                  ✅
V15.7     Unified Challenges + Seasons + Sponsored Gym Competitions ✅

FEATURE FREEZE

QA FINAL
- Unified Challenges
- TP / GP Seasons
- Sponsored Gym Competitions
- Rewards / QR
- Analytics
- Anti-farming
- RBAC
- Responsive
- Ads

LEGAL FINAL
DOCUMENTACIÓN FINAL
DOCKER FINAL
GIT RELEASE
PRODUCCIÓN
```

No abrir nuevas features del roadmap anterior antes de terminar QA. Las nuevas peticiones del usuario se evalúan después de este cierre.
# 53. Brechas comerciales aún relevantes

Antes de release revisar:

```text
Analytics del partner
Segmentación de ofertas
Stock bajo / alertas
Economía DC emitidos/canjeados
UTM / atribución externa
Moderación de ofertas
Reportes comerciales
```

No todas deben bloquear release.

---

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

Preservar:

```text
arquitectura
economía
anti-farming
RLS
rewards
ads
workspaces
brand governance
SuperAdmin
```

---

# 57. Último estado exacto de conversación

Validado manualmente antes de V15.7:

```text
Rewards Marketplace                 ✅
Batido Titanes visible por vigencia ✅
Canje 10 DC                         ✅
Saldo 25 → 15 DC                    ✅
QR generado                         ✅
Mis canjes                          ✅
Rewards Analytics Gym               ✅
Header Personal compacto            ✅
```

Analytics mostró coherencia con el canje:

```text
Canjes             1
DC consumidos      10
Gymbros únicos     1
Pendientes entrega 1
Ofertas activas    1
```

Se decidió aplicar en un único ZIP el resto del roadmap funcional antes de entrar en QA.
# 58. Primera tarea recomendada al iniciar el siguiente chat

Continuar en modo QA, no en modo feature development:

```text
Estamos en V15.7 Pre-Release Feature Pack.

Primero validar migración y build.
Después probar click-by-click:
1. Unified Challenges
2. Temporada Squad TP
3. Temporada Gym GP
4. Sponsored Gym Competition Brand → Gym invite → accept → leaderboard
5. Rewards / QR delivery
6. Rewards Analytics
7. Anti-farming
8. RBAC
9. Responsive
10. Ads

Corregir únicamente regresiones detectadas.
Después: FEATURE FREEZE → Docker → Git release.
```
