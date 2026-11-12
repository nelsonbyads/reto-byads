# DadoFit — Decisiones de producción (checklist)

Destino acordado: **AWS**. Este documento registra lo decidido y lo que falta, con opciones y una recomendación. Se completa por rondas de preguntas; al cerrar cada punto se marca aquí y, si cambia el código o la operación, en `docs/DEPLOYMENT.md` §9.

## Decidido (2026-11-11)

- [x] **Base de datos:** RDS PostgreSQL. Backups automáticos y restauración a cualquier momento (PITR) resuelven la pérdida máxima de 24 h del backup diario actual. La API soporta TLS `verify-full`.
- [x] **Archivos (evidencias y avatares):** S3. Implementado como `STORAGE_DRIVER=s3`; el disco local sigue para desarrollo.
- [x] **Correo:** Amazon SES vía SMTP (sin cambios de código).
- [x] **Secretos:** Secrets Manager / SSM Parameter Store. La API acepta `<NOMBRE>_FILE` además de variables de entorno.
- [x] **Logs y alertas:** CloudWatch.
- [x] **Región:** us-east-1 (Virginia).
- [x] **Alcance de deuda de código (esta tanda):** base + refactor ligero (ESLint/Prettier, CI con lint/tests/escaneo, tipos compartidos, partir las páginas más grandes).
- [x] **Supabase Cloud (2026-11-11):** se conserva intacto como copia de respaldo hasta que la app esté en AWS con backups de RDS; luego se retira. Sus datos ya se importaron a Docker y se verificaron.
- [x] **Entrega actual:** lo exigido es que funcione en local; está cumplido y documentado en `docs/ENTREGA_LOCAL.md`.

## Pendiente de decidir

### 1. Cómputo — *bloquea el diseño de despliegue*
- [ ] ¿Dónde corren `api` y `web`?
  - **ECS Fargate (recomendado):** sin servidores que mantener, escala por réplicas, despliegues sin corte; ALB delante con certificado de ACM. Coste base mayor (~ALB + tareas).
  - **EC2 + Docker Compose:** el mismo `infra/` de hoy en una instancia; más barato y simple, pero el sistema operativo y los parches son nuestros.
  - **Lightsail:** precio fijo y lo más simple; se queda corto si crece.

### 2. Dominio y DNS
- [ ] Dominio definitivo y si `www` redirige al principal.
- [ ] DNS en Route 53 (recomendado: certificados ACM y registros SES se validan solos) o en el proveedor actual.

### 3. Entornos
- [ ] ¿Staging separado de producción?
  - **Sí, cuenta/entorno de staging pequeño (recomendado):** probar migraciones contra RDS real antes de producción.
  - **No:** solo producción; las pruebas quedan en local/CI.

### 4. Retención y recuperación
- [ ] Retención de backups automáticos de RDS: 7 días (por defecto) / 14 / 35 (máximo).
- [ ] Versionado y ciclo de vida del bucket S3: conservar versiones borradas N días (recomendado 30).
- [ ] ¿Snapshot manual de RDS antes de cada despliegue con migraciones? (recomendado: sí).

### 5. Alertas
- [ ] ¿Quién recibe las alarmas de CloudWatch y por qué canal? (correo vía SNS / Slack / ambos).
- [ ] Umbrales: API no disponible > 2 min, errores 5xx, fallos de correo, almacenamiento libre de RDS < 20 %.

### 6. Corte (M12)
Hoy el proyecto solo lo usa una persona, así que el corte se reduce a desplegar en AWS, importar (ya ensayado: menos de un minuto) y apuntar el dominio. No hace falta ventana de mantenimiento.
- [ ] Si en el momento del corte hay usuarios reales, fijar ventana de mantenimiento para congelar escrituras en Supabase.
- [ ] Verificación ECO‑4B (paso 2) en Supabase Cloud — solo la puede correr quien tiene acceso.
- [ ] Retirar Supabase y los archivos legados una vez verificados los datos en AWS (confirmación expresa por recurso).

### 7. Repositorio
- [ ] Multimedia (`images/`, `videos/`) dentro de git: moverla a S3/CloudFront, a Git LFS, o dejarla como está.
- [ ] Formatear todo el código con Prettier en un commit dedicado (cambia ~100 archivos solo en formato).
- [ ] Fijar las GitHub Actions por SHA en lugar de etiqueta (más seguro ante etiquetas movidas; Dependabot las mantiene).

## Riesgos aceptados

- **npm audit (moderado, solo desarrollo):** `minimatch` dentro de `typescript-eslint` (ReDoS en patrones glob propios del linter). No llega a producción; se resolverá con la próxima versión de typescript-eslint vía Dependabot.
- **Imagen `sqltest` como root:** solo se usa en CI para las pruebas pgTAP; no se despliega.
- **S7:** aceptado en la revisión de seguridad anterior.
