# SPEC — ADS-REPORT-001: Exportación de reportes de publicidad

Estado: IMPLEMENTED / QA COMPLETE
Modo: SDD — documento de diseño. Sin implementación hasta tarea de build explícita.
Ruta afectada: `/admin/ads` (vista `Ads`, backoffice DadoFit).

---

## 1. Contexto

`/admin/ads` (`Ads`, `src/pages/AdminPage.tsx:1240-1568`) muestra la sección "Rendimiento de pauta" con:

- 4 KPIs globales (impresiones, clics, CTR, usuarios identificados),
- tabla "POR CAMPAÑA / Desempeño comercial" (marca, campaña, impresiones, clics, CTR, usuarios),
- lista "Clics recientes",
- selector de período: últimos 7 / 30 / 90 días (`analyticsDays`, `AdminPage.tsx:1196`).

Hoy no existe ninguna capacidad de exportación en el backoffice (sin librerías XLSX/CSV en el repo; único patrón de descarga: `URL.createObjectURL` en `src/components/EvidencePanel.tsx:36`). Los reportes de pauta se preparan a mano para reportes internos y para entregables a marcas/partners.

## 2. Problema

Los datos de pauta solo son visibles en pantalla. No hay forma de descargarlos de forma consistente con lo mostrado, lo que obliga a transcripción manual con riesgo de error numérico, inconsistencia de CTR y fuga de PII hacia reportes entregables.

## 3. Objetivo

Permitir descargar los datos de "Desempeño comercial" en XLSX (formato principal) y CSV (secundario), reutilizando exactamente los mismos datos reales ya cargados por la vista, respetando el período seleccionado, sin PII, sin backend nuevo y sin refetch.

## 4. Alcance funcional (v1)

Incluido:

1. **Export general**: todas las campañas visibles en `metricRows` para el período activo.
2. **Export por marca**: todas las campañas de una marca (p. ej. Nike con 3 campañas → un archivo con los 3), resolviendo por filtrado de `brand_name` sobre las filas ya cargadas. Sin backend nuevo.
3. **Export por campaña**: una sola campaña específica (acción por fila).
4. Formato **XLSX** como principal (hojas Resumen + Campañas); **CSV** como alternativa.
5. Período idéntico al selector de la UI (7/30/90 días).
6. Menú `[Exportar ▼]` junto al selector de período + acción por fila.
7. Tests unitarios de los builders (`src/lib/adsReportExport.test.ts`).

Excluido (v1):

- Hoja 3 "Interacciones" / detalle de clics (contiene PII → backlog documentado en §10).
- Nuevos RPCs o cualquier cambio de backend.
- Export del panel "Clics recientes".
- Cambios en tracking (`ad_events`), modelo de ads, permisos, otras vistas admin.
- Sistema de reportes programados / email.
- Autofilter nativo en XLSX (no soportado por la librería elegida; ver §8).

## 5. Fuentes de datos actuales

| Fuente | Ubicación | Uso en export |
|---|---|---|
| `admin_ad_analytics_summary(p_days)` → jsonb `{days, impressions, clicks, identified_clickers, unique_click_sessions, ctr}` | RPC en `supabase/migrations/20260902215000_v14_4_analytics_schema_reconcile.sql:125-161`; cargado por `useRpc` en `AdminPage.tsx:1250` | Hoja Resumen del export **general** (totales globales oficiales del RPC) |
| `admin_ad_campaign_metrics(p_days)` → `{campaign_id, brand_name, campaign_name, status, impressions, clicks, identified_clickers, unique_click_sessions, ctr}` | RPC, misma migración `:167-213`; `AdminPage.tsx:1253`; estado `metricRows` (`AdminPage.tsx:1386`) | Filas de Hoja Campañas / CSV; base de export **por marca** y **por campaña** |
| `ad_campaigns` (en memoria) | Cargado por `load()` en `AdminPage.tsx:1268` (`setCampaigns`) | Hidratación de "Pieza / URL destino" (`target_url`) por `campaign_id` lookup, sin refetch |
| Período | `analyticsDays` (`AdminPage.tsx:1196`) | Parámetro único de coherencia UI / export |

Reglas de datos:

- **Sin refetch**: el export lee el estado `useRpc` ya cargado. Si los RPC están cargando o en error, el export está deshabilitado.
- **Sin duplicar cálculo**: CTR, conteos e identificados vienden del RPC; el frontend solo reempaqueta (y agrega los CTR de marca/campaña derivados, ver §8).
- La tabla visible y el export comparten `metricRows`; "export general" = esas filas en el mismo orden del RPC (clics desc).
- **Ventana temporal**: el RPC calcula `now() − p_days … now()` en servidor. El export registra `desde = now() − p_days` y `hasta = now()` en cliente al generar (deriva de segundos aceptada y documentada). `p_days` se clampéa 1..365 en DB; la UI solo ofrece 7/30/90.

### CTR — una sola fuente, tres caras

Fuente canónica: `ctr` del RPC = **puntos porcentuales redondeados a 2 decimales en DB** (ej. `0.08` para 1 clic / 1.293 impresiones). El frontend nunca recalcula el CTR de campaña ni el global.

| Superficie | Representación | Ejemplo (1 clic / 1.293 imp) |
|---|---|---|
| RPC (canónica) | number, puntos % | `0.08` |
| UI (sin cambio de comportamiento; helper extraído) | `toLocaleString('es-CO',{maximumFractionDigits:2}) + '%'` | `0,08%` |
| CSV | number bajo header `CTR (%)`, punto decimal RFC 4180 | `0.08` |
| XLSX | fracción `0.0008` + numFmt `0.00%` | visible `0,08%` / `0.08%` según locale |

Excepción **CTR de marca** (agregación): ver §8 — se recalcula desde clics/impresiones sumados; no se promedian CTRs.

## 6. Arquitectura propuesta

```
src/lib/adsReportExport.ts        ← builders puros (sin DOM, sin supabase) — NUEVO
src/lib/adsReportExport.test.ts   ← vitest — NUEVO
src/pages/AdminPage.tsx (Ads)     ← orquestación: menús, handlers, descarga — MODIFICADO (futuro)
src/styles (clases nuevas admin-ad-export-v144*) ← estilo menú export — MODIFICADO (futuro)
package.json                      ← + write-excel-file ^4.1.1 — MODIFICADO (futuro)
```

### Builders puros (`adsReportExport.ts`)

- `sanitizeFileSegment(text)` / `buildReportFileName({ scope, brand?, campaign?, date, format })`
- `buildDateRange(days, now)` → `{ desde, hasta }` (`yyyy-mm-dd`)
- `formatCtrDisplay(ctr)` — helper extraído del JSX actual (misma salida que hoy)
- `ctrPercentPointsFromCounts(clicks, impressions)` — solo para agregados de marca: `round(clicks*100/max(impressions,1), 2)`; `ctrFractionFromCounts(clicks, impressions)` = `impressions>0 ? clicks/impressions : 0`
- `selectRowsForScope(rows, scope)` — filtra `metricRows` por `campaign_id` (campaña) o `brand_name` (marca); general = todas
- `buildSummaryData({ scope, rows, globalSummary, dateRange, generatedAt, targetUrlById })` — Resumen según §8
- `toCampaignExportRows(rows, { dateRange, targetUrlById })` — filas de Hoja Campañas
- `buildCsvContent(rows, dateRange)` — CSV RFC 4180 (ver §9)

### Orquestación (`Ads`)

- Snapshot inmutable de `metricRows` + `analytics` + `analyticsDays` + `campaigns` al momento de exportar.
- Hidratación de `target_url` por `campaign_id` desde el array `campaigns` ya cargado (sin consulta nueva; ausente → vacío).
- XLSX: `const { default: writeXlsxFile } = await import('write-excel-file/universal')` dentro del handler → chunk asíncrono, bundle principal intacto; `.toBlob()` → download.
- CSV: `new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })` — sin dependencias.
- Download: `<a download>` + `URL.createObjectURL` / `revokeObjectURL` (patrón de `EvidencePanel.tsx:36`).
- El export nunca muta estado de analytics ni dispara `refreshAnalytics`.
- Sin cambios backend; los RPCs existentes autorizan con `require_platform_admin()`.

## 7. Flujo UI

### Header de "Rendimiento de pauta" (`admin-ad-analytics-head-v144`)

```
[Últimos 30 días ▼] [Exportar ▼] [Actualizar]
```

- Botón `Exportar` (icono `Download` + chevron), `aria-haspopup="menu"`, `aria-expanded`.
- Menú general con 2 ítems: `Excel (.xlsx)` y `CSV (.csv)` — XLSX primero (principal). Exporta el alcance **general** con el período activo.
- Estados del menú general: deshabilitado con mensaje "No hay datos para exportar" cuando `metricRows.length === 0`; deshabilitado durante `analyticsSummary.loading || campaignMetrics.loading` ("Cargando datos…").
- Cierra con Escape, click-outside y tras elegir ítem; devuelve foco al trigger.
- Éxito: `role="status"` (aria-live polite) "Archivo generado: {filename}".
- Fallo: bloque `auth-error` existente en la sección: "No pudimos generar el archivo. Intenta de nuevo."

### Acción por fila (tabla "Desempeño comercial")

- Nueva columna angosta con botón icono `Download` por fila; `aria-label="Exportar opciones de {brand_name} — {campaign_name}"`.
- Su mini-menú ofrece **dos** ítems (mismo componente/reutilización):
  1. `Exportar campaña (.xlsx)` — alcance campaña; alterna/csv se resuelve… **decisión**: el mini-menú ofrece `Campaña — Excel (.xlsx)`, `Campaña — CSV (.csv)`, separador, `Marca {brand} — Excel (.xlsx)`, `Marca {brand} — CSV (.csv)` (4 ítems, aún simple). XLSX siempre primero por alcance.
- **Export por marca**: filtra `metricRows` por `brand_name` de esa fila; genera un solo archivo con todas las campañas de esa marca visibles en el período (p. ej. Nike×3 → `DadoFit_Publicidad_Nike_2026-10-14.xlsx`). Sin refetch, sin backend.

Flujo del handler: guard (datos listos) → snapshot → builders → blob → download → status.

## 8. XLSX

Dependencia: `write-excel-file@^4.1.1` vía `write-excel-file/universal` con `import()` dinámico.

Estilo: sobrio y profesional — títulos claros, headers bold, anchos razonables, números como números, fechas como fechas, freeze de header. Sin colores de marca, sin fórmulas, sin charts. **No** se construye un sistema de reportes genérico.

### HOJA 1 — "Resumen"

Pares etiqueta (col A ~28) / valor (col B ~22):

| Campo | Valor |
|---|---|
| Nombre del reporte | `DadoFit — Reporte de publicidad` + alcance (`General` / `Marca: {marca}` / `Campaña: {marca} — {campaña}`) |
| Período desde | Date `yyyy-mm-dd` |
| Período hasta | Date `yyyy-mm-dd` |
| Fecha de generación | Date `yyyy-mm-dd hh:mm` (local) |
| Impresiones totales | Number |
| Clics totales | Number |
| CTR global | Number fracción + format `0.00%` |
| Usuarios identificados | Number — **solo en general y campaña** (ver regla de marca) |
| Cantidad de campañas | Number |

Valores por alcance:

| Campo | General | Marca | Campaña |
|---|---|---|---|
| Impresiones | `analytics.impressions` (RPC summary, fuente oficial) | suma de `impressions` de sus filas | `impressions` de la fila |
| Clics | `analytics.clicks` | suma de `clicks` | `clicks` de la fila |
| CTR | fracción `ctr/100` del RPC | **recalculado** desde contadores agregados (abajo) | fracción `ctr/100` de la fila |
| Usuarios identificados | `analytics.identified_clickers` | **omitido** (ver limitación) | `identified_clickers` de la fila |
| Cantidad de campañas | `metricRows.length` | filas de la marca | `1` |

**CTR de marca (regla dura):** `ctrFraction = totalClicks / totalImpressions` (0 si `totalImpressions = 0`). **Nunca** promediar los CTR por campaña. Vector de prueba obligatoria: campaña A `10 imp / 1 clic` (10%) + campaña B `1283 imp / 0 clics` (0%) → marca = `1/1293` → visible `0,08%`; promedio de CTRs (`5%`) es **incorrecto y prohibido**.

**Limitación `identified_clickers` a nivel marca (documentada):** el RPC entrega `COUNT(DISTINCT user_id)` **por campaña**. Sumarla entre campañas duplicaría usuarios que interactuaron con más de una campaña de la misma marca (y no existe en el estado actual un distinct a nivel de marca). Por tanto el Resumen de export **por marca omite la fila "Usuarios identificados"** y agrega la nota: `Métrica no agregable por marca sin duplicidad de usuarios.` No se muestra un total falso. En general y campaña el valor sí es válido (distinct ya calculado sobre ese alcance). `unique_click_sessions` no forma parte del layout de export.

### HOJA 2 — "Campañas"

Headers bold; `stickyRowsCount: 1` (freeze; omitir en silencio si la versión instalada no lo soporta en el build usado — no bloqueante); autofilter omitido (no soportado por la librería; aceptado).

Columnas y anchos sugeridos:

`Marca (22) | Campaña (30) | Estado (12) | Pieza / URL destino (28) | Impresiones (14) | Clics (10) | CTR (10) | Usuarios identificados (18) | Período desde (14) | Período hasta (14)`

- `Pieza / URL destino` = `ad_campaigns.target_url` por lookup; vacío si no existe (el modelo no tiene campo descripción).
- Impresiones/Clics/Usuarios: Number con formato `#,##0`.
- CTR: fracción `ctr/100` + `format: '0.00%'` (campañas y general; el CTR de marca solo vive en Resumen).
- Período desde/hasta: Date `yyyy-mm-dd` en cada fila.
- Orden idéntico al RPC (clics desc); no se re-ordena.
- Por marca/campaña: solo las filas del alcance, mismo orden relativo.

## 9. CSV

- **UTF-8 con BOM** (`\uFEFF`).
- Quote RFC 4180 (`"` doblado), fin de línea `\r\n`.
- Estructura: una sola tabla (formato secundario, tabular y simple) = mismas columnas que Hoja 2 Campañas del alcance seleccionado; sin hoja resumen (los metadatos de período van en las columnas `Periodo desde` / `Periodo hasta` por fila). Headers en español.
- `CTR (%)`: valor **numérico en puntos porcentuales con punto decimal**: `0.08` — **no** `0.0008`, **no** texto `"0,08%"`. Para marca usa el CTR recalculado de contadores (puntos %, 2 decimales). Para filas de campaña usa el `ctr` del RPC tal cual.
- Números sin separador de miles en crudo (p. ej. `1293`); fechas `yyyy-mm-dd`.
- Sin datos → la UI bloquea el export; el builder igualmente no lanza con lista vacía (solo headers).

### QA obligatorio de locale (es-CO)

- **Aprobado actualmente**: delimitador `,`.
- QA de build obligatorio: abrir el CSV generado **directamente en Excel con configuración regional es-CO** y verificar que columnas, números y `CTR (%)` se interpretan correctamente (en Windows es-CO el separador de lista de Excel suele ser `;`; con `,` el archivo puede caer todo en una columna).
- **Contingencia documentada**: si Excel es-CO no interpreta el CSV con `,`, la implementación cambiará a **delimitador `;`** (mismo escape RFC 4180, BOM presente) y se actualizará este documento + test de builder. XLSX continúa siendo el formato principal y no se ve afectado.

## 10. Privacidad

- Reportes v1 = **agregados por campaña/marca**: cero PII. Campos prohibidos en cualquier salida exportada: `email`, `user_id`, `session_id`, `ip`, `user_agent`, `device_type`, `display_name`, `username`, `event_id`, `route_path` (y en general todo dato de `admin_recent_ad_clicks`).
- `Pieza / URL destino` es data comercial de la campaña, no de usuarios.
- **Backlog documentado (fuera de v1)**: "Hoja 3 — Interacciones (USO INTERNO)" basada en `admin_recent_ad_clicks`, restringida a SuperAdmin, con watermark `USO INTERNO — NO COMPARTIR CON MARCAS` en la primera fila y separada física del flujo entregable. Requiere SPEC propia antes de implementarse.

## 11. RBAC

- Sin cambios: `/admin/*` tras `ProtectedRoute` + `PlatformAdminRoute` (RPC `is_platform_admin`, `src/App.tsx:95`, `src/admin/PlatformAdminRoute.tsx:18`).
- Los RPCs usados llaman `require_platform_admin()` (security definer).
- El export expone exactamente los datos a los que la vista ya da acceso: **sin bypass**, sin nuevos permisos, sin endpoints. No hay otro rol con acceso a `/admin/ads` → SuperAdmin único.

## 12. Naming de archivos

Patrón: `DadoFit_Publicidad_{scope}_{YYYY-MM-DD}.{xlsx|csv}` con fecha local de generación.

| Alcance | Ejemplo |
|---|---|
| General | `DadoFit_Publicidad_2026-10-14.xlsx` |
| Marca | `DadoFit_Publicidad_Nike_2026-10-14.xlsx` |
| Campaña | `DadoFit_Publicidad_Nike_Campana5K_2026-10-14.xlsx` |

`sanitizeFileSegment`: NFC → eliminar `\/:*?"<>|` y caracteres de control → colapsar espacios/guiones repetidos a `_` → trim de `_` → máx. 40 chars por segmento → vacío → fallback (`General` / `Campana`). Se preservan acentos y ñ. Detección de ámbito marca en filenames derivados: `brand_name` exacto de las filas filtradas (sanitizado).

## 13. Errores y empty state

| Situación | Comportamiento |
|---|---|
| `metricRows.length === 0` | Exportar (header) y acciones por fila deshabilitados; "No hay datos para exportar". Sin archivos vacíos. |
| Alcance marca/campaña sin filas tras filtrar | No debería ocurrir (el disparador nace de una fila); si ocurre → aborta con mensaje "No hay datos para exportar." |
| RPC en error o cargando | Export deshabilitado; se muestra el `auth-error` existente. |
| Excepción al generar (librería, Blob, storage) | `auth-error` inline: "No pudimos generar el archivo. Intenta de nuevo." Sin descargas parciales. |
| `import()` de write-excel-file falla | Mismo manejo; CSV sigue disponible (no depende de la librería). |
| `target_url` ausente | Celda vacía. |

## 14. Responsive

- Header ya con wrap (`admin-ad-analytics-head-v144`, media queries en `src/styles/v14.2-monetization-network.css:642-644`). Botón Exportar hereda el mismo tratamiento que "Actualizar": ≤720px columna, ítems `flex:1` junto al select.
- Menú desplegable: ancho mínimo ~180px, alineado al botón (`right:0`, clamp al viewport), sin overflow a 375px.
- Tabla con columna de acción: angosta (~40px); la tabla ya tiene `overflow-x:auto` con `min-width:760px` → a 375px mantiene el scroll horizontal existente.
- QA manual en 1440 / 768 / 375.

## 15. Accesibilidad

- Trigger: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`.
- Menús: `role="menu"`; ítems `role="menuitem"`; navegar Up/Down/Home/End; Escape cierra y devuelve foco; click-outside cierra.
- Botón por fila: `aria-label` descriptivo ("Exportar opciones de Nike — OFERTAS DE ANIVERSARIO").
- Éxito: `role="status"` (polite); errores: bloque `auth-error` (patrón admin).
- Foco visible (outline del admin); targets ≥32px.

## 16. Dependencias

| Dependencia | Versión | Justificación |
|---|---|---|
| `write-excel-file` | `^4.1.1` | MIT; ~1.3M descargas/semana; multi-hoja, `0.00%`, fechas `yyyy-mm-dd`, anchos, `stickyRowsCount`, bold. Entrada `universal` → Blob utilizable en browser y Node/vitest. `import()` dinámico → chunk aparte. |

Rechazadas (verificadas en npm registry): `exceljs@4.4.0` (21.8 MB unpacked); `xlsx`/SheetJS `0.18.5` (7.5 MB, advisories en build npm, distribución principal fuera de npm). CSV: **cero dependencias**. Sin dependencias backend.

## 17. Archivos afectados (implementación futura)

| Archivo | Cambio |
|---|---|
| `src/lib/adsReportExport.ts` | **Nuevo** — builders puros + tipos (`AdsReportScope = 'general' | 'brand' | 'campaign'`, etc.) |
| `src/lib/adsReportExport.test.ts` | **Nuevo** — vitest |
| `src/pages/AdminPage.tsx` | `Ads`: estado de menús, `handleExport(scope, format)`, menú header, columna+mini-menú por fila, extracción de `formatCtrDisplay` sin cambio visual |
| CSS (clases nuevas `admin-ad-export-v144*`, en el archivo de estilos del admin coherente con el patrón `*-v144`) | Dropdown, disabled, responsive |
| `package.json` / lockfile | + `write-excel-file` |

Intocables: RPCs, migraciones, tracking, modelo de ads, `PlatformAdminRoute`, otras vistas.

## 18. Criterios de aceptación

1. `[Exportar ▼]` entre select de período y "Actualizar"; ítems XLSX y CSV (XLSX primero).
2. **General**: Resumen con totales del RPC summary, período activo, fecha de generación, nº de campañas = filas visibles; Campañas con todas las filas de `metricRows` en orden RPC.
3. **Marca**: archivo único con todas las campañas de la marca en `metricRows`; Resumen con impresiones/clics sumados, **CTR recalculado desde contadores (no promedio)**, usuarios identificados omitido con nota de no agregabilidad, nº campañas = filas de la marca; filename `DadoFit_Publicidad_Nike_2026-10-14.xlsx`.
4. **Campaña**: Resumen con totales de la fila y nº campañas = 1; 1 fila en Campañas; filename con marca+campaña.
5. XLSX: 2 hojas, headers bold, números como números, CTR visible `0,08%`, fechas `yyyy-mm-dd`, freeze de header.
6. CSV: BOM UTF-8, headers, `CRLF`, `CTR (%)` numérico en puntos porcentuales (`0.08` para 1/1.293), mismo alcance/periódico que XLSX; **QA en Excel es-CO** (§9 contingencia `;`).
7. Cero campos PII en ambos formatos (test con allowlist explícita, §21).
8. Sin datos → export deshabilitado; sin archivos vacíos.
9. `target_url` hidratado desde `campaigns` en memoria (sin red adicional).
10. Bundle principal sin write-excel-file (chunk dinámico).
11. `npm test` y `npm run build` en verde; responsive 1440/768/375 sin romper el header.

## 19. Casos límite

- Marca con 1 sola campaña → export marca = mismas filas que campaña; filenames distintos (scope), válidos.
- Marca con campañas en ceros → se exportan con ceros (consistente con la vista); CTR marca = 0 si `totalImpressions = 0`.
- CTR de marca con 1.293 impresiones y 1 clic → `0,08%` (no `5%` como haría promediar CTRs) — test obligatorio.
- Acentos, ñ, comas, comillas, `/`, emoji en marca/campaña → filename sanitizado; CSV escapado; XLSX literal.
- `ctr = 0` (0 clics o 0 impresiones) → 0 en las 3 caras; sin división por cero (RPC usa `nullif`; builders también).
- Impresiones grandes (≥1e6) → `#,##0`; Number seguro hasta 2^53.
- Cambio de período justo antes de exportar → botón deshabilitado durante carga; nunca se exporta data vieja como nueva.
- Reloj desalineado → fechas derivan de `Date.now()` local; aceptado (segundos).
- `write-excel-file` no disponible la primera vez (offline) → error controlado; reintento posible; CSV independiente.
- Dos marcas con nombre sanitizado idéntico → filenames colisionan salvo por fecha; aceptado en v1.

## 20. No regresión

- KPIs, tabla, clics recientes, inventario, formularios y tracking de `/admin/ads`: sin cambios de datos ni lógica (solo adición de UI de export).
- RPCs actuales intactos; cero migraciones; cero backend.
- Otras rutas admin y app: intocadas (cambios acotados a `Ads` + lib nueva + CSS scoped).
- Permisos sin cambios.

## 21. Tests (`src/lib/adsReportExport.test.ts`)

Builders puros, fixtures inyectadas (fecha `now` fija, filas simuladas de `metricRows`, summary simulado):

| # | Test | Aserción |
|---|---|---|
| 1 | Filename general | `DadoFit_Publicidad_2026-10-14.xlsx` (fecha inyectada) |
| 2 | Filename marca | `DadoFit_Publicidad_Nike_2026-10-14.xlsx` |
| 3 | Filename campaña | `DadoFit_Publicidad_Nike_Campana5K_2026-10-14.xlsx` |
| 4 | Sanitización | `OFERTAS DE ANIV./5K` → seguro; `\/:*?"<>|` y controles eliminados; espacios → `_`; >40 chars truncado; vacío → fallback |
| 5 | `buildDateRange(30, now)` | desde = now−30d, hasta = now; `yyyy-mm-dd` |
| 6 | Totales Resumen general | igualdad exacta con summary inyectado; campaignCount = filas |
| 7 | Export general filas | todas las filas, orden RPC preservado, estado + URL destino por lookup |
| 8 | Export campaña | filtra `campaign_id`; 1 fila; totales de la fila; identified_clickers presente |
| 9 | **Brand totals** | Nike (3 campañas): impresiones = suma, clics = suma, campaignCount = 3 |
| 10 | **Brand CTR (no promedio)** | A: 10 imp/1 clic + B: 1283 imp/0 clics → CTR marca = `1/1293` fracción y `0.08` puntos %; explícitamente ≠ promedio (5) |
| 11 | **Brand usuarios identificados** | Resumen de marca **no incluye** la fila/clave `identified_clickers`; incluye la nota de no agregabilidad |
| 12 | **Brand filename + scope** | `buildReportFileName` con scope brand → patrón §12 |
| 13 | CTR campaña vector 1/1293 | RPC 0.08 → CSV `0.08` en `CTR (%)`; UI `0,08%`; XLSX fracción `0.0008` |
| 14 | CTR edges | 0 clics → 0; 100% (1/1) → 1 / `1.00` |
| 15 | CSV contenido | BOM presente, headers, `\r\n`, escape de `"` y `,` (o `;` si aplica contingencia §9) en marca |
| 16 | **PII (explícito, allowlist)** | Ver abajo |
| 17 | Lista vacía | builders retornan estructura con headers sin lanzar |
| 18 | Acentos/ñ | preservados en CSV y segmentos de filename |

### Test #16 — PII (definición dura, sin regex parcial)

La prueba debe asegurar que **CSV y builders** no contienen campos ni valores PII:

1. **Allowlist de claves**: las filas de export (`toCampaignExportRows`) y el objeto Resumen deben tener exactamente un subconjunto de claves permitidas:
   `brand_name, campaign_name, status, target_url, impressions, clicks, ctr, identified_clickers, period_from, period_to, report_name, generated_at, campaign_count` (+ claves de metadato Resumen equivalentes). Se afirma **igualdad de sets** contra la allowlist por alcance; cualquier clave extra falla.
2. **Bloqueo explícito**: afirmar que ninguna clave de salida está en la lista prohibida:
   `email, user_id, session_id, ip, ip_address, user_agent, device_type, display_name, username, event_id, route_path, session_id, auth_user_id`.
3. **Contenido CSV**: con fixtures que **incluyen** valores PII simulados en campos fuente ajenos (p. ej. el fixture tiene un objeto con `email: "ana@x.com"`, `user_id: "uuid…"`, `session_id`, `device_type: "mobile"`), el CSV serializado no debe contener: subcadenas de emails (regex de correo), UUIDs (regex `/\b[0-9a-f]{8}-[0-9a-f]{4}-/i`), ni las literales de los valores PII del fixture.
4. Ídem aplicado al Resumen serializado (JSON.stringify del objeto Resumen en los 3 scopes) contra la lista prohibida de literales del fixture.

## 22. Tasks (implementación futura — NO en esta fase)

1. `T1` `src/lib/adsReportExport.ts`: tipos, sanitize/filename (general/brand/campaign), date range, `formatCtrDisplay`, CTR agregados de marca (contadores, no promedio), `selectRowsForScope`, `buildSummaryData` (regla de omisión de identificados en marca), `toCampaignExportRows`, `buildCsvContent`.
2. `T2` `src/lib/adsReportExport.test.ts` (tabla §21, incl. #9-#12 marca y #16 PII allowlist); `npm test`.
3. `T3` `npm i write-excel-file@^4.1.1`.
4. `T4` `Ads` en `AdminPage.tsx`: extraer `formatCtrDisplay` (sin cambio visual); estado de menús; `handleExport(scope, format)` con snapshot + import dinámico + download + status/error.
5. `T5` UI: menú header; columna + mini-menú por fila (campaña/marca × xlsx/csv); a11y §15.
6. `T6` CSS scoped `admin-ad-export-v144*` (dropdown, disabled, responsive §14).
7. `T7` QA manual: exports de general/marca/campaña en XLSX y CSV a 7/30/90; abrir archivos; verificar CTR/totales vs UI (incl. vector marca 1/1293 ≠ 5%); **abrir CSV en Excel es-CO** (§9 contingencia `;`); grep PII en CSV; responsive 1440/768/375; `npm run build` (chunk dinámico).
8. `T8` Actualizar esta SPEC con estado de implementación y notas de QA.

## 23. Definition of Done

- [x] Criterios §18 verificados en QA manual (incl. export por marca y QA CSV es-CO).
- [x] `npm test` verde (134 tests) y `npm run build` verde.
- [x] Bundle principal sin `write-excel-file` (chunk dinámico).
- [x] Cero PII en archivos generados (test allowlist + verificación de salidas); cero backend nuevo y cero migraciones.
- [x] SPEC actualizada con resultado QA; commit/push no realizados.

---

## 24. Estado de implementación y evidencia de QA (cierre de build)

Build completado. Tasks T1–T8 ejecutados. Resumen de evidencia:

### T1–T2 — Builders y tests
- `src/lib/adsReportExport.ts` (builders puros, sin DOM/supabase).
- `src/lib/adsReportExport.test.ts` (30 tests: filenames, fechas 7/30/90, CTR display/frac, CTR marca 1/1293, omisión `identified_clickers` en marca, CSV BOM/escaping/acentos, PII allowlist).
- `npm test`: **134 passed (12 files)**.

### T3 — Dependencia
- `write-excel-file@4.1.1` instalada. Carga vía `import()` dinámico → chunk separado `index-XBmXvlNB.js` (71 kB), fuera del bundle principal.

### T4–T6 — UI (`Ads`, `AdminPage.tsx`) + CSS
- Estado/handlers de export con snapshot de `metricRows`/`analytics`/`campaigns` (sin refetch), `downloadBlob` con `URL.createObjectURL` + `revokeObjectURL`.
- `buildAdsReportXlsxBlob` (hoja Resumen pares label/valor + hoja Campañas con `stickyRowsCount:1`, numFmt `#,##0` y `0.00%`, fechas `yyyy-mm-dd`).
- Menú header `[Exportar ▼]` (general: xlsx/csv) + mini-menú por fila (Campaña/Marca × xlsx/csv, separador entre campaña y marca, posicionado para no recortarse por el `overflow` de la tabla).
- `formatCtrDisplay` (es-CO) reemplaza el formateo inline sin cambio visual.
- CSS `admin-ad-export-v144*` en `v14.2-monetization-network.css` con media query ≤720px.

### T7 — QA programático (fixtures)
- **Filenames**: `DadoFit_Publicidad_2026-10-14.xlsx`, `..._Acme_Corp_Norte_...csv`, `..._Acme_Q1_Push_—_Test_...xlsx` (sanitiza espacios→`_`, conserva acentos/guiones).
- **CTR marca (vector clave)**: Acme 10imp/1click + 1283imp/0clicks → `ctr = 1/1293 = 0.0007733…` (fracción), **no** promedio de 10% y 0%. Coincide con UI.
- **Omisión identificados en marca**: clave `identified_clickers` **ausente** del resumen de marca (no agregable sin duplicidad).
- **CSV**: BOM UTF-8 presente; headers exactos; delimitador `,`; **cero PII** (grep: `@`, UUID, `email`/`phone`/`whatsapp`/`user_id`/`device_id` → `NONE`).
- **CTR display es-CO**: `formatCtrDisplay(12)=“12%”`, `(0)=“0%”`, `(12.345)=“12,35%”`.
- **XLSX válido**: `toBlob()` → 4233 bytes, header `PK`, zip OOXML válido.
- **Bundle**: `write-excel-file` NO en `index-CVm78Gae.js` (principal); solo en chunk dinámico.
- `npm run build`: **verde** (tsc + vite + copy-media).

### QA funcional final (2026-10-16)
- QA manual confirmado sobre `/admin/ads`: export general, por marca y por campaña en XLSX/CSV; rangos 7/30/90; nombres, columnas, totales, CTR, `target_url` y datos coherentes con la UI.
- XLSX abierto correctamente: hojas `Resumen` y `Campañas`, valores numéricos, fechas, CTR fraccional con formato `0.00%` y header congelado.
- CSV abierto correctamente en Excel con locale es-CO: BOM UTF-8, acentos/ñ, columnas separadas y CTR numérico. Se conserva delimitador `,`.
- Responsive confirmado en 1440/768/375; selector, Exportar, Actualizar y acciones por fila sin overflow. Escape, click-outside, navegación de teclado, foco visible y cierre tras exportar verificados.
- No regresión confirmada para KPIs, Desempeño comercial, Clics recientes, inventario, formularios, tracking, filtros, Refresh y permisos SuperAdmin.
- Durante el cierre se corrigieron dos bugs de QA: los triggers ahora quedan realmente deshabilitados durante carga/error/export y ante un rango aún no sincronizado; los menús se renderizan mediante portal, se ajustan al viewport y restauran foco para evitar recorte dentro de la tabla.

### Tests finales (2026-10-16)
- `npm test`: **PASS — 134 passed (12 files)**; `adsReportExport.test.ts`: **30 passed**.
- `npm run build`: **PASS** (`tsc -b`, Vite y copia de media).
- Bundle principal: `index-DhmW_4T5.js` (864.12 kB); `write-excel-file` únicamente en chunk dinámico `index-XBmXvlNB.js` (71.29 kB).
- Privacidad: allowlist y fixtures PII en verde; ninguna salida incluye datos individuales de clic o campos prohibidos.

### Issues conocidos
- La imagen/contenedor Docker observado antes del cierre no estaba sincronizado con este working tree. Requiere rebuild/redeploy después del commit manual; no es un defecto de ADS-REPORT-001 ni altera el resultado del QA del código actual.
- Vite reporta el warning preexistente de bundle principal mayor a 500 kB. `write-excel-file` permanece fuera del bundle principal y no incrementa ese chunk de forma estática.

## 25. Decisión: delimitador CSV

Verificado en QA manual con Excel es-CO: el CSV se interpreta correctamente con **coma** como delimitador. Se mantiene **`,`** como delimitador final. La contingencia `;` (§9) no se activa.

---

*SPEC ADS-REPORT-001 — fin del documento. IMPLEMENTED / QA COMPLETE. Export por marca con CTR recalculado desde contadores e identificados no agregables; CSV validado en Excel es-CO con delimitador `,`; privacidad cubierta mediante allowlist y bloqueo explícito. Build, tests y QA funcional completos.*
