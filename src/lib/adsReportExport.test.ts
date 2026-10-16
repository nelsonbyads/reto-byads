import { describe, expect, it } from "vitest";
import {
  BRAND_IDENTIFIED_UNAVAILABLE,
  CSV_BOM,
  CSV_DELIMITER,
  CSV_EOL,
  CSV_HEADERS,
  buildCsvContent,
  buildDateRange,
  buildReportFileName,
  buildSummaryData,
  buildTargetUrlById,
  ctrFractionFromCounts,
  ctrPercentPointsFromCounts,
  formatCtrDisplay,
  sanitizeFileSegment,
  selectRowsForScope,
  toCampaignExportRows,
  type AdAnalyticsSummary,
  type AdMetricRow,
} from "./adsReportExport";

const NOW = new Date(2026, 9, 14, 12, 0, 0);

const ROW_A: AdMetricRow = {
  campaign_id: "c1",
  brand_name: "Nike",
  campaign_name: "Campana5K",
  status: "active",
  impressions: 10,
  clicks: 1,
  identified_clickers: 1,
  ctr: 10,
};
const ROW_B: AdMetricRow = {
  campaign_id: "c2",
  brand_name: "Nike",
  campaign_name: "OFERTAS DE ANIV./5K",
  status: "active",
  impressions: 1283,
  clicks: 0,
  identified_clickers: 0,
  ctr: 0,
};
const ROW_C: AdMetricRow = {
  campaign_id: "c3",
  brand_name: "Nike",
  campaign_name: "Verano Niños",
  status: "paused",
  impressions: 0,
  clicks: 0,
  identified_clickers: 0,
  ctr: 0,
};
const ROW_D: AdMetricRow = {
  campaign_id: "c4",
  brand_name: "Bodytech",
  campaign_name: "Hiit",
  status: "active",
  impressions: 500,
  clicks: 50,
  identified_clickers: 20,
  ctr: 10,
};
const ROW_E: AdMetricRow = {
  campaign_id: "c5",
  brand_name: 'Ñandú, "Especial"',
  campaign_name: "Campaña Ñ 5/1",
  status: "active",
  impressions: 100,
  clicks: 5,
  identified_clickers: 3,
  ctr: 5,
};

const ROWS: AdMetricRow[] = [ROW_A, ROW_B, ROW_C, ROW_D, ROW_E];

const GLOBAL_SUMMARY: AdAnalyticsSummary = {
  days: 30,
  impressions: 2293,
  clicks: 56,
  identified_clickers: 25,
  unique_click_sessions: 40,
  ctr: 2.44,
};

const TARGET_URL_BY_ID = buildTargetUrlById([
  { id: "c1", target_url: "https://nike.test/5k" },
  { id: "c2", target_url: null },
  { id: "c3" },
]);

const DATE_RANGE = buildDateRange(30, NOW);

describe("sanitizeFileSegment", () => {
  it("replaces spaces and removes invalid filesystem characters", () => {
    expect(sanitizeFileSegment('OFERTAS DE ANIV./5K')).toBe("OFERTAS_DE_ANIV.5K");
    expect(sanitizeFileSegment("a\\b/c:d*e?f<g>h|i")).toBe("abcdefghi");
  });

  it("preserves accents and ñ", () => {
    expect(sanitizeFileSegment("Verano Niños")).toBe("Verano_Niños");
  });

  it("caps length at 40 and trims trailing underscores", () => {
    expect(sanitizeFileSegment("x".repeat(50)).length).toBeLessThanOrEqual(40);
    expect(sanitizeFileSegment("abc   ")).toBe("abc");
  });

  it("falls back when empty after cleaning", () => {
    expect(sanitizeFileSegment("", "Campana")).toBe("Campana");
    expect(sanitizeFileSegment("///", "Marca")).toBe("Marca");
  });
});

describe("buildReportFileName", () => {
  it("general", () => {
    expect(buildReportFileName({ scope: "general", date: NOW, format: "xlsx" })).toBe(
      "DadoFit_Publicidad_2026-10-14.xlsx",
    );
  });

  it("brand", () => {
    expect(
      buildReportFileName({ scope: "brand", brand: "Nike", date: NOW, format: "xlsx" }),
    ).toBe("DadoFit_Publicidad_Nike_2026-10-14.xlsx");
    expect(
      buildReportFileName({ scope: "brand", brand: "Nike", date: NOW, format: "csv" }),
    ).toBe("DadoFit_Publicidad_Nike_2026-10-14.csv");
  });

  it("campaign", () => {
    expect(
      buildReportFileName({
        scope: "campaign",
        brand: "Nike",
        campaign: "Campana5K",
        date: NOW,
        format: "xlsx",
      }),
    ).toBe("DadoFit_Publicidad_Nike_Campana5K_2026-10-14.xlsx");
  });

  it("sanitizes brand and campaign segments", () => {
    expect(
      buildReportFileName({
        scope: "campaign",
        brand: "Ñandú, \"Especial\"",
        campaign: "Campaña Ñ 5/1",
        date: NOW,
        format: "xlsx",
      }),
    ).toBe(`DadoFit_Publicidad_${sanitizeFileSegment('Ñandú, "Especial"')}_${sanitizeFileSegment("Campaña Ñ 5/1")}_2026-10-14.xlsx`);
  });
});

describe("buildDateRange", () => {
  it("computes desde/hasta for 30 days", () => {
    expect(DATE_RANGE).toEqual({ desde: "2026-09-14", hasta: "2026-10-14" });
  });

  it("computes 7 and 90 days", () => {
    expect(buildDateRange(7, NOW)).toEqual({ desde: "2026-10-07", hasta: "2026-10-14" });
    expect(buildDateRange(90, NOW)).toEqual({ desde: "2026-07-16", hasta: "2026-10-14" });
  });
});

describe("formatCtrDisplay", () => {
  it("matches es-CO UI formatting", () => {
    expect(formatCtrDisplay(0.08)).toBe("0,08%");
    expect(formatCtrDisplay(10)).toBe("10%");
    expect(formatCtrDisplay(0)).toBe("0%");
    expect(formatCtrDisplay(null)).toBe("0%");
  });
});

describe("selectRowsForScope", () => {
  it("general returns all rows preserving order", () => {
    expect(selectRowsForScope(ROWS, { type: "general" }).map((r) => r.campaign_id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
  });

  it("brand filters by brand_name", () => {
    expect(selectRowsForScope(ROWS, { type: "brand", brand: "Nike" }).map((r) => r.campaign_id)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("campaign filters by campaign_id", () => {
    expect(selectRowsForScope(ROWS, { type: "campaign", campaignId: "c4" })).toEqual([ROW_D]);
  });

  it("does not mutate source rows", () => {
    const copy = ROWS.slice();
    selectRowsForScope(ROWS, { type: "brand", brand: "Nike" });
    expect(ROWS).toEqual(copy);
  });
});

describe("buildSummaryData", () => {
  it("general uses global summary and row count", () => {
    const summary = buildSummaryData({
      selector: { type: "general" },
      rows: ROWS,
      globalSummary: GLOBAL_SUMMARY,
      dateRange: DATE_RANGE,
      generatedAt: NOW,
    });
    expect(summary.impressions).toBe(GLOBAL_SUMMARY.impressions);
    expect(summary.clicks).toBe(GLOBAL_SUMMARY.clicks);
    expect(summary.ctr).toBeCloseTo(GLOBAL_SUMMARY.ctr / 100, 10);
    expect(summary.identified_clickers).toBe(GLOBAL_SUMMARY.identified_clickers);
    expect(summary.campaign_count).toBe(5);
    expect(summary.report_name).toContain("General");
  });

  it("campaign uses the single row and identified_clickers", () => {
    const summary = buildSummaryData({
      selector: { type: "campaign", campaignId: "c1" },
      rows: [ROW_A],
      globalSummary: GLOBAL_SUMMARY,
      dateRange: DATE_RANGE,
      generatedAt: NOW,
    });
    expect(summary.impressions).toBe(10);
    expect(summary.clicks).toBe(1);
    expect(summary.ctr).toBeCloseTo(0.1, 10);
    expect(summary.identified_clickers).toBe(1);
    expect(summary.campaign_count).toBe(1);
  });

  it("brand sums counters, recomputes CTR from counts (not average), omits identified", () => {
    const brandRows = selectRowsForScope(ROWS, { type: "brand", brand: "Nike" });
    const summary = buildSummaryData({
      selector: { type: "brand", brand: "Nike" },
      rows: brandRows,
      globalSummary: GLOBAL_SUMMARY,
      dateRange: DATE_RANGE,
      generatedAt: NOW,
    });
    expect(summary.impressions).toBe(10 + 1283 + 0);
    expect(summary.clicks).toBe(1);
    expect(summary.campaign_count).toBe(3);
    expect(summary.ctr).toBeCloseTo(1 / 1293, 12);
    const averageOfCtrs = (10 + 0 + 0) / 3;
    expect(summary.ctr).not.toBeCloseTo(averageOfCtrs / 100, 8);
    expect(summary.identified_clickers).toBeUndefined();
    expect("identified_clickers" in summary).toBe(false);
    expect(summary.report_name).toContain("Marca: Nike");
  });

  it("brand with zero impressions yields CTR 0", () => {
    const summary = buildSummaryData({
      selector: { type: "brand", brand: "Nike" },
      rows: [ROW_C],
      globalSummary: GLOBAL_SUMMARY,
      dateRange: DATE_RANGE,
      generatedAt: NOW,
    });
    expect(summary.ctr).toBe(0);
  });
});

describe("brand CTR counts math", () => {
  it("1/1293 = 0.08 points, not 5", () => {
    expect(ctrFractionFromCounts(1, 1293)).toBeCloseTo(1 / 1293, 12);
    expect(ctrPercentPointsFromCounts(1, 1293)).toBe(0.08);
    expect(ctrPercentPointsFromCounts(1, 1293)).not.toBe(5);
  });

  it("edges", () => {
    expect(ctrFractionFromCounts(0, 0)).toBe(0);
    expect(ctrPercentPointsFromCounts(0, 0)).toBe(0);
    expect(ctrFractionFromCounts(1, 1)).toBe(1);
    expect(ctrPercentPointsFromCounts(1, 1)).toBe(100);
  });
});

describe("toCampaignExportRows", () => {
  it("maps all rows preserving order with target_url hydration", () => {
    const rows = toCampaignExportRows(ROWS, { dateRange: DATE_RANGE, targetUrlById: TARGET_URL_BY_ID });
    expect(rows.map((r) => r.campaign_name)).toEqual([
      "Campana5K",
      "OFERTAS DE ANIV./5K",
      "Verano Niños",
      "Hiit",
      "Campaña Ñ 5/1",
    ]);
    expect(rows[0].target_url).toBe("https://nike.test/5k");
    expect(rows[1].target_url).toBe("");
    expect(rows[2].target_url).toBe("");
    expect(rows[0].period_from).toBe("2026-09-14");
    expect(rows[0].period_to).toBe("2026-10-14");
    expect(rows[0].ctr).toBeCloseTo(0.1, 10);
  });
});

describe("buildCsvContent", () => {
  it("includes BOM, headers, CRLF and numeric CTR points", () => {
    const csv = buildCsvContent(ROWS, { dateRange: DATE_RANGE, targetUrlById: TARGET_URL_BY_ID });
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain(CSV_EOL);
    expect(csv.split(CSV_EOL)[0]).toBe(CSV_BOM + CSV_HEADERS.join(CSV_DELIMITER));
    expect(csv).toContain("Nike,Campana5K,active,https://nike.test/5k,10,1,10,1,2026-09-14,2026-10-14");
    expect(csv).toContain("Bodytech,Hiit,active,,500,50,10,20,2026-09-14,2026-10-14");
  });

  it("escapes quotes, commas and preserves accents/ñ", () => {
    const csv = buildCsvContent([ROW_E], { dateRange: DATE_RANGE, targetUrlById: {} });
    expect(csv).toContain('"Ñandú, ""Especial"""');
    expect(csv).toContain("Campaña Ñ 5/1");
  });

  it("empty rows yields headers only without throwing", () => {
    const csv = buildCsvContent([], { dateRange: DATE_RANGE, targetUrlById: {} });
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.trim().split(CSV_EOL).filter(Boolean)).toEqual([CSV_HEADERS.join(CSV_DELIMITER)]);
  });
});

describe("PII", () => {
  const FORBIDDEN_KEYS = [
    "email",
    "user_id",
    "session_id",
    "ip",
    "ip_address",
    "user_agent",
    "device_type",
    "display_name",
    "username",
    "event_id",
    "route_path",
    "auth_user_id",
  ];
  const ALLOWED_ROW_KEYS = [
    "brand_name",
    "campaign_name",
    "status",
    "target_url",
    "impressions",
    "clicks",
    "ctr",
    "identified_clickers",
    "period_from",
    "period_to",
  ];
  const ALLOWED_SUMMARY_KEYS = [
    "report_name",
    "period_from",
    "period_to",
    "generated_at",
    "impressions",
    "clicks",
    "ctr",
    "identified_clickers",
    "campaign_count",
  ];

  const PII_FIXTURE = {
    email: "ana@x.com",
    user_id: "3f0a9b2c-1d2e-4f5a-8b6c-7d8e9f0a1b2c",
    session_id: "sess-1234567890",
    ip: "203.0.113.42",
    user_agent: "Mozilla/5.0 (Windows NT 10.0)",
    device_type: "mobile",
    display_name: "Ana García",
    username: "ana.garcia",
    event_id: "998877",
    route_path: "/app/workout",
  };

  it("export rows expose only allowlisted keys and no forbidden keys", () => {
    const rows = toCampaignExportRows(
      ROWS.map((row) => ({ ...row, ...(PII_FIXTURE as object) } as AdMetricRow)),
      { dateRange: DATE_RANGE, targetUrlById: {} },
    );
    for (const row of rows) {
      const keys = Object.keys(row).sort();
      expect(keys).toEqual([...ALLOWED_ROW_KEYS].sort());
      expect(keys.some((key) => FORBIDDEN_KEYS.includes(key))).toBe(false);
    }
  });

  it("summaries expose only allowlisted keys per scope", () => {
    for (const selector of [
      { type: "general" as const },
      { type: "brand" as const, brand: "Nike" },
      { type: "campaign" as const, campaignId: "c1" },
    ]) {
      const scoped = selectRowsForScope(ROWS, selector);
      const summary = buildSummaryData({
        selector,
        rows: scoped,
        globalSummary: GLOBAL_SUMMARY,
        dateRange: DATE_RANGE,
        generatedAt: NOW,
      });
      const keys = Object.keys(summary).sort();
      expect(keys.some((key) => FORBIDDEN_KEYS.includes(key))).toBe(false);
      if (selector.type === "brand") {
        expect(keys).not.toContain("identified_clickers");
      } else {
        expect(keys).toEqual([...ALLOWED_SUMMARY_KEYS].sort());
      }
    }
  });

  it("CSV contains no emails, UUIDs or fixture PII values", () => {
    const dirtyRows: AdMetricRow[] = ROWS.map(
      (row) => ({ ...row, ...(PII_FIXTURE as object) } as AdMetricRow),
    );
    const csv = buildCsvContent(dirtyRows, { dateRange: DATE_RANGE, targetUrlById: {} });
    expect(csv).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(csv).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-/i);
    for (const value of Object.values(PII_FIXTURE)) {
      expect(csv).not.toContain(String(value));
    }
  });

  it("serialized summaries contain no fixture PII values", () => {
    const dirtyGlobal = { ...GLOBAL_SUMMARY, ...(PII_FIXTURE as object) } as AdAnalyticsSummary;
    for (const selector of [
      { type: "general" as const },
      { type: "brand" as const, brand: "Nike" },
      { type: "campaign" as const, campaignId: "c1" },
    ]) {
      const summary = buildSummaryData({
        selector,
        rows: selectRowsForScope(ROWS, selector),
        globalSummary: dirtyGlobal,
        dateRange: DATE_RANGE,
        generatedAt: NOW,
      });
      const serialized = JSON.stringify(summary);
      for (const value of Object.values(PII_FIXTURE)) {
        expect(serialized).not.toContain(String(value));
      }
    }
  });
});

describe("brand identified limitation note", () => {
  it("exports the documented unavailable note", () => {
    expect(BRAND_IDENTIFIED_UNAVAILABLE).toContain("No disponible");
    expect(BRAND_IDENTIFIED_UNAVAILABLE).toContain("no agregable");
  });
});
