# SPEC - DadoFit Admin: Sistema Visual y UX Enterprise

> Estado: implementado (BUILD SDD INTEGRAL T1→T6). Pendiente QA humano final.
> Alcance: `/admin/*`. Dark-first, tokens semánticos y componentes reutilizables.

## 1. Contexto

El Admin es funcional, pero su presentación aún se percibe técnica y desigual. La inspección confirma que las diez vistas viven en `src/pages/AdminPage.tsx` (1.912 líneas), con dispatch por pathname y sin componentes visuales Admin extraídos. El CSS base de `v14-admin.css` es light y hardcoded; el dark theme depende de overrides posteriores en `v15.8.1-global-visual-system.css`.

Rutas incluidas: `/admin`, `/admin/users`, `/admin/organizations`, `/admin/brands`, `/admin/campaigns`, `/admin/requests`, `/admin/rewards`, `/admin/seasons`, `/admin/ads` y `/admin/audit`. No se encontraron otras subrutas administrativas.

## 2. Problemas actuales

1. `.admin-main-v14` no tiene `max-width`; el contenido se estira en pantallas grandes.
2. Tablas sin hover, con tipografía pequeña y escasa composición de celdas.
3. Acciones de fila sin jerarquía; algunas filas muestran hasta cuatro botones equivalentes.
4. Headers, filtros, métricas y estados cambian entre módulos.
5. Faltan loading states en casi todo el Admin y empty states en varias vistas.
6. No existen tokens `--admin-*`; abundan hex y fondos `#fff`.
7. Publicidad conserva una gran superficie blanca (`.admin-ad-analytics-v144`).
8. Badges pastel, search, refresh, botones de Temporadas y banners de error sobreviven claros en dark mode.
9. Auditoría y otros paneles usan scrollbars nativas blancas/gruesas.
10. El sidebar está más refinado que el contenido principal.

## 3. Objetivo

Homologar todo el Backoffice como producto enterprise terminado sin cambiar identidad, rutas, permisos, datos, lógica ni backend. Mantener fondo oscuro, lima DadoFit, tipografía y sidebar; mejorar jerarquía, composición, densidad, legibilidad, feedback y responsive.

## 4. Principios visuales

- Dark-first, no dark mediante parches.
- Un lenguaje común para layout, tablas, filtros, badges y acciones.
- Jerarquía visible: título, contexto, contenido y acción primaria.
- Densidad controlada, sin espacios muertos ni saturación.
- Contenido acotado y legible en ultrawide.
- Loading, empty y error siempre diseñados.
- Reutilizar identidad y tokens existentes.
- Extraer componentes solo cuando reduzcan duplicación real.

## 5. Sistema de layout

Se conservan `.admin-shell-v14`, `.admin-sidebar-v14` y `.admin-main-v14`. El shell mantiene grid `250px / 1fr`; el sidebar permanece sticky. El contenido usa ancho máximo de 1280px, padding uniforme y separación vertical basada en múltiplos de 4/8px.

Cada página usa `AdminPageHeader`:

1. Eyebrow `BACKOFFICE DADOFIT`.
2. Título.
3. Descripción breve.
4. Slot de acciones contextual.

El link de contacto deja de estar hardcodeado en todos los headers y pasa al footer del sidebar.

Tokens nuevos, mapeados a `--dfg-v1591-*`:

```css
--admin-surface;
--admin-surface-elevated;
--admin-surface-raised;
--admin-border;
--admin-border-neutral;
--admin-text;
--admin-muted;
--admin-accent;
--admin-danger;
--admin-warning;
--admin-success;
--admin-info;
```

## 6. Sistema de tablas

`AdminTable` conserva `.admin-table-wrap-v14` y define:

- Header legible, uppercase y muted.
- Rows de altura consistente, alineación vertical central y hover sutil.
- Bordes discretos; zebra solo si aporta en listados extensos.
- Composición `strong + small` para dato principal/secundario.
- Truncado con tooltip para email, UUID y nombres largos.
- Loading, empty y error integrados.
- Scroll horizontal controlado cuando sea necesario.
- `<th scope="col">` y `aria-sort` si existe ordenación.

## 7. Acciones

Jerarquía única:

- Primaria: fondo lima, una por contexto.
- Secundaria: superficie raised o borde neutral.
- Destructiva: danger, separada visualmente.

Por fila se muestra como máximo una acción primaria y un menú `...`. Aprobar puede permanecer visible; Pendiente, Suspender y Rechazar van al menú, con acciones de riesgo separadas. `AdminRowActions` soporta teclado, Escape, click exterior, `aria-expanded` y labels accesibles.

## 8. Badges

`AdminStatusBadge` usa radio, padding, tamaño y casing únicos:

- Success: ACTIVE, VERIFIED, COMPLETED, RESPONDED.
- Warning: PENDING, NEW, REVIEWING, UPCOMING.
- Danger: SUSPENDED, REJECTED, CANCELLED.
- Info: IN_PROGRESS, PAUSED.
- Neutral: estados desconocidos.

Los fondos son translúcidos oscuros con borde y texto semánticos, no pasteles sólidos claros.

## 9. Filtros

`AdminFilterBar` agrupa search, status, type, date range y refresh en una superficie común. Refresh se alinea al final; inputs/selects comparten altura, foco y fondo.

- Users: search, estado, refresh.
- Organizations/Brands: search, tipo, estado, refresh.
- Campaigns: estado, refresh.
- Requests: estado, refresh.
- Rewards y Ads: período, refresh.
- Audit: búsqueda y refresh.

## 10. Metric cards

`AdminMetricCard` unifica las variantes v14, v154 y v144: icono, label, valor, helper y tendencia opcional. Altura mínima 96px, padding 16-18px, valor de 24px y grid `auto-fit/minmax(200px,1fr)`. No usar bloques gigantes para métricas pequeñas.

## 11. Empty states

`AdminEmptyState` incluye icono contextual, título, explicación y acción opcional. Debe cubrir Users, Organizations/Brands, Campaigns, Requests, Rewards, Ads inventory/campaigns, Audit y Dashboard cuando corresponda.

`AdminLoadingState` usa skeleton de filas/cards y `aria-busy`; reemplaza tablas vacías y el texto aislado "Cargando...". Error y success migran a tokens dark, eliminando fondos claros de `.auth-error` y `.auth-success`.

## 12. Modulo por modulo

### Dashboard

Será referencia visual. Migrar KPIs a `AdminMetricCard`, conservar callouts con tokens y añadir loading/error consistentes.

### Usuarios

Componer Usuario como nombre principal más `@username · email`; XP/Nivel como valor y helper; estado con badge; DC, ecosistema y fecha escaneables. Añadir FilterBar, estados y RowActions.

### Organizaciones y Marcas

Mantener el componente compartido y `brandsOnly`; Marcas ya es una vista filtrada. Diferenciar contexto mediante título/filtro, no duplicar arquitectura. Sustituir cuatro botones planos por acción primaria + menú.

### Campañas

Separar Marca/Campaña, retos, participantes, aprobados, rechazados y rewards. No concatenar métricas difíciles de escanear. Añadir filtros y refinar empty state.

### Solicitudes

Conservar patrón lista/ticket, homologar cards y badges. Mostrar una acción contextual y menú; diseñar el empty state.

### Rewards Analytics

Orden: período, economía, KPIs, explicación, gráfico y tablas. Unificar cards y tablas; homologar acciones de budgets. Eliminar la clase sin estilo `admin-request-actions-v14`.

### Temporadas

Conservar layout formulario/lista. Mejorar jerarquía del formulario, picker, histórico, badges y spacing. Sustituir botones blancos `!important` por tokens dark y loading por skeleton.

### Publicidad

Prioridad alta. Sustituir `.admin-ad-analytics-v144` y superficies claras relacionadas por tokens dark. Homologar KPIs, tabla de métricas, click list, inventory, editor, guía y campañas, sin perder legibilidad analítica.

### Auditoría

Prioridad alta. Mejorar paneles, timestamps, nombres de evento y referencias. Estilizar scrollbars y añadir loading/empty/search. No cambiar backend; paginación solo si ya existe soporte.

## 13. Responsive

Validar 1920, 1440, 1280, 1024, 768 y 375.

- Desktop: sidebar 250px y contenido acotado.
- ≤1050: conservar rail de 78px existente.
- Tablet: grids a dos columnas y tablas con scroll controlado.
- ≤720: conservar sidebar como strip horizontal; header y grids en columna.
- 375: sin overflow accidental; tablas no se convierten indiscriminadamente a cards.

## 14. Accesibilidad

- Contraste WCAG: 4.5:1 texto y 3:1 controles.
- Focus visible lima consistente.
- Icon buttons con `aria-label`.
- Menús con `aria-expanded`, teclado, Escape y click exterior.
- Headers de tabla correctos.
- Loading con `aria-busy`.
- Empty states con texto, no solo iconos.

## 15. Componentes reutilizables

Crear en `src/admin/components/`:

- `AdminPageHeader`
- `AdminTable`
- `AdminFilterBar`
- `AdminMetricCard`
- `AdminStatusBadge`
- `AdminEmptyState`
- `AdminLoadingState`
- `AdminRowActions`

`AdminSection` solo se crea si durante implementación demuestra reducción real de duplicación. `AdminShell` y `useRpc` pueden extraerse sin alterar contratos.

## 16. Archivos afectados

Previstos para implementación futura:

- `src/pages/AdminPage.tsx`
- `src/styles/v14-admin.css`
- `src/styles/v14.2-monetization-network.css`
- `src/styles/v14.5-ad-campaign-management.css`
- `src/styles/v15.4-reward-analytics.css`
- `src/styles/v15.7-pre-release.css`
- `src/styles/v15.8.1-global-visual-system.css`
- nuevo `src/styles/admin-tokens.css`
- nuevos componentes bajo `src/admin/components/`

No tocar migraciones, RPCs, schema, permisos, rutas, modelo económico, datos ni textos legales.

## 17. Criterios de aceptación

- Todo el Admin mantiene dark theme consistente.
- No existen superficies blancas gigantes no intencionales.
- Headers, tablas, acciones, badges, filtros y métricas son consistentes.
- Acciones destructivas están diferenciadas.
- Spacing y max-width son uniformes.
- Todos los fetch tienen loading, empty y error diseñados.
- Responsive sin overflow en seis viewports.
- Sidebar estable.
- Publicidad y Auditoría resuelven los problemas prioritarios.
- No se rompe funcionalidad ni backend.
- `npm test` y `npm run build` pasan.

## 18. Casos limite

- Marcas continúa como filtro de Organizaciones.
- `/admin/*` desconocido conserva el fallback actual al Dashboard.
- `PlatformAdminRoute` y `PlatformAccountGate` mantienen lógica; suspended solo se reestiliza.
- El Admin debe ser dark incluso en visita directa sin atributo de tema inicializado por `AppHeader`.
- Listas extensas no reciben paginación nueva sin soporte existente.
- Email/UUID largos se truncan sin perder acceso al valor completo.
- Estados desconocidos usan badge neutral.
- Ultrawide no estira el contenido más allá del máximo.

## 19. No regresion

Conservar lógica de negocio, RPCs, schema, permisos, rutas, economía y datos. Mantener semántica de `useRpc`. No renombrar estados provenientes de backend.

`src/lib/uiHomologation.test.ts` exige que permanezcan, dentro de la capa final tras `DadoFit V15.9.1 - FULL PRODUCT HOMOLOGATION`, estos contratos:

- `.admin-shell-v14`
- `.admin-shell-v14 .admin-sidebar-v14`
- `.admin-shell-v14 .admin-card-v14`
- `.admin-shell-v14 .admin-table-wrap-v14`
- `.admin-shell-v14 .admin-kpi-grid-v14 > *`

## 20. Plan de QA

1. Ejecutar `npm test` y `npm run build`.
2. Visitar las diez rutas administrativas.
3. Validar 1920/1440/1280/1024/768/375.
4. Verificar ausencia de overflow y superficies blancas residuales.
5. Probar badges y contraste.
6. Probar loading, empty y error.
7. Probar menús de fila con mouse y teclado.
8. Verificar focus visible y atributos ARIA.
9. Revisar scrollbars de Audit, tables, Ads clicks y season picker.
10. Smoke funcional: aprobar organización, suspender/reactivar usuario y actualizar budget sin cambios de comportamiento.

## 21. Tasks tecnicas

### T1 - Tokens y base dark

- Crear tokens Admin.
- Reescribir base v14 dark-first sin nuevos `!important`.
- Garantizar dark en acceso directo.
- Estilizar scrollbars.

### T2 - Componentes core

- Extraer PageHeader, Table, Badge, FilterBar, MetricCard, Empty, Loading y RowActions.
- Extraer Shell/useRpc si reduce acoplamiento.

### T3 - Migracion de modulos

- Dashboard y Users.
- Organizations/Brands y Campaigns.
- Requests y Rewards.

### T4 - Prioridades visuales

- Publicidad: eliminar blancos y homologar analytics.
- Auditoría: scroll, rows y estados.
- Temporadas: picker, botones y loading.

### T5 - Responsive

- Validar seis viewports.
- Ajustar grids, padding y tablas.
- Eliminar overflow accidental.

### T6 - Accesibilidad y QA

- Contraste, focus, ARIA y keyboard.
- Tests, build y smoke funcional.

## 22. Definition of Done

1. Los diez módulos comparten sistema visual y estados.
2. Dark theme es consistente y Publicidad no contiene panel blanco gigante.
3. Auditoría tiene scroll integrado.
4. Acciones tienen jerarquía y menús accesibles.
5. Tokens semánticos sustituyen valores repetidos.
6. Componentes se extraen solo donde reducen duplicación.
7. Responsive pasa en los seis viewports.
8. Guards de homologación, `npm test` y `npm run build` pasan.
9. No hay cambios de backend, rutas, permisos ni lógica.
10. La implementación queda lista para QA humano final.
