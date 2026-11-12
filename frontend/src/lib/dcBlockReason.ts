const labels: Record<string, string> = {
  budget_not_configured: "DadoCoins no disponibles para este reto: falta configurar un presupuesto.",
  budget_exhausted: "El presupuesto de DadoCoins está agotado.",
  budget_paused: "La entrega de DadoCoins está temporalmente pausada.",
  budget_expired: "El presupuesto de DadoCoins está vencido.",
  budget_not_started: "El presupuesto de DadoCoins todavía no está vigente.",
  budget_cancelled: "El presupuesto de DadoCoins fue cancelado.",
};

export function dcBlockReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return labels[reason] ?? "Los DadoCoins no pudieron entregarse por la política de presupuesto.";
}
