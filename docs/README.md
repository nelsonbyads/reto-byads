# Documentación de DadoFit

## Documentos vigentes

Estos documentos describen el sistema tal como está hoy y deben mantenerse al día.

| Documento | Para qué sirve |
| --- | --- |
| [`../README.md`](../README.md) | Presentación del proyecto y puesta en marcha rápida |
| [`ENTREGA_LOCAL.md`](ENTREGA_LOCAL.md) | Correrlo en local, cuentas de demostración y resultados de las pruebas |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Cómo está construido: capas, autenticación, economía, retos, marketplace, publicidad y seguridad |
| [`../DOCKER.md`](../DOCKER.md) | Uso diario de Docker: servicios, comandos, volúmenes y problemas frecuentes |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Configuración, despliegue, AWS, backups, importación desde Supabase y observabilidad |
| [`DECISIONES_PRODUCCION.md`](DECISIONES_PRODUCCION.md) | Checklist de decisiones para producción en AWS |
| [`TESTING.md`](TESTING.md) | Suites de pruebas, CI, datos demo, integridad y carga |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | Verificaciones antes de liberar una versión |
| [`SPEC_MIGRACION_BACKEND_PROPIO.md`](SPEC_MIGRACION_BACKEND_PROPIO.md) | Migración de Supabase al backend propio y registro de cambios posteriores |
| [`../AGENT.md`](../AGENT.md) | Guía de continuidad para quien retome el proyecto (personas o agentes) |

## Especificaciones de funcionalidades

Siguen siendo la referencia de reglas de negocio. Sus menciones a Supabase corresponden a cuando se escribieron; la implementación actual corre en el backend propio.

- [`SPEC_DADOFIT_2_1_ECONOMY_MODELO_SIMPLIFICADO.md`](SPEC_DADOFIT_2_1_ECONOMY_MODELO_SIMPLIFICADO.md) y [`DADOFIT_2_1_ECONOMY_AUDIT.md`](DADOFIT_2_1_ECONOMY_AUDIT.md): economía DadoFit 2.1.
- [`SPEC_DADOFIT_PARTNER_MARKETPLACE.md`](SPEC_DADOFIT_PARTNER_MARKETPLACE.md) y [`MARKETPLACE_PARTNER_001_BACKEND_AUDIT.md`](MARKETPLACE_PARTNER_001_BACKEND_AUDIT.md): marketplace por partner.
- [`SPEC_DADOFIT_ADS_REPORT_EXPORT.md`](SPEC_DADOFIT_ADS_REPORT_EXPORT.md): exportación de reportes de publicidad.
- [`SPEC_DADOFIT_ADMIN_VISUAL_SYSTEM.md`](SPEC_DADOFIT_ADMIN_VISUAL_SYSTEM.md): sistema visual del backoffice.

## Histórico

Registros de cada versión. No se actualizan: describen el estado del proyecto en su momento.

- `V15.*-SCOPE.md`, `V15.*-VALIDATION.md` y hotfixes: alcance y validación de cada versión.
- [`DADOFIT_PRODUCT_TECH_BLUEPRINT.md`](DADOFIT_PRODUCT_TECH_BLUEPRINT.md): visión de producto y diseño técnico original (etapa Supabase).
- [`SECURITY_RUNTIME_UPDATE_2026-10.md`](SECURITY_RUNTIME_UPDATE_2026-10.md): actualización de runtimes de octubre de 2026.
