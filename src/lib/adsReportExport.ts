export type AdsReportScope = "general" | "brand" | "campaign";
export type AdsReportFormat = "xlsx" | "csv";

export interface AdMetricRow {
  campaign_id: string;
  brand_name: string;
  campaign_name: string;
  status: string;
  impressions: number;
  clicks: number;
  identified_clickers: number;
  ctr: number;
}

export interface AdAnalyticsSummary {
  days: number;
  impressions: number;
  clicks: number;
  identified_clickers: number;
  unique_click_sessions: number;
  ctr: number;
}

export interface ReportDateRange {
  desde: string;
  hasta: string;
}

export interface CampaignExportRow {
  brand_name: string;
  campaign_name: string;
  status: string;
  target_url: string;
  impressions: number;
  clicks: number;
  ctr: number;
  identified_clickers: number;
  period_from: string;
  period_to: string;
}

export interface SummaryExportData {
  report_name: string;
  period_from: string;
  period_to: string;
  generated_at: Date;
  impressions: number;
  clicks: number;
  ctr: number;
  identified_clickers?: number | null;
  campaign_count: number;
}

export type AdsReportScopeSelector =
  | { type: "general" }
  | { type: "brand"; brand: string }
  | { type: "campaign"; campaignId: string };

export const BRAND_IDENTIFIED_UNAVAILABLE =
  "No disponible como total por marca (no agregable sin duplicidad de usuarios)";

export const CSV_BOM = String.fromCharCode(0xfeff);
export const CSV_EOL = "\r\n";
export const CSV_DELIMITER = ",";
export const CSV_HEADERS = [
  "Marca",
  "Campaña",
  "Estado",
  "Pieza / URL destino",
  "Impresiones",
  "Clics",
  "CTR (%)",
  "Usuarios identificados",
  "Periodo desde",
  "Periodo hasta",
] as const;

const REPORT_TITLE = "DadoFit — Reporte de publicidad";
const MAX_SEGMENT_LENGTH = 40;

export function sanitizeFileSegment(text: string, fallback = "Campana"): string {
  const cleaned = (text ?? "")
    .normalize("NFC")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SEGMENT_LENGTH)
    .replace(/_+$/g, "");
  return cleaned || fallback;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function buildDateRange(days: number, now: Date): ReportDateRange {
  const desde = new Date(now.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  return { desde: formatDateISO(desde), hasta: formatDateISO(now) };
}

export function buildReportFileName(params: {
  scope: AdsReportScope;
  brand?: string;
  campaign?: string;
  date: Date;
  format: AdsReportFormat;
}): string {
  const dateStr = formatDateISO(params.date);
  const ext = params.format === "xlsx" ? "xlsx" : "csv";
  if (params.scope === "brand") {
    const brand = sanitizeFileSegment(params.brand ?? "", "Marca");
    return `DadoFit_Publicidad_${brand}_${dateStr}.${ext}`;
  }
  if (params.scope === "campaign") {
    const brand = sanitizeFileSegment(params.brand ?? "", "Marca");
    const campaign = sanitizeFileSegment(params.campaign ?? "", "Campana");
    return `DadoFit_Publicidad_${brand}_${campaign}_${dateStr}.${ext}`;
  }
  return `DadoFit_Publicidad_${dateStr}.${ext}`;
}

export function formatCtrDisplay(ctr: number | null | undefined): string {
  return `${Number(ctr ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 2 })}%`;
}

export function ctrFractionFromCounts(clicks: number, impressions: number): number {
  const imp = Number(impressions) || 0;
  const clk = Number(clicks) || 0;
  return imp > 0 ? clk / imp : 0;
}

export function ctrPercentPointsFromCounts(clicks: number, impressions: number): number {
  return Math.round(ctrFractionFromCounts(clicks, impressions) * 100 * 100) / 100;
}

export function ctrFractionFromRpcPoints(ctrPoints: number | null | undefined): number {
  return (Number(ctrPoints) || 0) / 100;
}

export function selectRowsForScope(
  rows: AdMetricRow[],
  selector: AdsReportScopeSelector,
): AdMetricRow[] {
  if (selector.type === "brand") {
    return rows.filter((row) => row.brand_name === selector.brand);
  }
  if (selector.type === "campaign") {
    return rows.filter((row) => row.campaign_id === selector.campaignId);
  }
  return rows.slice();
}

export function buildTargetUrlById(
  campaigns: Array<{ id: string; target_url?: string | null }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const campaign of campaigns ?? []) {
    if (campaign?.id) map[campaign.id] = campaign.target_url ?? "";
  }
  return map;
}

export function buildSummaryData(params: {
  selector: AdsReportScopeSelector;
  rows: AdMetricRow[];
  globalSummary: AdAnalyticsSummary;
  dateRange: ReportDateRange;
  generatedAt: Date;
}): SummaryExportData {
  const { selector, rows, globalSummary, dateRange, generatedAt } = params;
  const base = {
    period_from: dateRange.desde,
    period_to: dateRange.hasta,
    generated_at: generatedAt,
  };

  if (selector.type === "brand") {
    const impressions = rows.reduce((sum, row) => sum + (Number(row.impressions) || 0), 0);
    const clicks = rows.reduce((sum, row) => sum + (Number(row.clicks) || 0), 0);
    return {
      ...base,
      report_name: `${REPORT_TITLE} · Marca: ${selector.brand}`,
      impressions,
      clicks,
      ctr: ctrFractionFromCounts(clicks, impressions),
      campaign_count: rows.length,
    };
  }

  if (selector.type === "campaign") {
    const row = rows[0];
    return {
      ...base,
      report_name: `${REPORT_TITLE} · Campaña: ${row?.brand_name ?? ""} — ${row?.campaign_name ?? ""}`,
      impressions: Number(row?.impressions) || 0,
      clicks: Number(row?.clicks) || 0,
      ctr: ctrFractionFromRpcPoints(row?.ctr),
      identified_clickers: Number(row?.identified_clickers) || 0,
      campaign_count: 1,
    };
  }

  return {
    ...base,
    report_name: `${REPORT_TITLE} · General`,
    impressions: Number(globalSummary?.impressions) || 0,
    clicks: Number(globalSummary?.clicks) || 0,
    ctr: ctrFractionFromRpcPoints(globalSummary?.ctr),
    identified_clickers: Number(globalSummary?.identified_clickers) || 0,
    campaign_count: rows.length,
  };
}

export function toCampaignExportRows(
  rows: AdMetricRow[],
  params: { dateRange: ReportDateRange; targetUrlById: Record<string, string> },
): CampaignExportRow[] {
  const { dateRange, targetUrlById } = params;
  return (rows ?? []).map((row) => ({
    brand_name: row.brand_name ?? "",
    campaign_name: row.campaign_name ?? "",
    status: row.status ?? "",
    target_url: targetUrlById?.[row.campaign_id] ?? "",
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
    ctr: ctrFractionFromRpcPoints(row.ctr),
    identified_clickers: Number(row.identified_clickers) || 0,
    period_from: dateRange.desde,
    period_to: dateRange.hasta,
  }));
}

function escapeCsvField(value: string): string {
  const needsQuotes =
    value.includes(CSV_DELIMITER) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function csvNumber(value: number): string {
  return String(Number(value) || 0);
}

export function buildCsvContent(
  rows: AdMetricRow[],
  params: { dateRange: ReportDateRange; targetUrlById: Record<string, string> },
): string {
  const exportRows = toCampaignExportRows(rows, params);
  const lines: string[] = [CSV_HEADERS.join(CSV_DELIMITER)];
  for (const row of exportRows) {
    lines.push(
      [
        escapeCsvField(row.brand_name),
        escapeCsvField(row.campaign_name),
        escapeCsvField(row.status),
        escapeCsvField(row.target_url),
        csvNumber(row.impressions),
        csvNumber(row.clicks),
        csvNumber(ctrPercentPointsFromCounts(row.clicks, row.impressions)),
        csvNumber(row.identified_clickers),
        row.period_from,
        row.period_to,
      ].join(CSV_DELIMITER),
    );
  }
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}
