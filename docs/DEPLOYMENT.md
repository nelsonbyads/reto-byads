# DadoFit - Deployment Guide (backend propio en Docker)

Todo el sistema corre en Docker Compose (`infra/`). No hay dependencias de Supabase.

## 1. Servicios

| Servicio | Imagen | Rol | Expuesto en producción |
| --- | --- | --- | --- |
| `edge` | `caddy:2.10.2-alpine` | TLS automático, redirección www | 80/443 (único) |
| `web` | `dadofit-web:<tag>` (nginx sin privilegios, puerto 8080) | SPA + proxy `/api`, cabeceras de seguridad y CSP | no |
| `api` | `dadofit-api:<tag>` (Node 22) | auth, datos, archivos | no |
| `db` | `postgres:17.6-alpine` | datos y lógica SQL | no |
| `backup` | `postgres:17.6-alpine` | `pg_dump` + archivos, rotación | no |
| `migrate` | `postgres:17.6-alpine` | aplica migraciones (tarea, perfil `tools`) | no |
| `import-data` | `postgres:17.6-alpine` | importación única desde Supabase (perfil `tools`) | no |
| `mailpit` | `axllent/mailpit` | correo de desarrollo (deshabilitado en producción) | no |
| `s3` | `adobe/s3mock` | S3 simulado para probar `STORAGE_DRIVER=s3` (perfil `s3`, solo desarrollo/CI) | no |

Volúmenes: `db_data` (Postgres), `storage_data` (evidencias con `STORAGE_DRIVER=disk`), `caddy_data`/`caddy_config` (certificados). Backups en `BACKUP_DIR` del host.

Endurecimiento de contenedores: todos con `no-new-privileges`; `api` y `web` además sin capacidades (`cap_drop: ALL`), con el sistema de archivos raíz de solo lectura (solo `/tmp` en memoria y sus volúmenes son escribibles) y como usuarios sin privilegios (`node`, `nginx` uid 101); `edge` conserva únicamente `NET_BIND_SERVICE`. La imagen de la API no incluye npm/yarn/corepack y ambas aplican `apk upgrade` al construirse.

## 2. Configuración

1. Copiar `infra/.env.example` a `infra/.env.prod` (no se versiona) y rellenar:
   - `POSTGRES_PASSWORD`, `API_DB_PASSWORD`, `API_JWT_SECRET` (aleatorios, ≥32 caracteres).
   - `DOMAIN`, `ACME_EMAIL` (certificado TLS).
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (proveedor real).
   - `BACKUP_DIR` (ruta del host sincronizada fuera del servidor).
   - `IMAGE_TAG` (versión a desplegar, p. ej. el SHA del commit).
   - Archivos: `STORAGE_DRIVER=disk` (volumen) o `s3` con `S3_BUCKET`, `S3_REGION` y opcionalmente `S3_PREFIX`/`S3_SERVER_SIDE_ENCRYPTION`. En AWS las credenciales vienen del rol IAM (no se configuran claves).
   - Base de datos con TLS (RDS): `DATABASE_SSL=verify-full` y `DATABASE_SSL_CA_FILE` con el bundle de CA de RDS.
   - Secretos como archivos: cualquier variable de la API admite `<NOMBRE>_FILE` (p. ej. `API_JWT_SECRET_FILE=/run/secrets/jwt`), para Docker secrets o valores de Secrets Manager/SSM montados como archivo. No se pueden definir ambas formas a la vez.
2. El DNS de `DOMAIN` (y `www.DOMAIN`) debe apuntar al servidor antes de arrancar `edge`.

## 3. Primer despliegue

```bash
C="docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file infra/.env.prod"
$C up -d db
$C --profile tools run --rm migrate
# (solo una vez, si se migran datos desde Supabase: ver sección 6)
$C up -d --build api web edge backup
curl -fsS https://$DOMAIN/api/ready
```

## 4. Actualizaciones y rollback

```bash
export IMAGE_TAG=<nueva versión>
$C build api web
$C --profile tools run --rm migrate      # las migraciones son aditivas
$C up -d api web                          # sin "down": la base y los volúmenes no se tocan
```

Rollback: `IMAGE_TAG=<versión anterior> $C up -d api web`. Las migraciones no se revierten automáticamente; por eso deben ser compatibles hacia atrás (añadir antes de quitar). Si una migración requiere revertirse, hacerlo con una migración nueva.

Nunca usar `docker compose down --volumes` en producción: borra la base de datos y las evidencias.

## 5. Backups y restauración

- El servicio `backup` genera cada `BACKUP_INTERVAL_SECONDS` (por defecto 24 h):
  - `BACKUP_DIR/db/dadofit-<fecha>.dump` (`pg_dump` formato custom) + `.sha256`
  - `BACKUP_DIR/storage/storage-<fecha>.tar.gz` (evidencias) + `.sha256`
  - borra los de más de `BACKUP_RETENTION_DAYS` (14).
- `BACKUP_DIR` debe sincronizarse fuera del servidor (rclone/rsync/objeto S3 del proveedor).
- Simulacro de restauración (no toca la base en vivo; restaura en una base temporal, compara y la borra):

```bash
$C run --rm --entrypoint sh \
  -v "$PWD/infra/db/restore-check.sh:/usr/local/bin/restore-check:ro" \
  backup /usr/local/bin/restore-check /backups/db/<archivo>.dump
```

- Restauración real (desastre): detener `api`, restaurar con `pg_restore --clean --if-exists --no-owner -d dadofit <archivo>.dump`, extraer el tar de storage en el volumen `storage_data`, ejecutar `migrate`, arrancar `api`.
- Pendiente recomendado: archivado continuo de WAL para recuperación a un punto en el tiempo (hoy la pérdida máxima es el intervalo de backup).

## 6. Migración de datos desde Supabase (una sola vez)

1. Congelar escrituras en la aplicación actual (ventana de mantenimiento).
2. Importar base de datos (solo lee el origen; reemplaza los datos del destino):

```bash
$C --profile tools run --rm \
  -e SOURCE_DATABASE_URL='postgres://postgres.<ref>:<password>@<host>:5432/postgres' \
  -e CONFIRM_REPLACE_TARGET_DATA=yes import-data
```

   Termina con una tabla origen | destino (usuarios, saldos, retos, canjes, objetos…) y falla si algo no coincide.
3. Copiar archivos de Storage al volumen:

```bash
$C run --rm --no-deps \
  -e DATABASE_ADMIN_URL='postgres://postgres:<POSTGRES_PASSWORD>@db:5432/dadofit' \
  -e SOURCE_STORAGE_URL='https://<ref>.supabase.co/storage/v1' \
  -e SOURCE_SERVICE_KEY='<service role key>' \
  api node scripts/import-storage-files.mjs
```

4. Las contraseñas existentes (bcrypt) siguen funcionando y se re-cifran con argon2id en el siguiente login. Todas las sesiones anteriores quedan cerradas: los usuarios vuelven a iniciar sesión.
5. Smoke test y cambio de DNS. Supabase Cloud queda intacto como rollback durante el periodo acordado.

## 7. Observabilidad

- Logs JSON de la API (`docker compose logs api`), con cabeceras sensibles redactadas y sin query strings. nginx y Caddy tampoco registran tokens (query sin `token`/`confirm`, sin Referer).
- Registro, recuperación y reenvío de confirmación responden en un tiempo mínimo uniforme (`AUTH_UNIFORM_RESPONSE_MS`, 400 ms) y envían el correo después de responder: un fallo de SMTP solo aparece en los logs (`deferred mail failed` / `mail delivery failed`), así que conviene alertar sobre esos mensajes.
- La API purga cada hora las tablas de autenticación (intentos de login > 30 días, tokens caducados hace > 7 días). Ajustable con `AUTH_PURGE_INTERVAL_MINUTES`, `AUTH_LOGIN_ATTEMPTS_RETENTION_DAYS`, `AUTH_EXPIRED_TOKENS_RETENTION_DAYS`.
- IP del cliente: la API confía en `X-Forwarded-For` solo para saltos de red privada (los proxies de Docker), hasta `API_TRUST_PROXY_HOPS` (1 en local, 2 en producción). Si se añade otro proxy delante (CDN, balanceador), subir el número; si no, todos los clientes compartirían la IP del proxy en los límites y el bloqueo de login.
- `GET /api/health` (vivo) y `GET /api/ready` (Postgres + almacenamiento).
- Rotación de logs de Docker: 5 × 10 MB por servicio.
- Pendiente recomendado: enviar logs a un agregador y alertar sobre `/api/ready`, espacio en disco y antigüedad del último backup. En AWS: CloudWatch (ver §9).

## 8. Escalado y límites conocidos

- `web` y `edge` escalan sin estado.
- `api` escala horizontalmente con `STORAGE_DRIVER=s3` (los archivos ya no dependen del disco del contenedor). Con `disk`, varias réplicas necesitarían un volumen compartido.
- Los límites de peticiones por IP (`RATE_LIMIT_*`) son por proceso; con varias réplicas, cada una aplica su propio contador.
- Postgres es un único nodo; la alta disponibilidad requiere una réplica en caliente (fuera del alcance actual).

## 9. Destino AWS (decisiones tomadas el 2026-11-11)

Ver `docs/DECISIONES_PRODUCCION.md` para el checklist completo. Resumen de lo ya preparado en el código:

| Pieza | Servicio AWS | Estado en el código |
| --- | --- | --- |
| Base de datos | RDS PostgreSQL 17 (us-east-1), backups automáticos + PITR | TLS `verify-full` soportado. Pendiente validar las migraciones contra una instancia RDS de prueba: el usuario maestro es `rds_superuser`, no superusuario, y la capa de compatibilidad crea `service_role` con `BYPASSRLS` y las funciones `security definer` dependen de que su dueño sea el dueño de las tablas. `pgcrypto` está permitido en RDS. |
| Archivos | S3 (bucket privado, cifrado SSE, bloqueo de acceso público, versionado) | `STORAGE_DRIVER=s3`; la API sigue firmando URLs y verificando tamaño y contenido, los bytes pasan por la API. |
| Correo | Amazon SES por SMTP | Sin cambios de código: `SMTP_HOST=email-smtp.us-east-1.amazonaws.com`, puerto 587, credenciales SMTP de SES. Requiere verificar dominio (DKIM/SPF/DMARC) y salir del sandbox. |
| Secretos | Secrets Manager / SSM Parameter Store | ECS los inyecta como variables; en EC2 pueden montarse como archivo y leerse con `<NOMBRE>_FILE`. |
| Logs y alarmas | CloudWatch Logs + alarmas | La API ya emite JSON. Filtros de métricas sugeridos: `deferred mail failed`, `mail delivery failed`, `level >= 50`; alarmas sobre `/api/ready` (health check del balanceador), CPU/memoria, almacenamiento libre de RDS. |
| Cómputo | Por decidir (ECS Fargate, EC2 + Compose o Lightsail) | Las imágenes no dependen de la opción. Con Fargate/ALB: `edge` (Caddy) no se usa, el ALB termina TLS y `API_TRUST_PROXY_HOPS` debe contar ALB + nginx (2). |

Con S3 y RDS, el servicio `backup` deja de ser necesario: RDS hace snapshots y PITR, y el bucket S3 usa versionado (más AWS Backup si se quiere retención centralizada).

Migrar archivos del volumen local o de Supabase a S3: `scripts/import-storage-files.mjs` escribe en el backend configurado (`STORAGE_DRIVER=s3` + variables `S3_*`).

