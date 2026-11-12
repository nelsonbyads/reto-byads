# DadoFit

DadoFit es una SPA de fitness gamificado construida con React, TypeScript y Vite sobre un backend propio en Docker (API Node + PostgreSQL). Combina un catálogo de 1.324 ejercicios con retos sociales, evidencia en foto/video, recompensas, Squads, Gyms, Brands y Branded Challenges.

## Estado

- **Backend propio terminado:** Supabase ya no se usa. La migración está documentada en `docs/SPEC_MIGRACION_BACKEND_PROPIO.md`.
- **Funciona completo en local con Docker**, con los datos reales importados desde Supabase Cloud y un conjunto grande de datos de demostración para probar todos los módulos (ver `docs/ENTREGA_LOCAL.md`).
- **Preparado para AWS:**
  - RDS PostgreSQL con TLS.
  - Archivos en S3.
  - Correo por Amazon SES.
  - Secretos desde Secrets Manager/SSM.
  - Logs para CloudWatch.

  Las decisiones pendientes están en `docs/DECISIONES_PRODUCCION.md`.

## Funcionalidades

- Entrenamiento individual mediante dados y niveles de intensidad.
- Catálogo normalizado de 1.324 ejercicios con imagen/GIF e instrucciones.
- Evidencia obligatoria en foto/video para cerrar rondas y retos.
- Autenticación propia: sesión con refresh rotativo, confirmación por correo y recuperación de contraseña.
- Perfil personal, progreso, XP y DadoCoins.
- Gymbros y retos 1v1.
- Squads y Squad vs Squad.
- Organizations / Gyms con roles Owner, Admin, Coach y Member.
- Gym vs Gym con evidencia y revisión cruzada.
- Workspaces Personal, Gym y Brand con RBAC.
- Brands, campañas y Branded Challenges, con doble validación opcional.
- Objetivos patrocinados por repeticiones, tiempo, distancia o cantidad.
- Notificaciones.
- Marketplace DadoFit (en DC) y de partners (en puntos propios de cada Gym o Brand), con código generado, código compartido, lote de cupones, enlace o entrega presencial con validación.
- Rewards Analytics para Partner/Gym y SuperAdmin.
- Economía DadoCoins (DC), Team Points (TP), Gym Points (GP) y Sponsor Points (SP):
  - presupuestos DC aprobados por el SuperAdmin;
  - anti-farming e idempotencia de recompensas.
- Temporadas competitivas TP/GP con histórico no destructivo.
- Competencias patrocinadas Brand → Gyms.
- Publicidad first-party: campañas, ubicaciones, impresiones, clics y exportación de reportes.
- Backoffice de SuperAdmin.

## Stack tecnológico

### Frontend
- React 18, TypeScript y Vite
- React Router DOM (`BrowserRouter`)
- Lucide React
- CSS propio organizado por versión/feature
- Tipos de la base de datos generados desde el esquema (`src/types/database.ts`): `backend.rpc()` y `backend.from()` validan nombres y argumentos

### Backend (propio, en Docker)
- API Node 22 + Fastify (`server/`): autenticación, acceso a datos y archivos.
- PostgreSQL 17 con Row Level Security (RLS). La lógica de economía y retos vive en SQL: RPCs y funciones `SECURITY DEFINER`.
- Archivos de evidencia servidos con URLs firmadas y verificación del contenido real del archivo. Se guardan según `STORAGE_DRIVER`:
  - `disk`: un volumen local (desarrollo);
  - `s3`: Amazon S3 (producción).
- Migraciones SQL versionadas, aplicadas por `infra/db/migrate.sh`.
- Seguridad:
  - contraseñas con argon2id;
  - protección CSRF;
  - límites por IP;
  - bloqueo de login por correo + IP;
  - tiempos de respuesta uniformes, para no revelar qué cuentas existen;
  - contenedores sin privilegios y con sistema de archivos de solo lectura.

### Calidad y despliegue
- Vitest (frontend) y `node:test` (API: unitarios e integración)
- pgTAP para las suites SQL
- ESLint (web y API) y Prettier configurado
- Docker Compose (`infra/`), nginx y Caddy (TLS cuando el despliegue usa Compose)
- GitHub Actions (`.github/workflows/ci.yml`): lint, tipos, tests, migraciones + pgTAP, integración de la API con disco y con S3, `npm audit` y Trivy
- Dependabot semanal (`.github/dependabot.yml`)

## Arquitectura de identidad y permisos

DadoFit usa **una sola identidad por persona** y varios contextos de operación:

```text
AUTH USER
   |
   +-- Personal workspace
   |    +-- Entrenamiento
   |    +-- Gymbros
   |    +-- Retos 1v1
   |    +-- Squads
   |    +-- DadoCoins / XP
   |
   +-- Gym workspace
   |    +-- Miembros y roles
   |    +-- Retos del Gym
   |    +-- Gym vs Gym
   |    +-- Gym Points (GP) y ofertas
   |    +-- Temporadas / rankings
   |
   +-- Brand workspace
        +-- Campañas
        +-- Branded Challenges
        +-- Participantes
        +-- Revisión y auditoría de evidencias
        +-- Sponsor Points (SP) y ofertas
        +-- Competencias patrocinadas de Gyms
```

Un usuario personal puede crear un Squad. Crear un Gym o una Brand requiere la capacidad empresarial correspondiente, que se elige al registrarse. El SuperAdmin verifica las organizaciones y habilita su economía.

## Roles de Organization

| Rol | Participar | Invitar miembros | Publicar retos Gym | Revisar evidencia Gym | Gym vs Gym | Campañas Brand |
| --- | --- | --- | --- | --- | --- | --- |
| Owner | Sí | Sí | Sí | Sí | Sí | Sí |
| Admin | Sí | Sí | Sí | Sí | Sí | Sí |
| Coach | Sí | No/limitado | Sí | Sí | Sí | No |
| Member | Sí | No | No | No | No | No |

> Las validaciones importantes se hacen también en PostgreSQL. Ocultar un botón en React no es la única barrera de seguridad.

## Requisitos

- Docker Desktop (Compose v2.24 o posterior)
- Node.js 22.23.4 (LTS) o posterior dentro de la rama 22.x, con npm (para desarrollo, tests y scripts)
- Git

## Estructura

```text
src/                   SPA React (cliente de la API en src/lib/backend.ts)
  admin/sections/      secciones del backoffice de SuperAdmin
  types/database.ts    tipos generados desde el esquema (no editar a mano)
server/                API propia (Fastify): auth, /api/rpc, /api/db/query, /api/files
  scripts/             tipos de BD, importación, datos demo, integridad y carga
db/compat/             capa de compatibilidad SQL (roles, auth.uid(), esquema storage)
supabase/migrations/   migraciones históricas (se mantienen hasta retirar Supabase)
db/migrations/         migraciones del backend propio
supabase/tests/        suites pgTAP
infra/                 Docker Compose, nginx, Caddy, migraciones, backups e importación
infra/seed/            cuentas demo y copia de datos locales (ignorado por git)
docs/                  documentación (ver abajo)
```

## Puesta en marcha (stack completo en Docker)

```bash
cp infra/.env.example infra/.env   # rellenar los secretos (instrucciones dentro)
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d db mailpit
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tools run --rm migrate
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build api web
```

| Servicio | URL |
| --- | --- |
| Web | http://localhost:8787 |
| API (directa, solo local) | http://127.0.0.1:8782/api/ready |
| Correos de desarrollo (Mailpit) | http://localhost:8785 |
| Postgres (solo local) | 127.0.0.1:55432 |

- Los contenedores tienen `restart: unless-stopped`, así que al abrir Docker Desktop la app vuelve a levantarse sola.
- Las cuentas nuevas reciben un correo de confirmación; en desarrollo ese correo llega a Mailpit.

### Datos y cuentas de demostración

La base local puede poblarse con unos 130 usuarios, gimnasios, marcas, retos, premios, canjes y publicidad, creados recorriendo los flujos reales por la API. Instrucciones y cuentas de prueba: `docs/ENTREGA_LOCAL.md`.

## Desarrollo del frontend

Con el stack levantado (al menos `db`, `mailpit` y `api`):

```bash
npm install
npm run dev
```

- Vite (http://localhost:5175) reenvía `/api` a la API en `127.0.0.1:8782`, así que la cookie de sesión es de primera parte, igual que en producción.
- Para apuntar a otra API: `API_PROXY_TARGET=http://host:puerto npm run dev`.

Cuando cambie una función o tabla expuesta, regenera los tipos. La CI falla si quedan desactualizados:

```bash
DATABASE_ADMIN_URL=postgres://postgres:<POSTGRES_PASSWORD>@127.0.0.1:55432/dadofit npm --prefix server run db:types
```

## Tests y calidad

```bash
npm run lint                               # ESLint (web + API)
npx tsc -p tsconfig.app.json --noEmit      # tipos
npm test                                   # frontend (Vitest)
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tests run --rm sqltest   # migraciones desde cero + pgTAP
cd server && npm test                      # API: unitarios + integración (requiere el stack; ver docs/TESTING.md)
```

Con la base local poblada:

```bash
DATABASE_ADMIN_URL=postgres://postgres:<POSTGRES_PASSWORD>@127.0.0.1:55432/dadofit npm --prefix server run check:integrity   # 12 invariantes de la economía y los datos
npm --prefix server run load:test          # prueba de carga con usuarios demo (subir antes los límites de la API, ver docs/TESTING.md)
```

Los detalles de cada suite (variables, límites de peticiones y la ejecución contra S3 simulado) están en `docs/TESTING.md`.

## Producción

El destino previsto es **AWS** (us-east-1). Lo que el código ya soporta:
- **Base de datos:** RDS PostgreSQL, con `DATABASE_SSL=verify-full`.
- **Archivos:** S3, con `STORAGE_DRIVER=s3`.
- **Correo:** SES por SMTP.
- **Secretos:** como variables o como archivos `<NOMBRE>_FILE`.

Falta decidir el cómputo: ECS Fargate, EC2 o Lightsail.

Con Docker Compose en un servidor propio:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```

Solo el proxy de borde (Caddy) publica los puertos 80/443, con TLS automático. Configuración, AWS, backups, restauración, importación desde Supabase y rollback: `docs/DEPLOYMENT.md`.

## Flujo de release

```text
CI en verde (lint, tipos, tests, migraciones + pgTAP, integración API disco/S3, auditoría y Trivy)
      |
      v
Build de imágenes etiquetadas (IMAGE_TAG=<versión>)
      |
      v
migrate (tools) -> up -d -> smoke test
      |
      v
Rollback = volver al IMAGE_TAG anterior (las migraciones son aditivas)
```

## Checklist mínimo de release

- [ ] CI en verde.
- [ ] `migrate` termina con `applied=N, already applied=M` sin errores.
- [ ] `/api/ready` responde `ready`.
- [ ] Registro, confirmación por correo, login y recuperación de contraseña funcionan.
- [ ] Workspace Personal, Gym y Brand cargan.
- [ ] Subir, ver y borrar evidencia en un reto.
- [ ] Aprobar un reto con recompensa en DC con un presupuesto activo.
- [ ] Canje en el marketplace y validación por el proveedor.
- [ ] `check:integrity` sin filas con problemas.
- [ ] Último backup verificado con `restore-check` (o snapshot de RDS).
- [ ] Refresh directo de rutas SPA no devuelve 404.

## Documentación

| Documento | Contenido |
| --- | --- |
| `docs/README.md` | Índice de toda la documentación: vigente, especificaciones e histórico |
| `docs/ENTREGA_LOCAL.md` | Cómo correrlo en local, cuentas de demostración y resultados de las pruebas |
| `docs/DECISIONES_PRODUCCION.md` | Checklist de decisiones para AWS |
| `docs/DEPLOYMENT.md` | Configuración, despliegue, AWS, backups, importación y observabilidad |
| `docs/TESTING.md` | Suites de pruebas, CI, datos demo, integridad y carga |
| `docs/SPEC_MIGRACION_BACKEND_PROPIO.md` | Migración de Supabase al backend propio y registro de cambios |
| `docs/ARCHITECTURE.md` | Arquitectura de la aplicación |
| `docs/RELEASE_CHECKLIST.md` | Checklist de release detallado |
| `DOCKER.md` | Uso de Docker en el proyecto |

## Licencia y media

No eliminar:

```text
data/
images/
videos/
LICENSE
NOTICE.md
```

`dist/`, `node_modules/` y `public/data/exercises.min.json` pueden regenerarse cuando corresponda.
