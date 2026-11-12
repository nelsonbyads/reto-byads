import { BarChart3, ChevronDown, Download, Eye, Megaphone, MousePointerClick, Pencil, RefreshCw, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { backend } from "../../lib/backend";
import { buildCsvContent, buildDateRange, buildReportFileName, buildSummaryData, buildTargetUrlById, formatCtrDisplay, selectRowsForScope, toCampaignExportRows, type AdAnalyticsSummary, type AdMetricRow, type AdsReportScopeSelector, type CampaignExportRow, type SummaryExportData } from "../../lib/adsReportExport";
import { AdminEmptyState, AdminLoadingState, AdminRowActions, AdminStatusBadge } from "../components/AdminVisual";
import { AdminShell, type Row, date, fmt, useRpc } from "./shared";

export type AdsExportScope =
  | { type: "general" }
  | { type: "brand"; brand: string }
  | { type: "campaign"; campaignId: string };

export async function buildAdsReportXlsxBlob(
  summary: SummaryExportData,
  campaignRows: CampaignExportRow[],
): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/universal");
  const toXlsxDate = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const bold = (value: string) => ({ value, fontWeight: "bold" as const });
  const numCell = (value: number, format?: string) => ({
    value: Number(value) || 0,
    type: Number,
    ...(format ? { format } : {}),
  });
  const dateCell = (iso: string) => ({
    value: toXlsxDate(iso),
    type: Date,
    format: "yyyy-mm-dd",
  });

  const summarySheet = [
    [bold(summary.report_name)],
    [bold("Período desde"), dateCell(summary.period_from)],
    [bold("Período hasta"), dateCell(summary.period_to)],
    [
      bold("Fecha de generación"),
    {
      value: summary.generated_at,
      type: Date,
      format: "yyyy-mm-dd hh:mm",
    },
    ],
    [bold("Impresiones totales"), numCell(summary.impressions, "#,##0")],
    [bold("Clics totales"), numCell(summary.clicks, "#,##0")],
    [bold("CTR global"), numCell(summary.ctr, "0.00%")],
    summary.identified_clickers === null || summary.identified_clickers === undefined
      ? [
          bold("Usuarios identificados"),
          {
            value:
              "No disponible como total por marca (no agregable sin duplicidad de usuarios)",
          },
        ]
      : [bold("Usuarios identificados"), numCell(summary.identified_clickers, "#,##0")],
    [bold("Cantidad de campañas"), numCell(summary.campaign_count)],
  ];

  const headers = [
    "Marca",
    "Campaña",
    "Estado",
    "Pieza / URL destino",
    "Impresiones",
    "Clics",
    "CTR",
    "Usuarios identificados",
    "Período desde",
    "Período hasta",
  ].map((h) => bold(h));

  const campaignsSheet = [
    headers,
    ...campaignRows.map((row) => [
      row.brand_name,
      row.campaign_name,
      row.status,
      row.target_url,
      numCell(row.impressions, "#,##0"),
      numCell(row.clicks, "#,##0"),
      numCell(row.ctr, "0.00%"),
      numCell(row.identified_clickers, "#,##0"),
      dateCell(row.period_from),
      dateCell(row.period_to),
    ]),
  ];

  const blob = await writeXlsxFile(
    [
      {
        data: summarySheet,
        sheet: "Resumen",
        columns: [{ width: 30 }, { width: 26 }],
      },
      {
        data: campaignsSheet,
        sheet: "Campañas",
        stickyRowsCount: 1,
        columns: [
          { width: 22 },
          { width: 30 },
          { width: 12 },
          { width: 28 },
          { width: 14 },
          { width: 10 },
          { width: 10 },
          { width: 18 },
          { width: 14 },
          { width: 14 },
        ],
      },
    ],
  ).toBlob();
  return blob;
}

export function AdsExportMenu({
  id,
  label,
  items,
  align = "right",
  triggerAriaLabel,
  disabled = false,
}: {
  id: string;
  label: ReactNode;
  items: Array<{ key: string; label: string; onSelect: () => void; separator?: boolean }>;
  align?: "right" | "left";
  triggerAriaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const positionMenu = useCallback(() => {
    const trigger = internalTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth ?? 220;
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    const fitsBelow = rect.bottom + 6 + menuHeight <= window.innerHeight - 8;
    setMenuPosition({
      left,
      top: fitsBelow || !menuHeight ? rect.bottom + 6 : Math.max(8, rect.top - menuHeight - 6),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !internalTriggerRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        internalTriggerRef.current?.focus();
      }
    };
    const onViewportChange = () => positionMenu();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, positionMenu]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        positionMenu();
        menuRef.current
          ?.querySelector<HTMLElement>('[role="menuitem"]')
          ?.focus();
      });
    }
  }, [open, positionMenu]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (!nodes.length) return;
    event.preventDefault();
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (event.key === "ArrowDown") next = current < 0 || current === nodes.length - 1 ? 0 : current + 1;
    if (event.key === "ArrowUp") next = current <= 0 ? nodes.length - 1 : current - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = nodes.length - 1;
    nodes[next]?.focus();
  };

  return (
    <div className="admin-ad-export-wrap-v144">
      <button
        type="button"
        data-export-trigger={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={triggerAriaLabel}
        ref={internalTriggerRef}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && createPortal(
        <div
          id={`${id}-menu`}
          ref={menuRef}
          role="menu"
          aria-label="Formato de exportación"
          className={`admin-ad-export-menu-v144 ${align}`}
          style={menuPosition}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <Fragment key={item.key}>
              {item.separator && <span className="admin-ad-export-separator-v144" role="separator" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                  internalTriggerRef.current?.focus();
                }}
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function Ads() {
  const [placements, setPlacements] = useState<Row[]>([]);
  const [campaigns, setCampaigns] = useState<Row[]>([]);
  const [links, setLinks] = useState<Row[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const emptyForm = {
    brand: "",
    campaign: "",
    image: "",
    target: "",
    start: "",
    end: "",
    placement: "workout-right-top",
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const toLocalInput = (value: any) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const firstPlacement = (campaignId: string) =>
    links.find((link) => link.campaign_id === campaignId)?.placement_key ||
    placements[0]?.placement_key ||
    "workout-right-top";
  const focusForm = () =>
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  const resetForm = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      placement: placements[0]?.placement_key || "workout-right-top",
    });
  };
  const editCampaign = (campaign: Row) => {
    setEditingId(campaign.id);
    setForm({
      brand: campaign.brand_name || "",
      campaign: campaign.campaign_name || "",
      image: campaign.image_url || "",
      target: campaign.target_url || "",
      start: toLocalInput(campaign.starts_at),
      end: toLocalInput(campaign.ends_at),
      placement: firstPlacement(campaign.id),
    });
    setError("");
    focusForm();
  };
  const duplicateCampaign = (campaign: Row) => {
    setEditingId(null);
    setForm({
      brand: campaign.brand_name || "",
      campaign: `${campaign.campaign_name || "Campaña"} (copia)`,
      image: campaign.image_url || "",
      target: campaign.target_url || "",
      start: toLocalInput(campaign.starts_at),
      end: toLocalInput(campaign.ends_at),
      placement: firstPlacement(campaign.id),
    });
    setError("");
    focusForm();
  };
  const analyticsSummary = useRpc("admin_ad_analytics_summary", {
    p_days: analyticsDays,
  });
  const campaignMetrics = useRpc("admin_ad_campaign_metrics", {
    p_days: analyticsDays,
  });
  const recentClicks = useRpc("admin_recent_ad_clicks", {
    p_days: analyticsDays,
    p_limit: 100,
  });

  const load = useCallback(async () => {
    if (!backend) return;
    setInventoryLoading(true);
    setError("");
    const [p, c, l] = await Promise.all([
      backend.from("ad_placements").select("*").order("placement_key"),
      backend
        .from("ad_campaigns")
        .select("*")
        .order("created_at", { ascending: false }),
      backend.from("ad_campaign_placements").select("*"),
    ]);
    if (p.error || c.error || l.error) {
      setInventoryLoading(false);
      setError(
        p.error?.message || c.error?.message || l.error?.message || "Error",
      );
      return;
    }
    setPlacements(p.data ?? []);
    setCampaigns(c.data ?? []);
    setLinks(l.data ?? []);
    setInventoryLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!backend) return;
    setError("");

    if (editingId) {
      const { error: updateError } = await backend.rpc(
        "admin_update_ad_campaign",
        {
          p_campaign_id: editingId,
          p_brand_name: form.brand,
          p_campaign_name: form.campaign,
          p_image_url: form.image || null,
          p_target_url: form.target || null,
          p_starts_at: form.start ? new Date(form.start).toISOString() : null,
          p_ends_at: form.end ? new Date(form.end).toISOString() : null,
          p_placement_key: form.placement,
        },
      );
      if (updateError) {
        setError(updateError.message);
        return;
      }
      resetForm();
      void load();
      return;
    }

    const { data: id, error: createError } = await backend.rpc(
      "admin_create_ad_campaign",
      {
        p_brand_name: form.brand,
        p_campaign_name: form.campaign,
        p_image_url: form.image || null,
        p_target_url: form.target || null,
        p_starts_at: form.start ? new Date(form.start).toISOString() : null,
        p_ends_at: form.end ? new Date(form.end).toISOString() : null,
      },
    );
    if (createError) {
      setError(createError.message);
      return;
    }
    const { error: assignError } = await backend.rpc(
      "admin_assign_ad_placement",
      {
        p_campaign_id: id,
        p_placement_key: form.placement,
        p_enabled: true,
      },
    );
    if (assignError) {
      setError(assignError.message);
      return;
    }
    resetForm();
    void load();
  };

  const setStatus = async (id: string, status: string) => {
    if (!backend) return;
    const { error: e } = await backend.rpc("admin_set_ad_campaign_status", {
      p_campaign_id: id,
      p_status: status,
    });
    if (e) alert(e.message);
    else void load();
  };

  const setRotation = async (placementKey: string, seconds: number) => {
    if (!backend) return;
    const { error: e } = await backend.rpc("admin_set_ad_placement_rotation", {
      p_placement_key: placementKey,
      p_rotation_seconds: seconds,
    });
    if (e) {
      alert(e.message);
      return;
    }
    setPlacements((current) =>
      current.map((item) =>
        item.placement_key === placementKey
          ? { ...item, rotation_seconds: seconds }
          : item,
      ),
    );
  };

  const activeForPlacement = (key: string) => {
    const ids = new Set(
      links.filter((l) => l.placement_key === key).map((l) => l.campaign_id),
    );
    return campaigns.filter((c) => ids.has(c.id) && c.status === "active");
  };

  const analytics = analyticsSummary.data ?? {};
  const metricRows = (campaignMetrics.data ?? []) as Row[];
  const clickRows = (recentClicks.data ?? []) as Row[];
  const refreshAnalytics = () => {
    void analyticsSummary.load();
    void campaignMetrics.load();
    void recentClicks.load();
  };

  const analyticsLoading = analyticsSummary.loading || campaignMetrics.loading;
  const analyticsRangeReady = Number(analytics.days) === analyticsDays;
  const analyticsExportError = analyticsSummary.error || campaignMetrics.error;
  const exportDisabled =
    analyticsLoading ||
    !analyticsRangeReady ||
    Boolean(analyticsExportError) ||
    metricRows.length === 0 ||
    exporting;
  const exportDisabledReason = analyticsLoading
    ? "Cargando datos…"
    : !analyticsRangeReady
      ? "Cargando datos…"
      : analyticsExportError
        ? "No se pudieron cargar los datos para exportar"
    : metricRows.length === 0
      ? "No hay datos para exportar"
      : exporting
        ? "Generando archivo…"
        : "";

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const runExport = async (scope: AdsExportScope, format: "xlsx" | "csv") => {
    if (exportDisabled) return;
    setExportStatus("");
    setExportError("");
    setExporting(true);
    try {
      const snapshotRows = metricRows.map((row) => ({ ...row })) as AdMetricRow[];
      const snapshotSummary: AdAnalyticsSummary = {
        days: analyticsDays,
        impressions: Number(analytics.impressions) || 0,
        clicks: Number(analytics.clicks) || 0,
        identified_clickers: Number(analytics.identified_clickers) || 0,
        unique_click_sessions: Number(analytics.unique_click_sessions) || 0,
        ctr: Number(analytics.ctr) || 0,
      };
      const snapshotCampaigns = campaigns.map((c) => ({
        id: String(c.id),
        target_url: (c.target_url as string | null) ?? null,
      }));
      const now = new Date();
      const dateRange = buildDateRange(analyticsDays, now);
      const targetUrlById = buildTargetUrlById(snapshotCampaigns);
      const selector: AdsReportScopeSelector =
        scope.type === "brand"
          ? { type: "brand", brand: scope.brand }
          : scope.type === "campaign"
            ? { type: "campaign", campaignId: scope.campaignId }
            : { type: "general" };
      const scopedRows = selectRowsForScope(snapshotRows, selector);
      if (scopedRows.length === 0) {
        setExportError("No hay datos para exportar.");
        return;
      }
      const first = scopedRows[0];
      const fileName = buildReportFileName({
        scope: scope.type,
        brand: first?.brand_name ?? "",
        campaign: first?.campaign_name ?? "",
        date: now,
        format,
      });
      if (format === "csv") {
        const csv = buildCsvContent(scopedRows, { dateRange, targetUrlById });
        downloadBlob(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
          fileName,
        );
      } else {
        const summary = buildSummaryData({
          selector,
          rows: scopedRows,
          globalSummary: snapshotSummary,
          dateRange,
          generatedAt: now,
        });
        const campaignExportRows = toCampaignExportRows(scopedRows, {
          dateRange,
          targetUrlById,
        });
        const blob = await buildAdsReportXlsxBlob(summary, campaignExportRows);
        downloadBlob(blob, fileName);
      }
      setExportStatus(`Archivo generado: ${fileName}`);
    } catch {
      setExportError("No pudimos generar el archivo. Intenta de nuevo.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminShell
      title="Publicidad"
      subtitle="Inventario comercial rotativo, medición de impresiones y trazabilidad de clics."
    >
      {error && <div className="auth-error">{error}</div>}

      <section className="admin-ad-analytics-v144">
        <header className="admin-ad-analytics-head-v144">
          <div>
            <span className="eyebrow">AD ANALYTICS</span>
            <h2>Rendimiento de pauta</h2>
            <p>
              Medición first-party de impresiones, clics, CTR y usuarios
              identificados.
            </p>
          </div>
          <div>
            <select
              value={analyticsDays}
              onChange={(e) => setAnalyticsDays(Number(e.target.value))}
              aria-label="Periodo de analítica publicitaria"
            >
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={90}>Últimos 90 días</option>
            </select>
            <AdsExportMenu
              id="ad-export-general"
              disabled={exportDisabled}
              label={
                <>
                  <Download size={14} /> Exportar <ChevronDown size={13} />
                </>
              }
              items={[
                {
                  key: "xlsx",
                  label: "Excel (.xlsx)",
                  onSelect: () => void runExport({ type: "general" }, "xlsx"),
                },
                {
                  key: "csv",
                  label: "CSV (.csv)",
                  onSelect: () => void runExport({ type: "general" }, "csv"),
                },
              ]}
            />
            <button type="button" onClick={refreshAnalytics}>
              <RefreshCw size={14} /> Actualizar
            </button>
          </div>
        </header>
        {exportStatus && (
          <p className="admin-ad-export-status-v144" role="status" aria-live="polite">
            {exportStatus}
          </p>
        )}
        {exportError && (
          <div className="auth-error" role="alert">
            {exportError}
          </div>
        )}
        {exportDisabled && exportDisabledReason && !exportStatus && !exportError && (
          <p className="admin-ad-export-status-v144" aria-live="polite">
            {exportDisabledReason}
          </p>
        )}
        {(analyticsSummary.error ||
          campaignMetrics.error ||
          recentClicks.error) && (
          <div className="auth-error">
            {analyticsSummary.error ||
              campaignMetrics.error ||
              recentClicks.error}
          </div>
        )}
        {analyticsSummary.loading ? <AdminLoadingState rows={2}/> : <div className="admin-ad-kpis-v144">
          <article>
            <Eye size={19} />
            <span>Impresiones</span>
            <strong>{fmt(analytics.impressions)}</strong>
          </article>
          <article>
            <MousePointerClick size={19} />
            <span>Clics</span>
            <strong>{fmt(analytics.clicks)}</strong>
          </article>
          <article>
            <BarChart3 size={19} />
            <span>CTR</span>
            <strong>{formatCtrDisplay(analytics.ctr)}</strong>
          </article>
          <article>
            <UsersRound size={19} />
            <span>Usuarios identificados</span>
            <strong>{fmt(analytics.identified_clickers)}</strong>
          </article>
        </div>}
        <div className="admin-ad-analytics-grid-v144">
          <div className="admin-card-v14 admin-ad-metrics-card-v144">
            <div className="admin-ad-card-title-v144">
              <div>
                <span className="eyebrow">POR CAMPAÑA</span>
                <h3>Desempeño comercial</h3>
              </div>
              <small>{analyticsDays} días</small>
            </div>
            {campaignMetrics.loading ? <AdminLoadingState rows={4}/> : metricRows.length === 0 ? (
              <div className="admin-ad-analytics-empty-v144">
                Aún no hay eventos de pauta registrados.
              </div>
            ) : (
              <div className="admin-ad-metrics-table-v144">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Campaña</th>
                      <th scope="col">Impresiones</th>
                      <th scope="col">Clics</th>
                      <th scope="col">CTR</th>
                      <th scope="col">Usuarios</th>
                      <th scope="col" className="admin-ad-export-actions-th-v144">
                        <span className="admin-ad-export-sr-v144">Exportar</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricRows.map((r) => (
                      <tr key={r.campaign_id}>
                        <td>
                          <strong>{r.brand_name}</strong>
                          <small>{r.campaign_name}</small>
                        </td>
                        <td>{fmt(r.impressions)}</td>
                        <td>{fmt(r.clicks)}</td>
                        <td>{formatCtrDisplay(r.ctr)}</td>
                        <td>{fmt(r.identified_clickers)}</td>
                        <td className="admin-ad-export-actions-td-v144">
                          <AdsExportMenu
                            id={`ad-export-row-${r.campaign_id}`}
                            triggerAriaLabel={`Exportar opciones de ${r.brand_name || ""} — ${r.campaign_name || ""}`}
                            disabled={exportDisabled}
                            label={<Download size={14} />}
                            items={[
                              {
                                key: "campaign-xlsx",
                                label: "Campaña — Excel (.xlsx)",
                                onSelect: () =>
                                  void runExport(
                                    { type: "campaign", campaignId: r.campaign_id },
                                    "xlsx",
                                  ),
                              },
                              {
                                key: "campaign-csv",
                                label: "Campaña — CSV (.csv)",
                                onSelect: () =>
                                  void runExport(
                                    { type: "campaign", campaignId: r.campaign_id },
                                    "csv",
                                  ),
                              },
                              {
                                key: "brand-xlsx",
                                label: `Marca ${r.brand_name} — Excel (.xlsx)`,
                                separator: true,
                                onSelect: () =>
                                  void runExport(
                                    { type: "brand", brand: r.brand_name },
                                    "xlsx",
                                  ),
                              },
                              {
                                key: "brand-csv",
                                label: `Marca ${r.brand_name} — CSV (.csv)`,
                                onSelect: () =>
                                  void runExport(
                                    { type: "brand", brand: r.brand_name },
                                    "csv",
                                  ),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="admin-card-v14 admin-ad-clicks-card-v144">
            <div className="admin-ad-card-title-v144">
              <div>
                <span className="eyebrow">CLICS RECIENTES</span>
                <h3>Quién interactuó</h3>
              </div>
              <small>{clickRows.length} eventos</small>
            </div>
            {recentClicks.loading ? <AdminLoadingState rows={4}/> : clickRows.length === 0 ? (
              <div className="admin-ad-analytics-empty-v144">
                Todavía no hay clics registrados en este periodo.
              </div>
            ) : (
              <div className="admin-ad-click-list-v144">
                {clickRows.map((r) => (
                  <article key={r.event_id}>
                    <div className="admin-ad-click-user-v144">
                      <span>
                        {r.user_id ? (
                          <UserRound size={14} />
                        ) : (
                          <MousePointerClick size={14} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {r.display_name ||
                            r.username ||
                            r.email ||
                            "Visitante no identificado"}
                        </strong>
                        <small>
                          {r.user_id
                            ? r.email || `@${r.username || "usuario"}`
                            : `Sesión ${String(r.session_id || "").slice(0, 8)}`}
                        </small>
                      </div>
                    </div>
                    <div className="admin-ad-click-meta-v144">
                      <strong>
                        {r.brand_name} · {r.campaign_name}
                      </strong>
                      <span>
                        {r.route_path} · {r.device_type} · {r.placement_key}
                      </span>
                      <small>{date(r.occurred_at)}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="admin-ad-privacy-note-v144">
          <ShieldCheck size={13} /> DadoFit registra el usuario autenticado
          cuando existe, una sesión técnica, la ruta y el tipo de dispositivo.
          No almacena IP ni el user-agent completo en esta analítica.
        </p>
      </section>

      {inventoryLoading ? <AdminLoadingState rows={3}/> : placements.length === 0 ? <AdminEmptyState icon={<Megaphone size={22}/>} title="No hay placements publicitarios" description="El inventario aparecerá aquí cuando esté disponible."/> : <section className="admin-ad-inventory-v14">
        {placements.map((p) => {
          const active = activeForPlacement(p.placement_key);
          const seconds = Number(p.rotation_seconds ?? 12);
          return (
            <article key={p.placement_key}>
              <span className="eyebrow">
                {p.channel} · {p.format}
              </span>
              <h3>{p.label}</h3>
              {active.length > 0 ? (
                <>
                  <p>
                    <strong>
                      {active.length}{" "}
                      {active.length === 1
                        ? "campaña activa"
                        : "campañas en rotación"}
                    </strong>
                  </p>
                  <div className="admin-ad-rotation-list-v143">
                    {active.slice(0, 3).map((c) => (
                      <small key={c.id}>
                        {c.brand_name} · {c.campaign_name}
                      </small>
                    ))}
                  </div>
                </>
              ) : (
                <p>Espacio disponible</p>
              )}
              <div className="admin-ad-rotation-v143">
                <span>
                  {active.length > 1
                    ? `Cambia cada ${seconds}s`
                    : "Tiempo de rotación"}
                </span>
                <select
                  value={seconds}
                  onChange={(e) =>
                    void setRotation(p.placement_key, Number(e.target.value))
                  }
                  aria-label={`Rotación de ${p.label}`}
                >
                  {[5, 8, 10, 12, 15, 20, 30, 45, 60].map((value) => (
                    <option key={value} value={value}>
                      {value}s
                    </option>
                  ))}
                </select>
              </div>
              <small>{p.placement_key}</small>
            </article>
          );
        })}
      </section>}

      <aside className="admin-ad-creative-guide-v142">
        <Megaphone size={18} />
        <div>
          <strong>Vallas digitales DadoFit</strong>
          <span>
            Puedes activar varias campañas en el mismo placement. DadoFit las
            rota automáticamente según el tiempo configurado arriba, manteniendo
            la misma posición y el mismo formato visual. Desktop: 300×600 /
            160×600. Mobile: 320×50.
          </span>
        </div>
      </aside>

      <section className="admin-ad-grid-v14">
        <form
          ref={formRef}
          className={`admin-card-v14 admin-ad-editor-v145 ${editingId ? "is-editing" : ""}`}
          onSubmit={submit}
        >
          <span className="eyebrow">
            {editingId ? "EDITANDO PAUTA" : "NUEVA PAUTA"}
          </span>
          <h2>
            {editingId
              ? "Modificar campaña publicitaria"
              : "Crear campaña publicitaria"}
          </h2>
          {editingId && (
            <div className="admin-ad-editor-note-v145">
              <Pencil size={15} />
              <div>
                <strong>Editando una campaña existente</strong>
                <span>
                  Marca, creatividad, destino, fechas y placement se
                  actualizarán al guardar. Si está activa, el cambio se
                  reflejará inmediatamente.
                </span>
              </div>
            </div>
          )}
          <label>
            Marca
            <input
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              required
            />
          </label>
          <label>
            Campaña
            <input
              value={form.campaign}
              onChange={(e) => setForm({ ...form, campaign: e.target.value })}
              required
            />
          </label>
          <label>
            Imagen URL
            <input
              value={form.image}
              onChange={(e) => setForm({ ...form, image: e.target.value })}
              placeholder="https://..."
            />
          </label>
          <label>
            Destino URL
            <input
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder="https://..."
            />
          </label>
          <div className="admin-form-grid-v14">
            <label>
              Inicio
              <input
                type="datetime-local"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            </label>
            <label>
              Fin
              <input
                type="datetime-local"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
              />
            </label>
          </div>
          <label>
            Placement
            <select
              value={form.placement}
              onChange={(e) => setForm({ ...form, placement: e.target.value })}
            >
              {placements.map((p) => (
                <option key={p.placement_key} value={p.placement_key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-ad-editor-actions-v145">
            <button>
              {editingId ? "Guardar cambios" : "Crear en borrador"}
            </button>
            {editingId && (
              <button
                type="button"
                className="admin-ad-secondary-v145"
                onClick={resetForm}
              >
                <X size={14} /> Cancelar edición
              </button>
            )}
          </div>
        </form>

        <div className="admin-card-v14">
          <span className="eyebrow">CAMPAÑAS</span>
          <h2>Control de pauta</h2>
          <div className="admin-ad-campaign-list-v14">
            {!inventoryLoading && campaigns.length === 0 && <AdminEmptyState icon={<Megaphone size={22}/>} title="No hay campañas publicitarias" description="Crea una pauta en el formulario para comenzar."/>}
            {campaigns.map((c) => {
              const editable = !["completed", "cancelled"].includes(c.status);
              return (
                <article
                  key={c.id}
                  className={editingId === c.id ? "is-editing" : ""}
                >
                  <div>
                    <strong>{c.brand_name}</strong>
                    <span>{c.campaign_name}</span>
                    <small>
                      <AdminStatusBadge status={c.status}/> {" "}
                      {links
                        .filter((l) => l.campaign_id === c.id)
                        .map((l) => l.placement_key)
                        .join(", ") || "sin placement"}
                    </small>
                  </div>
                  <AdminRowActions primary={c.status !== "active" ? { label: "Activar", onClick: () => void setStatus(c.id, "active") } : { label: "Pausar", onClick: () => void setStatus(c.id, "paused") }} actions={[
                    ...(editable ? [{ label: "Editar", onClick: () => editCampaign(c) }] : []),
                    { label: "Duplicar", onClick: () => duplicateCampaign(c) },
                  ]}/>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
