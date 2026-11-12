# DadoFit — Despliegue del piloto (gratis)

| Pieza | Servicio | Carpeta / archivo |
| --- | --- | --- |
| Web | Vercel | `frontend/` (`frontend/vercel.json`) |
| API | Render (plan Free, Docker) | `backend/` (`render.yaml`) |
| Base de datos | Neon (Postgres) | migraciones de `database/` |
| Archivos | Cloudflare R2 (S3) | — |

Los testers entran por la URL de Vercel. Vercel reenvía `/api/*` a Render, así que la sesión (cookies) es del mismo dominio, igual que en local.

Secretos y conexiones del piloto: `infra/.env.pilot` (ignorado por git; se generó con claves nuevas, distintas de las locales).

## Limitaciones aceptadas (piloto)

- **Render Free:** la API se duerme tras unos 15 minutos sin uso; el primer acceso tarda entre 30 y 60 s.
- **Neon Free:** la base se suspende sin uso (despierta en segundos) y tiene alrededor de 0,5 GB.
- **Correo:** sin proveedor SMTP. El registro no pide confirmación y los correos de recuperación de contraseña no se envían.
- **Backups:** solo los propios de Neon.

## Pasos

### 1. Neon (base de datos)
1. Crear cuenta en https://neon.tech y un proyecto (región AWS us-east-2 u Oregon, cerca de Render).
2. Copiar la cadena de conexión **directa** (no "pooled") del rol `neondb_owner` y pegarla en `NEON_OWNER_URL` de `infra/.env.pilot`.
3. Aplicar las migraciones (lo hace el equipo técnico; ver abajo).

### 2. Cloudflare R2 (archivos)
1. En Cloudflare, activar R2 (pide tarjeta, no cobra dentro del plan gratuito) y crear el bucket `dadofit-pilot`.
2. Crear un token de API de R2 con permiso *Object Read & Write* sobre el bucket.
3. Pegar en `infra/.env.pilot`: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`).

### 3. Render (API)
1. Crear cuenta en https://render.com con GitHub y dar acceso al repositorio.
2. *New → Blueprint* → repositorio `reto-byads` → Render lee `render.yaml`.
3. Completar las variables que pide:
   - `APP_PUBLIC_URL`: la URL de Vercel (paso 4; se puede poner después y redesplegar).
   - `DATABASE_URL`: `postgresql://dadofit_api:<API_DB_PASSWORD>@<host de Neon>/neondb?sslmode=require`.
   - `API_JWT_SECRET`: el de `infra/.env.pilot`.
   - `S3_BUCKET`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: los de R2.
4. Comprobar `https://dadofit-api.onrender.com/api/ready` → `{"status":"ready"}`.

### 4. Vercel (web)
1. Crear cuenta en https://vercel.com con GitHub e importar el repositorio.
2. **Root Directory: `frontend`**. El resto lo toma de `frontend/vercel.json` (Vite, `npm run build`, salida `dist`).
3. Si el servicio de Render no se llama `dadofit-api`, ajustar el destino de `/api` en `frontend/vercel.json`.
4. Poner la URL de Vercel en `APP_PUBLIC_URL` de Render y redesplegar la API.

### Migraciones contra Neon (técnico)

```bash
# Lee NEON_OWNER_URL y API_DB_PASSWORD de infra/.env.pilot (sin imprimirlos)
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tools run --rm \
  -e PGHOST=<host> -e PGPORT=5432 -e PGDATABASE=neondb -e PGUSER=neondb_owner -e PGPASSWORD=<password> \
  -e PGSSLMODE=require -e DADOFIT_API_DB_PASSWORD=<API_DB_PASSWORD> migrate
```

### Datos iniciales (opcional)

Sembrar las cuentas demo contra la API del piloto con `SEED_PASSWORD` de `infra/.env.pilot` (nunca la contraseña local del repositorio). Durante la siembra hay que subir temporalmente en Render los límites `RATE_LIMIT_*` (ver `docs/TESTING.md`) y bajarlos al terminar.
