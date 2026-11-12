import { describe, expect, it } from "vitest";
import { allowedPaymentMethod, paymentMatchesScope } from "./marketplaceScope";

describe("marketplace scope", () => {
  it("allows only DC in DadoFit", () => {
    expect(allowedPaymentMethod("dadofit", null)).toBe("dc");
    expect(paymentMatchesScope("dadofit", "gp", "gp")).toBe(false);
  });

  it("allows only the owning Partner currency", () => {
    expect(paymentMatchesScope("partner", "gp", "gp")).toBe(true);
    expect(paymentMatchesScope("partner", "sp", "gp")).toBe(false);
    expect(paymentMatchesScope("partner", "dc", "sp")).toBe(false);
  });
});
