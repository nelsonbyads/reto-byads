import { describe, expect, it } from "vitest";
import { blockedReasonLabel, filterPartnerMarketplaces, formatInteger, initialMarketplaceSelection, isCurrentRequest, managementErrorMessage, marketplaceStateCopy, nextTabIndex, normalizePartnerIcon, normalizePartnerWorkspaceKind, quickPartnerMarketplaces, redeemErrorMessage, safePartnerColor, safeRpcInteger, type PartnerMarketplaceDto } from "./partnerMarketplace";

const community = (id: string): PartnerMarketplaceDto => ({ organization_id: id, organization_name: id, organization_type: "brand", organization_logo: null, points_name: "Moves", points_short_name: "MV", points_icon: null, points_color: "#456789", enabled: true, balance: 20, relationship_reason: "PARTNER_WALLET", marketplace_state: "OPERATIONAL" });

describe("partner marketplace presentation", () => {
  it("never accepts a non-discovered organization from a deep link", () => {
    expect(initialMarketplaceSelection("?scope=partner&organization=unknown", [community("safe")])).toEqual({ scope: "partner", organizationId: "safe" });
  });
  it("defaults to the isolated DadoFit landing", () => {
    expect(initialMarketplaceSelection("", [community("safe")])).toEqual({ scope: "dadofit", organizationId: null });
  });
  it("maps backend blocked enums to safe copy", () => {
    expect(blockedReasonLabel("OUT_OF_STOCK")).toBe("Agotado");
    expect(blockedReasonLabel("INSUFFICIENT_BALANCE")).not.toMatch(/sql|wallet/i);
  });
  it("rejects invalid and inaccessible accent colors", () => {
    expect(safePartnerColor("javascript:red")).toBe("#526073");
    expect(safePartnerColor("#ffffff")).toBe("#526073");
    expect(safePartnerColor("#767676")).toBe("#767676");
    expect(safePartnerColor("#456789")).toBe("#456789".toUpperCase());
  });
  it("formats bigint strings without lossy Number conversion and bounds RPC input", () => {
    expect(formatInteger("9007199254740993")).not.toBe("—");
    expect(formatInteger(9007199254740992)).toBe("—");
    expect(() => safeRpcInteger("9007199254740993")).toThrow(/safe RPC/);
    expect(safeRpcInteger("250")).toBe(250);
  });
  it("keeps icons and workspace kinds closed", () => {
    expect(normalizePartnerIcon("star")).toBe("star");
    expect(normalizePartnerIcon("<svg>bad</svg>")).toBeNull();
    expect(normalizePartnerWorkspaceKind("brand", "company")).toBe("brand");
  });
  it("distinguishes disabled from history-only states", () => {
    expect(marketplaceStateCopy("DISABLED").description).toMatch(/suspendida/i);
    expect(marketplaceStateCopy("HISTORY_ONLY").title).toMatch(/historial/i);
  });
  it("supports roving tab keyboard navigation", () => {
    expect(nextTabIndex(1, "ArrowRight", 2)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 2)).toBe(1);
    expect(nextTabIndex(1, "Home", 2)).toBe(0);
  });
  it("uses safe management errors without backend details", () => {
    expect(managementErrorMessage("save")).not.toMatch(/sql|table|function/i);
  });
  it("rejects late responses from a previous marketplace generation", () => {
    expect(isCurrentRequest(4, 5)).toBe(false);
    expect(isCurrentRequest(5, 5)).toBe(true);
  });
  it("keeps the selected community in the six quick accesses", () => {
    const communities = Array.from({ length: 10 }, (_, index) => community(`community-${index + 1}`));
    expect(quickPartnerMarketplaces(communities, "community-9")).toHaveLength(6);
    expect(quickPartnerMarketplaces(communities, "community-9").at(-1)?.organization_id).toBe("community-9");
  });
  it("filters the community directory by text and marketplace state", () => {
    const nike = { ...community("nike"), organization_name: "Nike Bogotá" };
    const history = { ...community("history"), organization_name: "Titanes", marketplace_state: "HISTORY_ONLY" as const };
    expect(filterPartnerMarketplaces([nike, history], "bogota", "ALL")).toEqual([nike]);
    expect(filterPartnerMarketplaces([nike, history], "", "HISTORY_ONLY")).toEqual([history]);
  });
});

describe("redeemErrorMessage", () => {
  it("maps SQL redemption errors to actionable copy", () => {
    expect(redeemErrorMessage("insufficient DadoCoins")).toContain("saldo suficiente");
    expect(redeemErrorMessage("reward is sold out")).toContain("agotó");
    expect(redeemErrorMessage("redemption limit reached")).toContain("máximo de canjes");
    expect(redeemErrorMessage("active Gym membership required")).toContain("membresía");
    expect(redeemErrorMessage("something else")).toContain("no pudo completarse");
  });
});
