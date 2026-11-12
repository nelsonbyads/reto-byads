# DadoFit Docker

Todo DadoFit corre en Docker Compose; el stack completo (base de datos, API, web, correo de desarrollo, backups y TLS) vive en `infra/`. Este documento cubre el uso diario de Docker. La puesta en marcha rápida está en `README.md`, el despliegue paso a paso en `docs/DEPLOYMENT.md` y la entrega local con datos de demostración en `docs/ENTREGA_LOCAL.md`.

## Archivos

| Archivo | Rol |
| --- | --- |
| `infra/docker-compose.yml` | Stack local (proyecto Compose `reto-byads-stack`) |
| `infra/docker-compose.prod.yml` | Overrides de producción: solo Caddy publica 80/443, SMTP real, backups, límites de recursos |
| `infra/.env.example` | Plantilla de variables. Se copia a `infra/.env` (local) o a `infra/.env.prod` (producción); ninguno de los dos se versiona |
| `backend/Dockerfile` | Imagen de la API (`dadofit-api`): Node 22 Alpine, usuario `node`, sin npm/yarn en runtime |
| `frontend/Dockerfile` | Imagen web (`dadofit-web`): build de Vite + nginx sin privilegios (puerto 8080), cabeceras de seguridad, CSP y proxy `/api` |
| `infra/edge/Caddyfile` | Proxy de borde con TLS automático (producción con Compose) |
| `infra/db/` | Migraciones (`migrate.sh`), backups (`backup.sh`), simulacro de restauración y tests pgTAP |
| `infra/scripts/import-from-supabase.sh` | Importación única de datos desde Supabase |

## Servicios

| Servicio | Imagen | Puerto local | Cuándo corre |
| --- | --- | --- | --- |
| `db` | `postgres:17.6-alpine` | 127.0.0.1:55432 | Siempre |
| `api` | `dadofit-api:local` | 127.0.0.1:8782 | Siempre |
| `web` | `dadofit-web:local` | 8787 → http://localhost:8787 | Siempre |
| `mailpit` | `axllent/mailpit` | 8785 (web), 8786 (SMTP) | Desarrollo (en producción está deshabilitado) |
| `migrate` | `postgres:17.6-alpine` | — | Tarea puntual, perfil `tools` |
| `import-data` | `postgres:17.6-alpine` | — | Importación desde Supabase, perfil `tools` |
| `s3` | `adobe/s3mock` | 127.0.0.1:8788 | S3 simulado para probar `STORAGE_DRIVER=s3`, perfil `s3` |
| `sqltest` | `dadofit-sqltest:local` | — | Migraciones desde cero + pgTAP, perfil `tests` |
| `edge` | `caddy:2.10.2-alpine` | 80/443 | Solo producción con Compose |
| `backup` | `postgres:17.6-alpine` | — | Solo producción con Compose |

Todos los servicios permanentes tienen `restart: unless-stopped`: al abrir Docker Desktop se levantan solos. Si los paras a mano con `stop`, quedan parados hasta que los arranques de nuevo.

## Comandos habituales

Desde la raíz del repositorio:

```bash
C="docker compose -f infra/docker-compose.yml --env-file infra/.env"
```

| Acción | Comando |
| --- | --- |
| Primera vez | `cp infra/.env.example infra/.env` y rellenar los secretos |
| Levantar todo | `$C up -d --build` |
| Aplicar migraciones | `$C --profile tools run --rm migrate` |
| Estado y salud | `$C ps` y `curl http://127.0.0.1:8782/api/ready` |
| Logs de la API | `$C logs -f api` |
| Reconstruir tras cambiar código | `$C up -d --build api web` |
| Parar sin borrar nada | `$C stop` |
| Volver a arrancar | `$C start` |
| Consola SQL | `docker exec -it reto-byads-stack-db-1 psql -U postgres -d dadofit` |
| Tests SQL (pgTAP) | `$C --profile tests run --rm sqltest` |
| Probar la API con S3 simulado | `$C --profile s3 up -d s3` y luego `STORAGE_DRIVER=s3 S3_ENDPOINT=http://s3:9090 S3_FORCE_PATH_STYLE=true S3_ACCESS_KEY_ID=local S3_SECRET_ACCESS_KEY=local $C up -d api` |

> En Git Bash para Windows, si un comando de Docker recibe una ruta que empieza con `/` y Git Bash la convierte en una ruta de Windows, antepón `MSYS_NO_PATHCONV=1`.

## Datos y volúmenes

| Volumen | Contenido |
| --- | --- |
| `reto-byads-stack_db_data` | Base de datos Postgres |
| `reto-byads-stack_storage_data` | Evidencias y avatares (con `STORAGE_DRIVER=disk`) |
| `reto-byads-stack_caddy_data` / `reto-byads-stack_caddy_config` | Certificados TLS (solo producción con Compose) |

- **Nunca** ejecutar `docker compose down --volumes` ni `docker volume rm` sobre estos volúmenes: borra la base y los archivos sin vuelta atrás. Para parar se usa `stop`; para recrear contenedores, `up -d` (los volúmenes se conservan).
- No usar comandos de limpieza global (`docker system prune`, `docker volume prune`): afectan también a otros proyectos de la máquina.
- Antes de cambiar puertos o levantar el stack, revisar con `docker ps` que no haya otro proyecto usando 8787, 8782, 55432, 8785, 8786 u 8788.
- Copia manual de la base: `docker exec reto-byads-stack-db-1 pg_dump -U postgres -Fc dadofit > copia.dump`. La restauración está descrita en `docs/ENTREGA_LOCAL.md` §7 y `docs/DEPLOYMENT.md` §5.

## Seguridad de los contenedores

- Todos corren con `no-new-privileges`.
- `api` y `web`:
  - sin capacidades de Linux (`cap_drop: ALL`);
  - sistema de archivos raíz de solo lectura (solo `/tmp` en memoria y sus volúmenes son escribibles);
  - usuario sin privilegios: `node` en la API, `nginx` (uid 101) en la web.
- `edge` conserva solo `NET_BIND_SERVICE` para abrir 80/443.
- Las imágenes aplican `apk upgrade` al construirse. La CI las escanea con Trivy y falla si encuentra vulnerabilidades altas o críticas que ya tengan parche.
- Fuera de producción, la base de datos, la API y Mailpit solo escuchan en `127.0.0.1`. La web local escucha en todas las interfaces del equipo (puerto 8787).

## Límites de peticiones

La API limita peticiones por IP:

| Variable | Valor por defecto | Qué limita |
| --- | --- | --- |
| `RATE_LIMIT_GLOBAL_PER_MINUTE` | 300 | Todas las peticiones |
| `RATE_LIMIT_AUTH_PER_MINUTE` | 10 | Autenticación |
| `RATE_LIMIT_PUBLIC_RPC_PER_MINUTE` | 60 | RPC públicas |
| `RATE_LIMIT_UPLOADS_PER_MINUTE` | 30 | Subidas de archivos |

Los tests de integración, la siembra de datos demo y la prueba de carga simulan muchos usuarios desde la misma IP, así que necesitan arrancar la API con valores altos:

```bash
RATE_LIMIT_AUTH_PER_MINUTE=10000 RATE_LIMIT_GLOBAL_PER_MINUTE=100000 \
RATE_LIMIT_PUBLIC_RPC_PER_MINUTE=100000 RATE_LIMIT_UPLOADS_PER_MINUTE=100000 \
  $C up -d api
```

Al terminar, `$C up -d api` (sin esas variables) devuelve los límites normales.

## Problemas frecuentes

| Síntoma | Causa y solución |
| --- | --- |
| `error during connect ... dockerDesktopLinuxEngine` | Docker Desktop no está abierto. Ábrelo y espera a que diga *Engine running* |
| `port is already allocated` | Otro contenedor o programa usa ese puerto (`docker ps`). Pararlo o cambiar el puerto en `infra/.env` (`WEB_HOST_PORT`, `API_HOST_PORT`, etc.) |
| La API responde 429 | Se superó un límite de peticiones (ver la sección anterior) |
| La web carga pero no hay sesión ni datos | `api` no está sana: `$C ps` y `$C logs api` |
| `/api/ready` no responde `ready` | Postgres no está disponible, o no se puede escribir en el volumen de archivos (o en el bucket S3) |
| Cambios de código no se ven | Reconstruir con `$C up -d --build api web` |

## Legado (pendiente de retirar)

Quedan restos de la versión anterior basada en Supabase. No se deben usar y se retiran cuando se apague Supabase Cloud (ver `docs/DECISIONES_PRODUCCION.md`):

| Recurso | Qué es | Estado |
| --- | --- | --- |
| `legacy/supabase-web/` (`Dockerfile`, `docker-compose.yml`, `nginx.conf`) | Proyecto `reto-byads-web`: la web antigua, compilada contra Supabase Cloud (puerto 8781). Escribe en los datos de producción de Supabase | Contenedor `dadofit-web` detenido. Si se reconstruye con el código actual, sale una web sin API |
| Contenedores `supabase_*_reto-byads` y sus volúmenes | Supabase local que se usaba antes para desarrollar | Detenidos y vacíos |

Borrarlos es irreversible. Se hará con confirmación expresa, nombrando cada recurso.
