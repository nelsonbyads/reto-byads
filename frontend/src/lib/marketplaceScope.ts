export type MarketplaceScope = "dadofit" | "partner";
export type RewardPaymentMethod = "dc" | "gp" | "sp";

export function allowedPaymentMethod(
  scope: MarketplaceScope,
  nativeCurrency: "gp" | "sp" | null,
): RewardPaymentMethod | null {
  if (scope === "dadofit") return "dc";
  return nativeCurrency;
}

export function paymentMatchesScope(
  scope: MarketplaceScope,
  payment: RewardPaymentMethod,
  nativeCurrency: "gp" | "sp" | null,
): boolean {
  return allowedPaymentMethod(scope, nativeCurrency) === payment;
}
