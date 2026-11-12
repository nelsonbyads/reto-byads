# DadoFit — Arquitectura

Estado al 2026-11-12: backend propio en Docker (sin Supabase), preparado para AWS. Este documento describe cómo está construido el sistema; la operación está en `docs/DEPLOYMENT.md` y `DOCKER.md`, y la historia de la migración en `docs/SPEC_MIGRACION_BACKEND_PROPIO.md`.

## 1. Tipo de aplicación

DadoFit es una SPA (Single Page Application) en React 18 + TypeScript + Vite, con enrutamiento en el cliente (`BrowserRouter`). Habla con una API propia, en el mismo origen y bajo `/api`, que traduce cada petición en operaciones sobre PostgreSQL. La lógica de negocio (economía, retos, permisos y anti-farming) vive en SQL.

## 2. Capas

```text
Navegador (SPA)
  |
  v
edge  ── Caddy con TLS (Compose)  |  ALB + ACM (AWS)
  |
  v
web   ── nginx sin privilegios: SPA, cabeceras de seguridad, CSP, proxy /api
  |
  v  /api
api   ── Node 22 + Fastify (backend/)
  |      +-- /api/auth   registro, login, refresh, logout, confirmación, recuperación
  |      +-- /api/rpc    funciones SQL de una lista blanca            (backend.rpc())
  |      +-- /api/db     consultas acotadas por tabla/acción/columna  (backend.from())
  |      +-- /api/files  URLs firmadas de subida/descarga             (backend.storage)
  |
  +----> PostgreSQL 17 (Docker local | RDS en AWS)
  |        +-- RLS en todas las tablas de negocio
  |        +-- RPC SECURITY DEFINER: economía, retos, anti-farming, marketplace, publicidad
  |        +-- auth.users / auth.uid() y storage.objects (capa de compatibilidad, database/compat)
  |
  +----> Almacenamiento de archivos (STORAGE_DRIVER)
  |        +-- disk: volumen local (desarrollo)
  |        +-- s3:   Amazon S3 (producción)
  |
  +----> SMTP (Mailpit en local | Amazon SES en producción)
```

### Contexto por petición

Cada petición autenticada se ejecuta en una transacción con:
- `SET LOCAL ROLE anon` o `SET LOCAL ROLE authenticated`;
- el usuario en `request.jwt.claim.sub`.

Así, RLS y `auth.uid()` funcionan igual que cuando el backend era Supabase. La API se conecta con el rol de mínimo privilegio `dadofit_api`, nunca como dueña de la base. Algunas operaciones (purga de tablas de autenticación, bootstrap del perfil) usan funciones `SECURITY DEFINER` acotadas.

### Lista blanca

- **RPC:** solo se pueden llamar las funciones de `backend/src/rpcAllowlist.js`.
- **Tablas:** `/api/db` solo permite las operaciones de `TABLE_ALLOWLIST` (`backend/src/catalog.js`); por ejemplo, `friendships` admite escritura y `wallets` solo lectura.
- **Catálogo:** al arrancar, la API lee de la base la firma de cada función y las columnas de cada tabla, y valida contra eso cada petición.

### Tipos compartidos

`backend/scripts/generate-db-types.mjs` genera `frontend/src/types/database.ts` desde el esquema, con argumentos y resultados de cada RPC y columnas de cada tabla.
- `backend.rpc()` y `backend.from()` validan en compilación el nombre y los argumentos.
- La CI regenera los tipos sobre una base recién migrada y falla si el archivo quedó desactualizado.

## 3. Autenticación y sesión

- **Contraseñas:** argon2id. Las importadas de Supabase (bcrypt) se aceptan y se vuelven a cifrar con argon2id en el siguiente login.
- **Sesión:**
  - **access token:** HS256, 15 min, guardado solo en memoria del navegador;
  - **refresh token:** opaco y rotativo, en la cookie `dadofit_rt` (`httpOnly`, `SameSite=Strict`);
  - **reutilización:** detección por familia, con margen para refrescos simultáneos de varias pestañas.
- **CSRF:** doble envío (cookie `dadofit_csrf` + cabecera `X-CSRF-Token`) en refresh y mutaciones de autenticación.
- **Correo:** confirmación de cuenta y recuperación de contraseña con tokens de un solo uso. El token viaja en el fragmento de la URL (`#token=`), para que no llegue a los logs.
- **Protección contra abuso:**
  - límites por IP;
  - bloqueo por correo + IP, con un tope adicional por cuenta;
  - tiempos de respuesta uniformes en registro y recuperación, para no revelar qué cuentas existen;
  - suspensión de cuentas aplicada en cada petición.
- **IP real del cliente:** se toma de `X-Forwarded-For`, confiando solo en saltos de red privada (`API_TRUST_PROXY_HOPS`).

## 4. Workspaces y roles

Una sola identidad por persona y varios contextos:

| Workspace | Qué incluye |
| --- | --- |
| Personal | Entrenamiento con dados, Gymbros, retos 1v1, Squads, retos de Gym y patrocinados como participante, XP, DadoCoins, premios y canjes |
| Gym | Miembros y roles, retos del Gym, revisión de evidencias, Gym vs Gym, Partner Points propios, ofertas, validación de canjes, temporadas |
| Brand | Equipo, campañas, Branded Challenges, revisión (y auditoría con doble validación), Partner Points propios, ofertas, competencias patrocinadas de Gyms |
| SuperAdmin (`/admin`) | Usuarios, organizaciones (verificación), presupuestos DC, economías partner, premios DadoFit, publicidad, temporadas, soporte y auditoría |

- **Capacidades al registrarse:** el tipo de cuenta (`personal`, `gym` o `brand`) define qué organizaciones puede crear la persona.
- **Verificación:** una organización empieza en `pending_verification`. El SuperAdmin la verifica y habilita su economía; sin eso no puede emitir puntos ni publicar ofertas.
- **Roles de organización:** Owner, Admin, Coach y Member. Los permisos se validan en SQL, no solo en la interfaz.
- **SuperAdmin:** se define con una fila `role='superadmin'` en `public.platform_admins`.

## 5. Economía

| Concepto | Qué es | Dónde se gasta |
| --- | --- | --- |
| XP | Progresión, no gastable | — |
| DadoCoins (DC) | Moneda universal de DadoFit | Marketplace DadoFit |
| Partner Points | Moneda propia de cada Gym o Brand, con nombre configurable (internamente `gp`/`sp`) | Ofertas de ese partner |
| Team Points / Competitive Score | Puntaje competitivo de Squads y Gyms para temporadas | — |

### Emisión de DadoCoins
- **Presupuestos:** las recompensas en DC salen de presupuestos (`dc_budgets`) que crea y aprueba el SuperAdmin, por organización o internos de DadoFit. Cada movimiento queda en `dc_budget_transactions`.
- **Sin presupuesto:** si no hay presupuesto activo, el reto se aprueba sin DC y queda registrado el motivo (`dc_block_reason`).

### Partner Points
Solo se emiten y gastan si la organización está verificada y tiene su economía habilitada.

### Anti-farming

```text
COMPLETAR UN RETO != TENER DERECHO A RECOMPENSA
```

Hay reglas separadas para 1v1, Squads, Gym y patrocinados. Por ejemplo:
- una recompensa por pareja (creador → participante) cada 24 h;
- un máximo diario de recompensas por usuario.

El reto se aprueba igual, pero sin recompensa adicional, y queda registrado el motivo.

### Idempotencia y auditoría
Cada pago lleva una clave de idempotencia. Los saldos se mueven solo desde funciones de servidor y siempre dejan movimiento en un ledger:
- `wallet_transactions`;
- `gym_point_ledger`;
- `sponsor_point_ledger`.

`backend/scripts/check-integrity.mjs` verifica que todo cuadre: saldos, presupuestos, inventarios y cupones.

## 6. Retos y evidencia

### Tipos de reto
| Tipo | Funcionamiento |
| --- | --- |
| 1v1 | Entre Gymbros. Revisa quien creó el reto |
| Squad vs Squad | Revisa el capitán contrario |
| Gym | Participan automáticamente todos los miembros. Revisa un manager del Gym |
| Gym vs Gym | Entre gimnasios |
| Patrocinado de marca | Metas por repeticiones, tiempo, distancia o cantidad. Doble validación opcional: revisión + auditoría por otro admin |

### Ciclo
```text
invitado/aceptado -> evidencia -> enviado -> aprobado | rechazado -> (nueva evidencia -> reenviado)
```

### Archivos de evidencia
- **Subida:** la API autoriza cada subida, descarga o borrado con las políticas RLS de `storage.objects` y emite URLs firmadas (HMAC) de corta duración. Los bytes siempre pasan por la API.
  - El tamaño máximo se controla en el flujo (50 MB por defecto).
  - Se comprueba la firma real del archivo (JPEG, PNG, WebP, MP4, QuickTime, WebM). Un archivo cuyo contenido no corresponde al tipo declarado se rechaza (415) y no se guarda.
  - Una fila de `challenge_evidence` solo se acepta si el archivo existe y está en la carpeta del propio participante.
- **Descarga:** soporta `Range`, para poder adelantar los videos.

## 7. Marketplace

- **DadoFit:** premios universales pagados en DC y gestionados por el SuperAdmin.
- **Partners:** ofertas de cada Gym o Brand, pagadas en sus Partner Points. Las de un Gym solo las pueden canjear sus miembros activos.
- **Modos de entrega:** código generado, código compartido, lote de cupones, enlace de canje y entrega presencial/física. En estos dos últimos, el proveedor busca el canje por su referencia y lo marca como entregado.
- **Reglas:** el canje es transaccional y valida saldo, inventario, máximo por usuario y vigencia; cada código del lote se asigna una sola vez.

## 8. Publicidad

- **Campañas:** las crea el SuperAdmin y se asignan a ubicaciones (`workout-*`, de escritorio y móvil), con rotación.
- **Medición:** first-party, mediante `record_ad_event`: impresiones y clics con sesión, ruta y dispositivo. Los eventos repetidos en pocos segundos no se cuentan dos veces.
- **Reportes:** métricas por campaña y CTR, exportables a CSV y Excel desde el backoffice.

## 9. Seguridad

La autorización se aplica en tres niveles:

1. **Frontend:** guardas de ruta y de workspace, y visibilidad según el contexto. Es solo comodidad, no una barrera.
2. **API:** listas blancas de funciones y tablas, límites por IP y validación de sesión, CSRF y contenido de archivos. Además:
   - cabeceras de seguridad y CSP en nginx;
   - logs sin tokens ni query strings.
3. **Base de datos:** RLS, validaciones en cada RPC (membresía, rol, tipo y verificación de la organización) y restricciones `CHECK`. Por ejemplo, las URLs externas deben ser `http(s)`.

Contenedores:
- sin privilegios, sin capacidades de Linux y con sistema de archivos de solo lectura;
- imágenes escaneadas con Trivy en la CI.

La base de datos es la fuente de verdad para permisos y economía.

## 10. Operación

- **Mantenimiento:** la API purga cada hora los intentos de login viejos y los tokens caducados, con un lock de Postgres que evita choques entre varias réplicas.
- **Endpoints de salud:** `/api/health` (vivo) y `/api/ready` (Postgres y almacenamiento).
- **Logs:** JSON en stdout (en AWS, a CloudWatch).
- **Configuración:** solo por variables de entorno, o archivos `<NOMBRE>_FILE` para secretos.

### Escalado
Con `STORAGE_DRIVER=s3`, la API no guarda estado y escala con más réplicas. Los límites de peticiones se cuentan por proceso. En local, un solo proceso con un pool de 10 conexiones sirve unas 180 peticiones/s sin errores (ver `docs/ENTREGA_LOCAL.md`).

## 11. Destino AWS

| Pieza | Servicio |
| --- | --- |
| Base de datos | RDS PostgreSQL 17 (us-east-1), TLS `verify-full` |
| Archivos | S3, credenciales por rol IAM |
| Correo | Amazon SES por SMTP |
| Secretos | Secrets Manager / SSM Parameter Store |
| Logs y alarmas | CloudWatch |
| Cómputo | Por decidir: ECS Fargate, EC2 + Compose o Lightsail |

Detalles en `docs/DEPLOYMENT.md` §9 y `docs/DECISIONES_PRODUCCION.md`.

## 12. Temas visuales (oscuro, claro y pastel)

- **Atributo:** el tema se guarda en el navegador (`dadofit:theme:v15.8`) y se aplica como `<html data-dadofit-theme>`. `frontend/src/lib/theme.ts` lo aplica al arrancar, así que también rige en las páginas sin encabezado.
- **Capas compartidas:** el sistema visual (`v15.8-fitness-premium.css` y `v15.8.1-global-visual-system.css`) está escrito una sola vez y aplica a los tres temas.
- **Colores:** cada color de esas capas es `var(--dfgt-<rol>, <color oscuro original>)`. En oscuro esas variables no existen, así que se usa el color original y el tema queda idéntico al diseño de referencia. Se verificó comparando los estilos calculados de unos 3.300 elementos: sin ninguna diferencia.
- **Paletas:** `frontend/src/styles/v16-themes.css` define las paletas de claro y pastel. Contiene:
  - los roles base: fondo, paneles, texto, relleno de acento, acento como texto, superficie fuerte, tintes y sombras;
  - el mapeo de las paletas antiguas;
  - unos pocos ajustes de componentes (dock de publicidad, avatares, notificaciones, backoffice).

  Se importa al final de `main.tsx`, porque las hojas de `main.tsx` se cargan después de las de `App.tsx`.
- **Para un componente nuevo:** usar `var(--dfg-*)` (paleta del tema) en lugar de colores fijos. Si el acento va como texto, usar `--dfg-accent`; si es relleno, `--dfg-lime` con texto `--dfg-on-accent`.
- **Login, registro y páginas legales** mantienen su diseño de marca fijo en los tres temas.

## 13. Dataset de ejercicios

`frontend/data/exercises.json` (1.324 ejercicios) se compacta en `frontend/public/data/exercises.min.json` al hacer `npm run dev` y `npm run build`. Cada ejercicio incluye nombre, zona corporal, equipo, objetivo, grupo muscular, instrucciones, imagen y media.

Los retos patrocinados pueden usar un ejercicio del catálogo o una actividad personalizada.
