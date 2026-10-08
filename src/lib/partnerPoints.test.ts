import { describe, expect, it } from "vitest";
import {
  partnerPointFallback,
  partnerPointsLabel,
  resolvePartnerPointConfig,
  type PartnerPointConfig,
} from "./partnerPoints";

describe("Partner Points config", () => {
  it("uses a neutral fallback without exposing legacy currencies", () => {
    expect(partnerPointFallback("gym")).toMatchObject({ points_name: "Partner Points", points_short_name: "PP" });
  });

  it("resolves each organization independently", () => {
    const nike: PartnerPointConfig = { organization_id: "nike", points_name: "Nike Moves", points_short_name: "NM", points_icon: null, points_color: null, enabled: true, competitive_score_name: null };
    const configs = new Map([[nike.organization_id, nike]]);
    expect(resolvePartnerPointConfig(configs, "nike", "brand").points_short_name).toBe("NM");
    expect(resolvePartnerPointConfig(configs, "other", "brand").points_short_name).toBe("PP");
  });

  it("neutralizes legacy visible currency names", () => {
    const legacy: PartnerPointConfig = { organization_id: "legacy", points_name: "Sponsor Points", points_short_name: "SP", points_icon: null, points_color: null, enabled: true, competitive_score_name: null };
    expect(resolvePartnerPointConfig(new Map([[legacy.organization_id, legacy]]), "legacy", "brand")).toMatchObject({ points_name: "Partner Points", points_short_name: "PP" });
  });

  it("formats labels from the resolved configuration", () => {
    expect(partnerPointsLabel(1200, { ...partnerPointFallback(), points_short_name: "FIT" })).toContain("FIT");
  });
});
