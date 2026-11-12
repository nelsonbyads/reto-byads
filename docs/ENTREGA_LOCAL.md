# DadoFit — Entrega para ejecución local

Estado al 2026-11-11. DadoFit corre completo en Docker, sin Supabase: base de datos Postgres, API propia (autenticación, datos y archivos), web y correo de desarrollo. Los datos reales de Supabase Cloud ya se importaron y la base local está poblada con datos de demostración para probar todos los módulos.

## 1. Requisitos

- Docker Desktop (Windows/macOS) o Docker Engine con Compose v2.
- Node.js 22 (solo para los scripts de prueba y siembra; la app corre en contenedores).
- Puertos libres en 127.0.0.1: 8787 (web), 8782 (API), 55432 (Postgres), 8785/8786 (Mailpit).

## 2. Arranque

```bash
cp infra/.env.example infra/.env        # solo la primera vez; rellenar POSTGRES_PASSWORD, API_DB_PASSWORD y API_JWT_SECRET
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tools run --rm migrate
```

| Servicio | URL |
| --- | --- |
| App web | http://localhost:8787 |
| Correos (confirmación, recuperación) | http://localhost:8785 |
| API (salud) | http://localhost:8782/api/ready |

Los contenedores tienen `restart: unless-stopped`: al abrir Docker Desktop la app vuelve a levantarse sola.

## 3. Cuentas de demostración

Todas usan la contraseña **`DadoFit-Demo-2026!`** (solo local). La lista completa con IDs queda en `infra/seed/demo-users.json` (ignorado por git).

| Rol | Correo | Qué ver |
| --- | --- | --- |
| Superadmin | `admin@demo.dadofit.test` | `/admin`: usuarios, organizaciones, presupuestos DC, premios, publicidad, temporadas, auditoría |
| Dueño de gimnasio | `gym1@demo.dadofit.test` … `gym6@…` | Elegir el gym en el selector de espacio (arriba): panel, retos, revisión de evidencias, ofertas, validación de canjes |
| Dueño de marca | `brand1@demo.dadofit.test` … `brand4@…` | Elegir la marca: campañas, retos patrocinados, competencias, ofertas |
| Co-admin de marca (doble validación) | `brand1-coadmin@demo.dadofit.test` | Auditoría de retos patrocinados de Andes Sportswear |
| Atletas | `atleta001@demo.dadofit.test` … `atleta120@…` | Entrenar, retos (1 vs 1, gym, squad, patrocinados), premios, canjes, notificaciones |

## 4. Qué contiene la base de demostración

Generada por `backend/scripts/seed-demo.mjs`, que recorre los flujos **por la API real**, como cada tipo de usuario, de modo que todas las reglas de negocio se aplican igual que en uso normal:

| Módulo | Volumen |
| --- | --- |
| Usuarios | 140 (8 reales importados + 132 demo) |
| Organizaciones | 6 gimnasios y 4 marcas demo (verificados, con su moneda propia y presupuesto de 5.000 DC) + las 5 reales |
| Comunidades | 150 membresías de gimnasio, 6 squads, amistades (Gymbros) |
| Retos | 18 de gimnasio, 60 directos 1 vs 1, 3 batallas de squads, 8 patrocinados (uno con doble validación) — 889 participaciones y 733 evidencias subidas |
| Marketplace | 8 premios DadoFit (en DC) + 30 de partners (en puntos del gym o la marca), con los cinco modos de entrega (código generado, compartido, lote de cupones, enlace, presencial) |
| Canjes | 408, de los cuales 70 entregados y validados por el proveedor |
| Publicidad | 12 campañas en 7 ubicaciones, más de 3.000 impresiones y 148 clics registrados |
| Otros | 2 temporadas competitivas, solicitudes de soporte, notificaciones |

## 5. Verificaciones realizadas

- **Integridad de la economía** (`npm --prefix backend run check:integrity`): 12/12 controles OK.
  - Saldos de DadoCoins y de puntos iguales a la suma de sus movimientos, sin saldos negativos.
  - Presupuestos DC nunca sobrepasados y consistentes con sus movimientos.
  - Canjes dentro del inventario y del máximo por usuario.
  - Cupones asignados una sola vez; cada evidencia con su archivo.
- **Reglas de negocio:** la siembra comprobó que la API rechaza lo que debe rechazar: saldo insuficiente, premio agotado, gimnasio del que no se es miembro, límites anti-abuso. No hubo ningún error interno en la corrida final.
- **Compra real desde la interfaz:** un atleta canjeó un cupón de 10 DC. Su saldo bajó de 12 a 2, recibió un código del lote y el canje apareció en "Mis canjes".
- **Navegador:** se recorrieron los paneles de superadmin, gimnasio, marca y atleta con datos, sin errores.
- **Carga** (`npm --prefix backend run load:test`, 40 usuarios con sesión y una mezcla de lecturas típicas de la app):

| Concurrencia | Peticiones/s | Mediana | p95 | Errores |
| --- | --- | --- | --- | --- |
| 1 | 118 | 5 ms | 28 ms | 0 |
| 25 | 186 | 116 ms | 261 ms | 0 de 5.613 |
| 60 | 178 | 311 ms | 536 ms | 0 de 5.411 |

  El tope local (~180 peticiones/s) lo marcan el pool de 10 conexiones a Postgres y un solo proceso de API. En AWS se escala con más réplicas de la API (el código ya lo permite con almacenamiento S3) y con `DATABASE_POOL_MAX`. La consulta más pesada es el listado de retos (28 ms sin carga) por sus reglas de seguridad por fila; es la primera candidata a optimizar si crece.
- **Pruebas automáticas:** API 46/46 (con disco y con S3), economía 3/3, frontend 172/172, ESLint sin errores, TypeScript sin errores.

## 6. Bug encontrado y corregido

La siembra destapó un fallo que también existe en producción (Supabase): **al aprobar un reto con recompensa en DadoCoins y un presupuesto activo, la API devolvía error 500** (`column reference "new_balance" is ambiguous` en `eco4c_grant_dc`). No se notaba porque en producción no hay presupuestos activos.

- **Corrección:** `database/migrations/20261111120000_fix_eco4c_grant_dc_ambiguous_balance.sql`.
- **Prueba de regresión:** en `backend/test/economy.integration.test.js`; falla sin la corrección y pasa con ella.
- **Producción en Supabase:** si se activan presupuestos DC allí antes de migrar a AWS, hay que aplicarle esta corrección primero.

## 7. Repetir o reiniciar las pruebas

```bash
# Volver a los datos reales importados (borra los datos demo)
docker compose -f infra/docker-compose.yml --env-file infra/.env stop api web
docker cp infra/seed/datos-reales-antes-de-siembra.dump reto-byads-stack-db-1:/tmp/base.dump
docker exec reto-byads-stack-db-1 sh -c 'dropdb -U postgres --force dadofit && createdb -U postgres dadofit && pg_restore -U postgres -d dadofit --no-owner /tmp/base.dump'
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tools run --rm migrate
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d api web
```

Para volver a sembrar, la API debe arrancar con límites altos, porque todos los usuarios simulados salen de la misma IP. Después hay que devolverla a los normales:

```bash
RATE_LIMIT_AUTH_PER_MINUTE=10000 RATE_LIMIT_GLOBAL_PER_MINUTE=100000 RATE_LIMIT_PUBLIC_RPC_PER_MINUTE=100000 RATE_LIMIT_UPLOADS_PER_MINUTE=100000 \
  docker compose -f infra/docker-compose.yml --env-file infra/.env up -d api
DATABASE_ADMIN_URL=postgres://postgres:<POSTGRES_PASSWORD>@127.0.0.1:55432/dadofit npm --prefix backend run seed:demo
DATABASE_ADMIN_URL=postgres://postgres:<POSTGRES_PASSWORD>@127.0.0.1:55432/dadofit npm --prefix backend run check:integrity
npm --prefix backend run load:test
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d api      # límites normales
```

Antes de sembrar otra vez hay que restaurar la base: el script se niega a correr si ya existen cuentas `@demo.dadofit.test`.

## 8. Para el despliegue en AWS

- Decisiones tomadas y pendientes: `docs/DECISIONES_PRODUCCION.md`.
- Guía técnica: `docs/DEPLOYMENT.md` §9 (RDS, S3, SES, Secrets Manager y CloudWatch ya soportados por el código).
- Migración de los datos reales: `docs/DEPLOYMENT.md` §6. Ya se ensayó con éxito contra Supabase Cloud.
- No usar los datos demo en producción: el despliegue parte de una base vacía y se importa desde Supabase.
