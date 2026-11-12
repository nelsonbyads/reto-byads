# SPEC — Migración de Supabase a backend propio en Docker (Opción B)

Estado: **APROBADA (D1–D9, 2026-11-10)** · Base: commit `0499359` (rama `dev`)

Avance: M0–M11 ✅ · endurecimiento e infraestructura AWS-ready ✅ · M12 (corte) pendiente de decisión y ventana de mantenimiento. Registro y ajustes en §12; decisiones de producción en `docs/DECISIONES_PRODUCCION.md`.

---

## 1. Objetivo

Eliminar toda dependencia de Supabase (Cloud y software: GoTrue, PostgREST, Storage API, Kong, CLI y `@supabase/supabase-js`) y operar DadoFit con componentes propios en Docker:

- PostgreSQL 17 (datos y lógica de negocio existente).
- API propia en Node (autenticación, autorización, acceso a datos y archivos).
- MinIO (almacenamiento de archivos compatible con S3).
- nginx (SPA + proxy de `/api`).
- SMTP (Mailpit en desarrollo, proveedor real en producción).

## 2. Principios

1. **No reescribir la lógica de negocio.** Las ~74 RPC SQL (`SECURITY DEFINER`) ya resuelven atomicidad, idempotencia, bloqueos y anti-farming. Se conservan.
2. **Compatibilidad antes que refactor.** Se emula el contrato que esas funciones esperan (`auth.uid()`, roles `anon`/`authenticated`, RLS) para que las 57 migraciones se apliquen sin cambios.
3. **Migración incremental por módulos**, con tests en verde en cada paso y Supabase Cloud intacto como rollback hasta el corte.
4. **Mínimas dependencias nuevas**, cada una justificada.

## 3. Inventario de dependencias de Supabase (M0)

### 3.1 Frontend

| Uso | Cantidad | Dónde |
|---|---|---|
| `supabase.rpc()` | 102 llamadas, 74 funciones distintas | 34 archivos; más en `AdminPage` (16), `SquadsPage` (10), `BrandCampaignsPage` (8) |
| `supabase.from()` (PostgREST directo) | ~101 llamadas sobre 20 tablas | más en `SquadsPage` (15), `OrganizationChallengesPage` (10), `GymBattlesPage` / `OrganizationsPage` (9) |
| Filtros PostgREST (`.or/.in/.ilike/count`) | 49 | páginas |
| `supabase.auth.*` | `signUp`, `signInWithPassword`(2), `signOut`(4), `getSession`, `onAuthStateChange`, `resetPasswordForEmail`, `updateUser`(2) | `src/auth/AuthContext.tsx` |
| Metadatos de usuario | `user_metadata.display_name/full_name/account_type`, `app_metadata.role` | `AuthContext.tsx:105-135` |
| Storage `challenge-evidence` | `upload` (5), `createSignedUrl` (5), `remove` (~10) | Challenges, Squads, GymBattles, OrganizationChallenges, SponsoredChallenges, BrandCampaigns, BrandAudit |
| Storage `avatars` | **sin uso** en el frontend | — |
| MFA / TOTP | **sin uso** en el frontend (solo habilitado en `config.toml`) | — |
| Realtime | **sin uso** (no hay `.channel()`) | — |
| Edge Functions | **no existen** | — |

Tablas más consultadas vía `.from()`: `profiles` (15), `friendships` (13), `challenge_evidence` (15), `challenges` (10), `challenge_participants` (8), `organizations` (6), `notifications` (6), `organization_members` (7), `groups`/`group_members` (8), `score_events` (3), `organization_battles` (3), y otras 9 con 1–2 usos.

### 3.2 Base de datos

| Dependencia | Uso | Sustitución |
|---|---|---|
| `auth.uid()` | 232 apariciones (RLS + RPC) | función propia `auth.uid()` que lee `current_setting('request.jwt.claim.sub', true)` |
| `auth.users` | FKs (≥8 tablas), 2 triggers `after insert` (bootstrap de perfil), joins en admin/analytics; columnas `id`, `email`, `created_at`, `raw_user_meta_data` | tabla propia `auth.users` con esas columnas + las de autenticación |
| Roles `anon` / `authenticated` / `service_role` | 159 / 457 / 10 menciones en GRANT/REVOKE/policies | se crean los mismos roles (`NOLOGIN`); la API hace `SET LOCAL ROLE` |
| `storage.objects`, `storage.buckets`, `storage.foldername` | 11 / 2 / 9 (políticas de evidencia) | esquema `storage` mínimo de compatibilidad; la autorización real de archivos pasa a la API (ver §6) |
| Extensiones | solo `pgcrypto` (`gen_random_uuid` ×48) | disponible en Postgres estándar |
| `request.jwt`, `auth.jwt()`, `pg_net`, `pg_cron`, `vault` | **sin uso** | — |

Conclusión M0: la superficie de Supabase es acotada y emulable. El mayor volumen de trabajo está en sustituir las ~101 llamadas `.from()` y el cliente de autenticación.

## 4. Arquitectura destino

```text
Navegador ──► nginx :8781 ──┬─► SPA estática
                            └─► /api/* ──► api (Node) :8782 ──┬─► db (Postgres 17)  red interna
                                                              ├─► minio (S3)        red interna
                                                              └─► SMTP
```

Servicios Compose (proyecto `reto-byads-stack`, red y volúmenes con nombre propio):

| Servicio | Imagen | Puerto host (dev) | Volumen |
|---|---|---|---|
| `web` | nginx (build propio) | `8781` | — |
| `api` | Node 22 (build propio) | `8782` (dev) / solo interno en prod | — |
| `db` | `postgres:17` | `127.0.0.1:55432` (dev) / sin exponer en prod | `reto-byads-stack_db` |
| `migrate` | build propio (job) | — | — |
| `minio` | `minio/minio` | `127.0.0.1:8783` / consola `127.0.0.1:8784` (dev) | `reto-byads-stack_minio` |
| `mailpit` | `axllent/mailpit` (solo dev) | `127.0.0.1:8785` UI / `127.0.0.1:8786` SMTP | — |

Puertos verificados libres el 2026-11-10 (inventario del paso 1). El stack Supabase local existente (`supabase_*_reto-byads`) y sus volúmenes **no se tocan**; sirven como fuente de datos del ensayo.

## 5. Decisiones

| # | Tema | [PROPUESTA] | Alternativa | Motivo |
|---|---|---|---|---|
| D1 | Sesión | Access token corto (15 min) en memoria + refresh token rotativo en cookie `httpOnly; Secure; SameSite=Strict`, con detección de reutilización | JWT en `localStorage` (como hoy) | Elimina el robo de sesión vía XSS hallado en la auditoría (SEC‑03/06) |
| D2 | CSRF | Cookie `SameSite=Strict` + cabecera `X-CSRF-Token` (double submit) en `/api/auth/refresh` y mutaciones | Solo SameSite | Defensa en profundidad al usar cookies |
| D3 | Framework API | Fastify + validación con JSON Schema | Express | Validación y serialización integradas, buen rendimiento |
| D4 | Acceso a Postgres | `pg` (node-postgres) con SQL explícito, sin ORM | Prisma/Drizzle | El dominio ya vive en SQL; un ORM no aporta |
| D5 | Runner de migraciones | Script Node propio con tabla `schema_migrations` (checksum por archivo) | `dbmate` | Sin dependencia nueva; mismo formato de archivos |
| D6 | Hash de contraseñas | Verificar bcrypt heredado de GoTrue; rehash a argon2id en el siguiente login | Mantener bcrypt | Migración transparente de usuarios |
| D7 | Archivos | MinIO con URLs prefirmadas emitidas por la API | Disco local servido por nginx | Compatibilidad S3, portable a cualquier proveedor |
| D8 | MFA | Fuera de alcance de la v1 (no se usa hoy) | Implementar TOTP | No hay uso actual |
| D9 | Ubicación de la carpeta | `server/` (API) e `infra/` (Compose, nginx, scripts) dentro del repo; migraciones pasan a `db/migrations/` | Repos separados | Un solo despliegue versionado |

## 6. Diseño detallado

### 6.1 Capa de compatibilidad SQL (`db/migrations/00000000000000_compat.sql`, se aplica primero)

- Roles `anon`, `authenticated`, `service_role` (`NOLOGIN`); el usuario de conexión de la API (`dadofit_api`) es miembro de `anon` y `authenticated`.
- Esquema `auth`:
  - `auth.users(id uuid pk, email citext unique, encrypted_password text, email_confirmed_at, raw_user_meta_data jsonb, raw_app_meta_data jsonb, banned_until timestamptz, created_at, updated_at, last_sign_in_at)`.
  - `auth.uid()` → `nullif(current_setting('request.jwt.claim.sub', true), '')::uuid` (mismo setting que usaba Supabase, así el suite pgTAP existente no cambia).
  - Tablas propias de autenticación: `auth.refresh_tokens`, `auth.one_time_tokens` (recuperación/confirmación, con hash, caducidad y uso único), `auth.login_attempts`.
- Esquema `storage` mínimo: `storage.buckets`, `storage.objects(bucket_id, name, owner, metadata, created_at)` y `storage.foldername(text)`, para que las migraciones y políticas existentes se apliquen sin editarse. La API registra cada objeto subido en `storage.objects`.

### 6.2 API: contexto por petición

Cada petición autenticada:

```sql
begin;
select set_config('request.jwt.claim.sub', $1, true);  -- sub del access token
set local role authenticated;                -- o anon si no hay sesión
-- llamada a la RPC / consulta
commit;
```

Con esto RLS, `auth.uid()` y los `SECURITY DEFINER` se comportan igual que en Supabase.

### 6.3 Endpoints

- `POST /api/rpc/:name` — ejecuta solo funciones de una **lista blanca** explícita (con aridad y nombres de parámetros validados). Cubre las 74 RPC actuales. Nunca SQL arbitrario.
- Endpoints de lectura por recurso para sustituir `.from()`, implementados como funciones SQL nuevas o consultas parametrizadas, siempre paginadas (`limit` máximo definido).
- `/api/auth/*`: `register`, `login`, `logout`, `refresh`, `password/forgot`, `password/reset`, `password/change`, `email/confirm`, `me`.
- `/api/files/*`: `upload-url`, `download-url`, `delete` (ver §6.5).
- `GET /api/health` (liveness) y `GET /api/ready` (comprueba Postgres y MinIO).

### 6.4 Autenticación

- Registro: valida reglas de contraseña en servidor (mínimo 10, requisitos de `passwordRules.ts`), crea `auth.users` (dispara el trigger existente de bootstrap de perfil), envía confirmación de email.
- Login: límite por IP y por cuenta, bloqueo temporal tras N fallos, respuesta uniforme ante usuario inexistente.
- Suspensión: `banned_until` se comprueba en login y en refresh; al suspender se revocan todos los refresh tokens (resuelve SEC‑01).
- Recuperación: token de un solo uso (hash almacenado, 30 min), invalida sesiones al cambiar contraseña.
- `app_metadata.role` y `user_metadata.*` se exponen en `GET /api/auth/me` con la misma forma que hoy usa `AuthContext`.

### 6.5 Archivos

- Bucket privado `challenge-evidence`; `avatars` se crea pero no se usa hasta que exista la funcionalidad.
- Subida: el cliente pide `upload-url` con `participant_id`, tipo y tamaño; la API valida con `can_manage_challenge_evidence`, fija la ruta `<user_id>/<participant_id>/<uuid>.<ext>`, firma un PUT con tipo y tamaño máximos (50 MB) y registra el objeto tras la confirmación.
- Descarga: `download-url` valida con `can_access_challenge_participant` y firma un GET de 30–60 min.
- La evidencia se acepta solo si el objeto existe en el bucket (resuelve SEC‑09).

### 6.6 Frontend

- `src/lib/api.ts`: cliente con `rpc(name, params)` de forma compatible con el uso actual (`{ data, error }`), más métodos por recurso y de archivos.
- `AuthContext` reescrito sobre `/api/auth/*`; el modo demo/local queda limitado a `import.meta.env.DEV` (resuelve SEC‑07).
- Migración por módulos; al final se eliminan `@supabase/supabase-js` y `supabase` de `package.json`.

## 7. Migración de datos

1. **Ensayo local:** fuente = volúmenes del Supabase local (solo lectura; se levanta temporalmente con autorización explícita) o un dump de Cloud.
2. Exportar `public` completo y, de `auth.users`, solo `id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, banned_until, created_at, last_sign_in_at`.
3. Desactivar triggers de bootstrap durante la carga (los perfiles ya existen).
4. Copiar objetos de `challenge-evidence` a MinIO conservando rutas; cargar `storage.objects`.
5. Verificación: recuento por tabla, sumas de saldos DC/GP/SP y de ledgers, muestreo de 20 evidencias, login de usuarios de prueba con contraseña existente.

## 8. Fases y criterios de aceptación

| Fase | Entregable | Aceptación |
|---|---|---|
| M2 | Compose + compat SQL + runner | Las 57 migraciones se aplican desde cero; `db reset` reproducible |
| M3 | API base + `/api/rpc` con lista blanca | Tests de integración: RLS respeta `auth.uid()`; función fuera de lista → 404 |
| M4 | Auth propia | Registro, login, refresh rotativo, recuperación, suspensión probados; usuario migrado entra con su contraseña |
| M5 | Archivos MinIO | Subida/descarga autorizadas; acceso cruzado denegado; evidencia inexistente rechazada |
| M6 | Sustitución de `.from()` | 0 usos de `.from()` de tablas en `src/`; todas las lecturas paginadas |
| M7 | Frontend sin Supabase | 0 imports de `@supabase/supabase-js`; smoke test de los flujos de `docs/TESTING.md` |
| M8 | CI | Pipeline levanta el stack y pasa migraciones, typecheck, Vitest e integración |
| M9 | Ensayo de datos | Verificación §7 sin diferencias |
| M10 | Producción | TLS, cabeceras + CSP, límites de recursos, imágenes versionadas |
| M11 | Backups | Restauración probada y documentada |
| M12 | Corte | Verificación post-corte OK; Supabase Cloud retenido N días |

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Comportamiento de PostgREST que el frontend asume implícitamente (formatos, `count`, errores) | Cliente `api.ts` devuelve `{ data, error }`; tests por módulo |
| Hashes de GoTrue no compatibles | Verificar formato en el ensayo M9 antes de M4 final; plan B: forzar reset de contraseña |
| Seguridad de la auth propia | Revisión de seguridad dedicada de M4 antes de producción |
| Sesiones invalidadas en el corte | Comunicación previa; ventana de mantenimiento |
| Operación (backups, parches, HA) pasa a ser responsabilidad propia | M10–M11 obligatorios antes del corte |

## 10. Rollback

- Hasta M12, producción sigue en Supabase Cloud; cada fase es reversible revirtiendo su rama.
- En el corte: si la verificación falla, se revierte el DNS a la versión actual (Supabase Cloud) sin pérdida de datos, porque las escrituras en Cloud solo se congelan durante la ventana.
- La retirada de Supabase Cloud y del stack local (contenedores y volúmenes `supabase_*_reto-byads`) es irreversible y requiere confirmación explícita nombrando cada recurso.

## 11. Prerrequisitos pendientes

- [ ] Paso 2: ejecutar en cada entorno Supabase actual la verificación ECO‑4B:
  ```sql
  select to_regprocedure('public.__eco4b_consume_test(uuid,bigint,text)') as test_hook,
         (select count(*) from public.dc_budgets
           where id in ('00000000-0000-0000-0000-0000000000b1',
                        '00000000-0000-0000-0000-0000000000b2')) as test_budgets;
  ```
  Esperado: `test_hook = null` y `test_budgets = 0`.
- [x] Paso 3: `20261105190000_enable_nike_partner_economy.sql` ya no aborta en entornos limpios.
- [ ] Aprobación de las decisiones D1–D9.
- [ ] Destino de producción (VPS / servidor / nube) y proveedor SMTP.

## 12. Registro de implementación

### M2 — Postgres en Docker + compatibilidad + runner (2026-11-10) ✅

Archivos:

- `db/compat/00000000000000_supabase_compat.sql` — roles, privilegios por defecto de `public`, esquemas `auth`, `storage` y `extensions`, `auth.users`, `auth.uid()`, `storage.foldername()`.
- `infra/db/migrate.sh` — runner: un archivo por transacción junto con su registro en `dadofit_meta.schema_migrations` (nombre + sha256); omite los aplicados y se detiene si un archivo aplicado cambió (`ALLOW_CHECKSUM_DRIFT=1` para aceptarlo).
- `infra/docker-compose.yml` — proyecto `reto-byads-stack`: `db` (`postgres:17.6-alpine`, `127.0.0.1:55432`, volumen `reto-byads-stack_db_data`) y `migrate` (perfil `tools`).
- `infra/.env.example` (plantilla) e `infra/.env` (local, ignorado por git).
- `.gitattributes` — `*.sh` siempre con LF.

Ajustes respecto al diseño aprobado:

| Decisión | Ajuste | Motivo |
|---|---|---|
| D5 (runner en Node) | Runner en `sh` + `psql` dentro de la imagen oficial de Postgres | Cero dependencias npm; usa el mismo cliente que el servidor |
| D9 (migraciones a `db/migrations/`) | Las migraciones históricas siguen en `supabase/migrations/` hasta el corte (M12); solo la capa de compatibilidad vive en `db/compat/` | Mover los archivos ahora rompería `supabase db push` hacia Supabase Cloud, que es producción y el rollback hasta M12 |
| §6.1 / §6.2 (`app.user_id`) | La identidad se fija en `request.jwt.claim.sub` | Es el setting que ya usan el suite pgTAP y el comportamiento de Supabase |

Verificación realizada:

- Las 58 migraciones (compatibilidad + 57) se aplican desde cero sin errores; la de Nike emite su aviso y no hace nada.
- Segunda ejecución: `applied=0, already applied=58` (idempotente).
- 45 tablas en `public`; solo `marketplace_partner_integrity_audit` sin RLS (permisos revocados, igual que en Supabase); 224 funciones.
- Función de prueba ECO‑4B ausente y 0 presupuestos de prueba tras la cadena completa.
- Insertar en `auth.users` dispara el bootstrap (perfil y wallet creados).
- Como `authenticated` con `request.jwt.claim.sub`: `auth.uid()` devuelve el usuario, RLS deja ver solo su wallet, `get_dadofit_workspace_context()` responde y `redeem_reward` devuelve su error de negocio (`reward not found`).
- Como `anon`: `permission denied for table wallets`.

Pendiente que quedó resuelto en M8: el suite pgTAP corre en `infra/db/Dockerfile.sqltest` (41/41 OK).

Comandos (desde la raíz del repo):

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d db
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tools run --rm migrate
```

### M3–M11 — API, auth, archivos, frontend, tests, datos, producción y backups (2026-11-10) ✅

| Fase | Entregado | Verificación |
|---|---|---|
| M3 API base | `server/` (Fastify): `/api/rpc/:name` con lista blanca de 117 funciones (`rpcAllowlist.js`, extraída del frontend); `/api/db/query` con lista blanca de 19 tablas y acciones (`catalog.js`), columnas validadas contra el catálogo y SQL parametrizado (`sqlBuilder.js`, tope 1000 filas); transacción por petición como `anon`/`authenticated`; rol de conexión `dadofit_api` (NOINHERIT, mínimo privilegio); límites por IP; logs JSON con cabeceras sensibles redactadas; `/api/health` y `/api/ready` | 7 tests unitarios del constructor SQL + integración |
| M4 Auth | Registro con confirmación por correo, login con bloqueo tras 5 fallos (15 min), access token HS256 de 15 min en memoria + refresh rotativo en cookie `httpOnly; SameSite=Strict` con detección de reutilización (revoca la familia), CSRF double-submit, recuperación con token de un solo uso (30 min), cambio de contraseña, política ≥10 caracteres con letras y números (servidor y cliente), bcrypt heredado verificado y re-cifrado a argon2id, respuestas que no revelan si un correo existe | 13 tests de integración |
| M4 Suspensión (SEC‑01) | Trigger `profiles.platform_status` → `auth.users.banned_until` + revocación de refresh tokens; la API rechaza tokens de cuentas suspendidas (caché de 15 s) | test de integración |
| M5 Archivos | Volumen `storage_data`; subida/descarga con URLs firmadas HMAC (subida ≤10 min, descarga ≤1 h, `Range` para vídeo, sin sobrescritura, tamaño y tipo validados contra `storage.buckets`); autorización con las políticas RLS existentes de `storage.objects`; evidencia solo si el archivo existe en la carpeta del participante (SEC‑09) | test de integración (incluye acceso cruzado y URL manipulada) |
| M6/M7 Frontend | `src/lib/backend.ts` reemplaza `supabase-js` con la misma forma (`rpc`, `from`, `storage.from`); `AuthContext` reescrito; login con confirmación por enlace y reenvío; modo local/demo solo en desarrollo (SEC‑07); `@supabase/supabase-js` y `supabase` CLI eliminados; scripts `check-supabase`/`test-*` retirados (el de concurrencia DC se portó a `server/test`) | typecheck limpio, 164 tests Vitest, smoke test en navegador (registro → correo → login → 10 páginas + 9 secciones de admin, sin errores de consola ni de CSP) |
| Auditoría | SEC‑03 `CHECK ^https?://` en `website_url`/`target_url` + `safeExternalUrl` en todos los enlaces dinámicos; SEC‑04/05 límites por IP para escrituras anónimas (`record_ad_event` 60/min, `submit_support_request` 5/min); SEC‑06 cabeceras + CSP en todas las rutas de nginx; SEC‑10 `is_platform_admin` solo responde por el propio usuario; PERF‑01 `get_partner_point_configs_batch`; PERF‑02 22 páginas con `React.lazy`; PERF‑04 polling pausado con la pestaña oculta y caché de anuncios por ubicación; ARQ‑05 mensajes de canje accionables | tests unitarios (`safeUrl`, `redeemErrorMessage`, reglas de contraseña) + `curl -I` |
| M8 Tests y CI | `infra/db/Dockerfile.sqltest` (Postgres + pgTAP, migra desde cero); `.github/workflows/ci.yml` (frontend, guardarraíles de migraciones, SQL, integración API) | pgTAP 41/41, API 22/22 (unitarios + integración + economía) |
| M9 Datos | `infra/scripts/import-from-supabase.sh` (solo lee el origen; exige `CONFIRM_REPLACE_TARGET_DATA=yes`; usuarios con hash, datos de `public`, metadatos de storage; verificación origen/destino) y `server/scripts/import-storage-files.mjs` | ensayo contra el Supabase local (vacío) y, el 2026-11-11, **ensayo con los datos reales de Supabase Cloud** (solo lectura, vía *Session pooler*; migraciones idénticas): 8 usuarios, 24 retos, 5 organizaciones, saldos DC/puntos y 28 archivos, verificación origen = destino en los 13 controles; login real con contraseña heredada (bcrypt) correcto y re-cifrado a argon2id |
| M10 Producción | `infra/docker-compose.prod.yml` (Caddy con TLS automático como único puerto público, límites de recursos, SMTP real, cookies seguras, 2 saltos de proxy) | `docker compose config` validado; **no desplegado** (falta servidor y dominio) |
| M11 Backups | Servicio `backup` (`pg_dump` + tar de evidencias, sha256, retención 14 días) y `restore-check.sh` | simulacro local: backup verificado y restaurado en una base temporal con conteos idénticos |

Ajustes respecto al diseño aprobado:

| Decisión | Ajuste | Motivo |
|---|---|---|
| D7 (MinIO) | Archivos en un volumen gestionado por la API con URLs firmadas HMAC (alternativa "disco" de D7) | MinIO ya no publica imágenes Docker (ninguna etiqueta descargable en Docker Hub ni quay.io el 2026-11-10). Para varias réplicas de la API habrá que montar un almacenamiento compartido o pasar a un servicio S3 |
| §6.3 (endpoints por recurso para `.from()`) | Endpoint genérico `/api/db/query` acotado por listas blancas de tabla, acción y columna, bajo RLS | Mantiene intactas las ~100 consultas de las páginas (menos riesgo de regresión) con la misma superficie de seguridad que tenía PostgREST, pero más estrecha |
| D5 (runner Node) | `sh` + `psql` (ya registrado en M2) | — |

### Endurecimiento posterior a M11 (2026-11-10) ✅

Revisión de seguridad del backend nuevo; cada punto con test:

| # | Problema | Corrección | Verificación |
|---|---|---|---|
| — | Fastify 5 ignora `trustProxy` numérico: todos los clientes compartían la IP de nginx (límites por IP y bloqueo en la práctica globales) | `server/src/trustProxy.js`: confía solo en saltos privados (red Docker) hasta `API_TRUST_PROXY_HOPS`; la IP del cliente es la primera no confiable de `X-Forwarded-For` | `test/trustProxy.test.js` (6) + login vía nginx registra la IP del cliente, no la de nginx |
| S1 | Dos pestañas renovando la sesión a la vez cerraban la sesión (falsa detección de robo) | Un refresh token rotado hace menos de `AUTH_REFRESH_REUSE_GRACE_SECONDS` (10 s) se acepta si la familia sigue activa; fuera de ese margen sigue revocando la familia | integración: refresh concurrente + reutilización tardía |
| S2 | Cualquiera podía bloquear una cuenta ajena fallando 5 veces | Bloqueo por correo **e IP** (`AUTH_MAX_FAILED_LOGINS`, 5) + tope por cuenta desde todas las IPs (`AUTH_MAX_FAILED_LOGINS_PER_ACCOUNT`, 50). Los 429 propios ya no se sustituyen por el genérico, así el usuario ve cuánto esperar | integración: IP atacante bloqueada, el dueño entra desde otra IP |
| S3 | Tokens de recuperación/confirmación y de archivos en los logs | Enlaces de correo con el token en el fragmento (`/reset-password#token=`, `/login#confirm=`; los antiguos con `?` siguen funcionando); nginx registra sin query ni Referer; Caddy reemplaza `token`/`confirm` y quita Referer; la API registra la ruta sin query | `src/lib/authLinkToken.test.ts` (4) + navegador (confirmación con carga y con solo cambio de fragmento, recuperación completa) + logs sin el token de prueba + `caddy validate` |
| S4 | `auth.login_attempts`, `refresh_tokens` y `one_time_tokens` crecían sin límite | `server/src/maintenance.js`: purga cada hora (con advisory lock para varias réplicas) de intentos > 30 días y tokens caducados hace > 7 días | integración: purga filas viejas y deja la sesión viva |

Resultado: API 30/30 (unitarios 13, integración 15, economía 2), Vitest 168/168, `tsc` limpio.

Segunda tanda (2026-11-11):

| # | Problema | Corrección | Verificación |
|---|---|---|---|
| S5 | Registro, "olvidé mi contraseña" y "reenviar confirmación" daban la misma respuesta, pero tardaban más cuando la cuenta existía (esperaban al SMTP) | Los correos se envían después de responder (`sendLater`); las tres rutas nunca responden antes de `AUTH_UNIFORM_RESPONSE_MS` (400 ms) + jitter (`AUTH_UNIFORM_RESPONSE_JITTER_MS`, 100 ms). Registrar un correo existente avisa al dueño por correo (máx. 1 aviso/hora por dirección) | integración: tiempos con y sin cuenta ≥ 400 ms y con diferencia < 200 ms; aviso recibido en Mailpit |
| S6 | Solo se comprobaba el `Content-Type` declarado, no el contenido | `server/src/fileSignature.js`: firma (magic bytes) de JPEG, PNG, WebP, MP4, QuickTime y WebM; un archivo que no coincide se descarta (415) y no llega a guardarse. Tipos sin verificación conocida se rechazan al pedir la URL de subida | `test/fileSignature.test.js` (5) + integración: HTML declarado como JPEG → 415 y sin archivo |

Resultado: API 36/36 (los tiempos de registro con y sin cuenta se solapan: 408–494 ms), Vitest 168/168.

### Infraestructura y deuda de código (2026-11-11) ✅

Destino de producción: AWS (decisiones en `docs/DECISIONES_PRODUCCION.md`). Esto cambia D7: el almacenamiento es un backend intercambiable, disco para desarrollo y S3 para producción.

| Área | Cambio | Verificación |
|---|---|---|
| Archivos | `storage.js` separa firma/límites/comprobación de contenido de los backends `storageDisk.js` y `storageS3.js` (`STORAGE_DRIVER`); la comprobación de firma se hace en el flujo, antes de terminar de escribir. `import-storage-files.mjs` escribe en cualquiera de los dos | `test/storage.test.js` (6) + batería completa 46/46 con disco **y** con S3 simulado (`adobe/s3mock`, perfil `s3`) |
| Configuración | `<NOMBRE>_FILE` para secretos (Secrets Manager/SSM/Docker secrets); `DATABASE_SSL` (`require`/`verify-full` + CA de RDS); `S3_*` | `test/config.test.js` (4) |
| Contenedores | `no-new-privileges` en todos; `api` y `web` sin capacidades, raíz de solo lectura y `/tmp` en memoria; web pasa a `nginx-unprivileged` (uid 101, puerto 8080); `edge` solo `NET_BIND_SERVICE`; la imagen de la API sin npm/yarn; `apk upgrade` en ambas | Trivy: 0 HIGH/CRITICAL con parche en `api` y `web` (antes 10 y 12) |
| CI | ESLint; integración en matriz disco/S3; tipos del frontend deben coincidir con el esquema migrado; `npm audit` + Trivy (fijado por digest) sobre las imágenes; Dependabot semanal con 14 días de espera | YAML validado; el paso de tipos probado contra una base recién migrada (idéntico) |
| Lint | ESLint 9 (web + API) — corrigió 4 hooks llamados después de un `return` condicional (podían romper la página al cambiar de espacio de trabajo), imports y variables sin uso y una expresión suelta | `npm run lint`: 0 errores |
| Tipos | `server/scripts/generate-db-types.mjs` genera `src/types/database.ts` (117 funciones, 19 tablas); `backend.rpc()` y `backend.from()` validan nombre y argumentos | `tsc` limpio: las 108 llamadas existentes coinciden con el SQL |
| Páginas | `AdminPage` (2374 → 28 líneas) en `src/admin/sections/*`; `GymBattlesPage` y `RewardsMarketplacePage` separan modelo y subcomponentes; `formatDate`/`formatBytes` duplicados 6 veces pasan a `src/lib/format.ts` | Vitest 172/172, build, navegador: las 10 secciones de admin, exportación de anuncios y marketplace sin errores de consola |

### Datos de demostración y prueba integral (2026-11-11) ✅

Siembra por la API (`server/scripts/seed-demo.mjs`): 132 cuentas, 10 organizaciones, 89 retos, 889 participaciones, 733 evidencias, 38 premios, 408 canjes, 12 campañas de anuncios. Destapó un bug presente también en Supabase: `eco4c_grant_dc` fallaba con 42702 (`new_balance` ambiguo) siempre que un presupuesto DC pagaba, y devolvía 500 al aprobar retos con DadoCoins. Corregido en `db/migrations/20261111120000_fix_eco4c_grant_dc_ambiguous_balance.sql`, con prueba de regresión. Integridad 12/12, carga de 0 errores en más de 11.000 peticiones (detalles en `docs/ENTREGA_LOCAL.md`).

### Reorganización del repositorio (2026-11-12) ✅

Frontend y backend quedan separados por carpeta, cada uno con sus dependencias. Las rutas citadas antes en este documento corresponden a la estructura anterior:

| Antes | Ahora |
|---|---|
| `src/`, `public/`, `index.html`, `vite.config.ts`, `data/`, `images/`, `videos/`, `scripts/` | `frontend/…` |
| `infra/web/` (Dockerfile, nginx) | `frontend/` |
| `server/` | `backend/` |
| `db/compat`, `db/migrations` | `database/compat`, `database/migrations` |
| `supabase/migrations`, `supabase/tests` | `database/legacy-migrations`, `database/tests` |
| `Dockerfile`, `docker-compose.yml`, `docker/` y `supabase/config.toml` de la raíz | `legacy/` |

El runner registra cada migración solo por su nombre de archivo, así que moverlas no altera los checksums ya aplicados. La raíz conserva un `package.json` con las herramientas comunes (ESLint, Prettier) y atajos (`npm run dev`, `build`, `test`, `test:api`, `lint`, `typecheck`, `install:all`).

### M12 — Corte (pendiente; requiere decisión y ventana)

1. Elegir servidor, dominio y proveedor SMTP; crear `infra/.env.prod`.
2. Desplegar el stack (DEPLOYMENT §3) con datos vacíos y probarlo.
3. Ventana de mantenimiento: congelar escrituras en la app actual, ejecutar M9 contra Supabase Cloud (DB + archivos), verificar la tabla origen | destino.
4. Cambiar DNS. Los usuarios vuelven a iniciar sesión.
5. Mantener Supabase Cloud intacto N días como rollback (volver el DNS).
6. Retirada (irreversible, con confirmación expresa): proyecto Supabase Cloud, contenedores y volúmenes `supabase_*_reto-byads`, el contenedor `dadofit-web` (proyecto `reto-byads-web`), los archivos legados de la raíz (`Dockerfile`, `docker-compose.yml`, `docker/nginx.conf`), `supabase/config.toml`, `supabase/snippets/` y `.env.local`; mover `supabase/migrations/` y `supabase/tests/` a `db/`.
