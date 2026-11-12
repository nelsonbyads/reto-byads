# DadoFit - Testing Strategy

## 1. Unit tests y lint

```bash
npm test          # Vitest
npm run lint      # ESLint: web (TypeScript + React) y API (Node); los errores fallan la CI
```

ESLint marca como error los fallos reales (hooks condicionales, variables sin uso, expresiones sueltas) y como aviso el estilo mejorable (`any`, dependencias de hooks). Prettier está configurado (`.prettierrc.json`, `npm run format -- <archivos>`) pero el código existente aún no se ha formateado en bloque: hacerlo en un commit dedicado para no mezclarlo con cambios funcionales.

Cobertura actual orientada a reglas deterministas del frontend, incluyendo filtros, dados/random, Sponsored y goal types.

## 2. TypeScript + production build

```bash
npm run build
```

Este comando es obligatorio porque detecta errores de tipos que pueden no aparecer durante `npm run dev`.

## 3. Migraciones desde cero + pgTAP

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tests run --rm sqltest
```

Levanta un Postgres efímero con pgTAP, aplica todas las migraciones (compatibilidad + históricas + propias) y ejecuta `supabase/tests/*.sql` (hoy: 41 aserciones del marketplace de partners).

## 4. API (node:test)

```bash
cd server
node --test test/sqlBuilder.test.js test/trustProxy.test.js test/fileSignature.test.js test/storage.test.js test/config.test.js   # unitarios, sin dependencias
# integración: necesita db + mailpit + api levantados
BASE_URL=http://127.0.0.1:8782 MAILPIT_URL=http://127.0.0.1:8785 DATABASE_ADMIN_URL=postgres://postgres:<POSTGRES_PASSWORD>@127.0.0.1:55432/dadofit npm test
```

Cubre: registro con confirmación por correo, login, bloqueo por correo+IP sin dejar fuera al dueño, refresh rotativo con detección de reutilización y margen para varias pestañas, purga de tablas de auth, tiempos de respuesta uniformes sin revelar cuentas, verificación del contenido real de los archivos, IP del cliente detrás de proxies, CSRF, RLS a través de `/api/db/query`, lista blanca de RPC, `is_platform_admin` restringido al propio usuario, subida/descarga/borrado de evidencia bajo RLS (incluido acceso cruzado y URL manipulada), suspensión de cuentas, recuperación de contraseña de un solo uso, concurrencia/idempotencia de presupuestos DC y pago real de DC desde un presupuesto activo (regresión de `eco4c_grant_dc`). También `config` (secretos `_FILE`, TLS, S3) y el núcleo de almacenamiento (límites, firma de archivos, rangos).

Almacenamiento S3: la misma batería se ejecuta contra un S3 simulado levantando `--profile s3 up -d s3` y la API con `STORAGE_DRIVER=s3 S3_ENDPOINT=http://s3:9090 S3_FORCE_PATH_STYLE=true S3_ACCESS_KEY_ID=local S3_SECRET_ACCESS_KEY=local`.

Tipos del frontend: `npm --prefix server run db:types` (con `DATABASE_ADMIN_URL`) regenera `src/types/database.ts` desde el esquema; `backend.rpc()` y `backend.from()` validan nombres y argumentos con esos tipos.

Para la integración hay que subir los límites de peticiones de la API, porque todos los usuarios de prueba salen de la misma IP: `RATE_LIMIT_AUTH_PER_MINUTE=1000 RATE_LIMIT_GLOBAL_PER_MINUTE=5000` (la siembra y la carga necesitan además `RATE_LIMIT_PUBLIC_RPC_PER_MINUTE` y `RATE_LIMIT_UPLOADS_PER_MINUTE`; ver `DOCKER.md`). Después, `up -d api` sin esas variables devuelve los límites normales.

## 4b. Datos de demostración, integridad y carga

- `npm --prefix server run seed:demo`: puebla la base local recorriendo los flujos por la API (ver `docs/ENTREGA_LOCAL.md`).
- `npm --prefix server run check:integrity`: 12 invariantes de la economía y los datos; todos deben dar 0 filas.
- `npm --prefix server run load:test`: carga con usuarios demo (`LOAD_CONCURRENCY`, `LOAD_SECONDS`).

## 5. CI

`.github/workflows/ci.yml` ejecuta en cada PR:

- frontend: ESLint, tipos, Vitest, build;
- guardarraíles de migraciones (sin `grant ... to anon` nuevos ni hooks de prueba);
- migraciones + pgTAP;
- integración de la API dos veces (almacenamiento en disco y en S3 simulado) y verificación de que `src/types/database.ts` coincide con el esquema migrado;
- seguridad: `npm audit` de dependencias de ejecución (high/critical) y Trivy (versión fijada por digest) sobre las imágenes `api` y `web`: falla con vulnerabilidades HIGH/CRITICAL que ya tengan parche; también informa (sin fallar) de malas configuraciones en Dockerfiles y Compose.

`.github/dependabot.yml` propone actualizaciones semanales de npm (web y API), imágenes Docker, Compose y GitHub Actions, agrupando minor/patch y con 14 días de espera antes de adoptar una versión recién publicada.

## 6. Smoke test funcional

### Personal
- login;
- lanzar dados;
- evidencia obligatoria;
- Gymbros;
- Squads;
- reto 1v1;
- Sponsored Challenges.

### Gym
- selector de workspace;
- miembros/roles;
- reto de Gym;
- Gym vs Gym.

### Brand
- selector de workspace;
- campaña;
- Branded Challenge;
- participante;
- evidencia;
- aprobar / pedir otra evidencia.

## 7. Caso critico Sponsored

```text
Brand publica reto
-> Gymbro se une
-> carga evidencia
-> envia
-> Brand revisa
-> aprueba
-> (con doble validación) un segundo admin audita
-> participante obtiene DC (si la marca tiene presupuesto activo), XP y Partner Points de la marca una sola vez
```

Tambien verificar el ciclo:

```text
rechazar
-> nueva evidencia
-> reenviar
-> aprobar
```

El historial de `challenge_reviews` debe admitir multiples revisiones por participante.

## 8. Regresion minima antes de release

- Auth.
- Personal workspace.
- Gymbros.
- Squads.
- Gym workspace.
- Gym vs Gym.
- Brand workspace.
- Sponsored Challenge.
- Notifications.

## 9. Criterio de salida

RC1 solo se considera apta cuando:

```text
API /api/ready OK
+ tests OK
+ build OK
+ smoke Vite OK
+ smoke Docker OK
```
