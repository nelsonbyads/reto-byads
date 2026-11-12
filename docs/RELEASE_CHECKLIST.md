# DadoFit — Checklist de release

Checklist para liberar una versión del backend propio (local o AWS). La versión V15.7 original queda en el historial de git.

## 1. Automático (CI)
- [ ] CI en verde. Corre estos jobs:
  - ESLint, tipos, Vitest y build;
  - guardarraíles de migraciones;
  - migraciones desde cero + pgTAP;
  - integración de la API con disco y con S3;
  - tipos de BD al día;
  - `npm audit`;
  - Trivy.
- [ ] Revisados los avisos de Trivy sobre configuración (no bloquean, pero no deben aumentar).
- [ ] Las PR de Dependabot pendientes están revisadas o descartadas con motivo.

## 2. Base de datos
- [ ] Snapshot o backup verificado antes de migrar (RDS snapshot, o `restore-check` con Compose).
- [ ] `migrate` (perfil `tools`) termina con `applied=N, already applied=M` y sin errores.
- [ ] `GET /api/ready` = `ready`.
- [ ] `select public.get_dadofit_schema_version();` devuelve la versión esperada (hoy `marketplace-partner-001-backend`).
- [ ] `check:integrity` sin filas con problemas (ver `docs/TESTING.md` §4b).

## 3. Autenticación
- [ ] Registro → correo de confirmación → login.
- [ ] Recuperación de contraseña con enlace de un solo uso.
- [ ] Usuario importado de Supabase entra con su contraseña antigua (se vuelve a cifrar con argon2id).
- [ ] Varias pestañas abiertas no cierran la sesión al renovarse.
- [ ] Cuenta suspendida queda fuera en la siguiente petición.

## 4. Retos y evidencia
- [ ] Personal → Retos muestra `1 vs 1 / Del Gym / Squads / Patrocinados / Temporadas`.
- [ ] Subir, ver (también video, con adelantar/retroceder) y borrar evidencia.
- [ ] Un archivo cuyo contenido no corresponde a su tipo es rechazado (415).
- [ ] 1v1: DC + XP.
- [ ] Squad: DC + XP + TP.
- [ ] Gym: DC + XP + Partner Points del Gym.
- [ ] Patrocinado: DC + XP + Partner Points de la marca; con doble validación pasa por auditoría.
- [ ] **Aprobar un reto con DC y un presupuesto activo funciona** (regresión del bug de `eco4c_grant_dc`).
- [ ] Sin presupuesto activo, el reto se aprueba sin DC y muestra el motivo.
- [ ] Aprobación bloqueada por anti-farming muestra `0` en la recompensa correspondiente.
- [ ] Rechazar → nueva evidencia → reenviar → aprobar.

## 5. Temporadas y competencias
- [ ] `/seasons` muestra ranking de Squads y de Gyms.
- [ ] SuperAdmin crea temporadas; dos solapadas del mismo tipo son rechazadas.
- [ ] Cerrar una temporada no borra `score_events` y el histórico sigue visible.
- [ ] Brand verificada crea competencia con al menos 2 Gyms verificados; los Gyms aceptan o rechazan y la Brand ve el estado.

## 6. Marketplace
- [ ] Premio DadoFit: canje en DC, se descuenta el saldo y aparece en "Mis canjes".
- [ ] Oferta de Gym: solo la canjean sus miembros activos y se paga en sus Partner Points.
- [ ] Oferta de Brand: se paga en sus Partner Points.
- [ ] Modos de entrega:
  - [ ] código generado;
  - [ ] código compartido;
  - [ ] lote de cupones (sin repetir códigos);
  - [ ] enlace;
  - [ ] presencial/físico.
- [ ] Presencial/físico: el proveedor busca el canje por su referencia y lo marca entregado (`ISSUED → REDEEMED`); un canje ya entregado no se vuelve a entregar.
- [ ] Saldo insuficiente, premio agotado y máximo por usuario se rechazan con mensaje claro.
- [ ] Rewards Analytics (partner y SuperAdmin) refleja los canjes.

## 7. Administración y publicidad
- [ ] `/admin` solo accesible para SuperAdmin; las 10 secciones cargan.
- [ ] Verificar organización y habilitar su economía.
- [ ] Crear, aprobar, pausar y cancelar presupuestos DC.
- [ ] Crear campaña de publicidad, asignar ubicaciones y activarla. Se ve en escritorio (rieles), laptop (dock inferior) y móvil (banner).
- [ ] Impresiones y clics se registran; el reporte se exporta a CSV y Excel.

## 8. Permisos (RBAC)
- [ ] Owner/Admin de Gym: gestión completa de ofertas y competencias.
- [ ] Coach: opera retos, sin administrar ofertas ni competencias.
- [ ] Member: solo participa.
- [ ] Un usuario sin rol no puede ejecutar RPC privilegiadas aunque las llame directamente.

## 9. Infraestructura
- [ ] Imágenes etiquetadas (`IMAGE_TAG=<versión>`) y construidas desde un commit limpio.
- [ ] Contenedores `healthy`; refresh directo de rutas internas sin 404; la media carga.
- [ ] Logs sin tokens (ni en nginx/Caddy ni en la API).
- [ ] En AWS: alarmas de CloudWatch activas, backups y PITR de RDS activos, bucket S3 privado con versionado.

## 10. Repositorio
- [ ] `git status` revisado: sin `infra/.env*`, `infra/seed/` ni dumps.
- [ ] No se subieron secretos.
- [ ] `data/`, `images/`, `videos/`, `LICENSE` y `NOTICE.md` conservados.
- [ ] README, `docs/ARCHITECTURE.md` y este checklist al día.
- [ ] Cambios integrados por pull request con CI en verde, sin push directo a `main`.
- [ ] Rollback preparado: `IMAGE_TAG` anterior anotado (las migraciones son aditivas).
