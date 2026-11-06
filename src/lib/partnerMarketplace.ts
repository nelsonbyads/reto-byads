export type MarketplaceScope = "dadofit" | "partner";
export type MarketplaceState = "OPERATIONAL" | "DISABLED" | "HISTORY_ONLY";
export type RelationshipReason = "ACTIVE_MEMBERSHIP" | "PARTNER_WALLET" | "PARTNER_ACTIVITY" | "REDEMPTION_HISTORY" | "HISTORICAL_MEMBERSHIP";
export type RewardBlockedReason = "NONE" | "ECONOMY_DISABLED" | "NOT_ELIGIBLE" | "INSUFFICIENT_BALANCE" | "OUT_OF_STOCK" | "CODE_POOL_EMPTY" | "NOT_STARTED" | "EXPIRED" | "MAX_PER_USER_REACHED" | "REWARD_INACTIVE" | "ORGANIZATION_INACTIVE";
export type IntegerValue = number | string;
export type PartnerIconKey = "star" | "sparkles" | "building" | "trophy" | "heart" | "zap";

export interface PartnerMarketplaceDto {
  organization_id: string;
  organization_name: string;
  organization_type: "gym" | "brand" | "company";
  organization_logo: string | null;
  points_name: string;
  points_short_name: string;
  points_icon: string | null;
  points_color: string;
  enabled: boolean;
  balance: IntegerValue;
  relationship_reason: RelationshipReason;
  marketplace_state: MarketplaceState;
}

export interface CatalogRewardDto {
  reward_id: string;
  organization_id: string | null;
  organization_name: string;
  organization_logo: string | null;
  marketplace_scope: MarketplaceScope;
  title: string;
  description: string | null;
  reward_type: string;
  image_url: string | null;
  native_cost: IntegerValue;
  points_name: string;
  points_short_name: string;
  points_icon: string | null;
  points_color: string;
  remaining_stock: IntegerValue | null;
  starts_at: string | null;
  ends_at: string | null;
  max_per_user: IntegerValue;
  user_redemptions: IntegerValue;
  fulfillment_type: string;
  terms: string | null;
  can_redeem: boolean;
  blocked_reason: RewardBlockedReason;
}

export interface RedemptionHistoryDto {
  redemption_id: string;
  reward_id: string;
  organization_id_snapshot: string | null;
  organization_name_snapshot: string;
  marketplace_scope_snapshot: MarketplaceScope;
  reward_title_snapshot: string;
  reward_image_snapshot: string | null;
  redeemed_at: string;
  status: string;
  payment_currency: "dc" | "gp" | "sp";
  payment_amount: IntegerValue;
  points_name_snapshot: string;
  points_short_name_snapshot: string;
  fulfillment_type: string;
  redemption_reference: string | null;
  expires_at: string | null;
  fulfilled_at: string | null;
  redemption_code?: string | null;
  redemption_url?: string | null;
  fulfillment_instructions?: string | null;
  validation_token?: string | null;
  fulfillment_notes?: string | null;
}

export const PARTNER_MARKETPLACE_RPCS = {
  discovery: "get_my_partner_marketplaces",
  dadofitCatalog: "get_dadofit_marketplace",
  partnerCatalog: "get_partner_marketplace",
  history: "get_my_reward_redemption_history",
  ownerFulfillment: "get_my_reward_fulfillment",
  updatePresentation: "update_partner_point_presentation",
} as const;

const blockedCopy: Record<RewardBlockedReason, string> = {
  NONE: "Disponible",
  ECONOMY_DISABLED: "Marketplace temporalmente no disponible",
  NOT_ELIGIBLE: "No cumples los requisitos para este premio",
  INSUFFICIENT_BALANCE: "Saldo insuficiente",
  OUT_OF_STOCK: "Agotado",
  CODE_POOL_EMPTY: "Códigos temporalmente agotados",
  NOT_STARTED: "Aún no disponible",
  EXPIRED: "Oferta vencida",
  MAX_PER_USER_REACHED: "Límite de canjes alcanzado",
  REWARD_INACTIVE: "Premio no disponible",
  ORGANIZATION_INACTIVE: "Organización temporalmente inactiva",
};

export function blockedReasonLabel(reason: RewardBlockedReason): string {
  return blockedCopy[reason] ?? "No disponible";
}

export function safePartnerColor(color: string | null | undefined): string {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return "#526073";
  const channels = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const contrastOnWhite = 1.05 / (luminance + 0.05);
  return contrastOnWhite >= 4.5 ? color.toUpperCase() : "#526073";
}

export function formatInteger(value: IntegerValue | null | undefined): string {
  const source = value ?? 0;
  if (typeof source === "number") {
    if (!Number.isSafeInteger(source)) return "—";
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(source);
  }
  if (!/^-?\d+$/.test(source)) return "—";
  return new Intl.NumberFormat("es-CO").format(BigInt(source));
}

export function safeRpcInteger(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("invalid integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("integer outside safe RPC range");
  return parsed;
}

export const PARTNER_ICON_KEYS: PartnerIconKey[] = ["star", "sparkles", "building", "trophy", "heart", "zap"];
export function normalizePartnerIcon(value: string | null | undefined): PartnerIconKey | null {
  return PARTNER_ICON_KEYS.includes(value as PartnerIconKey) ? value as PartnerIconKey : null;
}

export function marketplaceStateCopy(state: MarketplaceState): { title: string; description: string } {
  if (state === "DISABLED") return { title: "Marketplace temporalmente no disponible", description: "La economía de Partner Points está suspendida. Tu saldo y tu historial siguen disponibles." };
  if (state === "HISTORY_ONLY") return { title: "Comunidad disponible solo para historial", description: "No puedes realizar nuevos canjes. Tus beneficios emitidos y el historial siguen disponibles." };
  return { title: "Marketplace disponible", description: "Puedes consultar y canjear premios." };
}

export function normalizePartnerWorkspaceKind(kind: string, organizationType: string | null): "gym" | "brand" {
  // El shell solo modela gym/brand; Company comparte la implementación física y visual de Brand.
  return organizationType === "gym" || kind === "gym" ? "gym" : "brand";
}

export function nextTabIndex(current: number, key: string, count: number): number {
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return current;
}

export function managementErrorMessage(action: "load" | "save" | "status" | "presentation"): string {
  const messages = { load: "No fue posible cargar las ofertas.", save: "No fue posible guardar la oferta. Revisa los datos e intenta de nuevo.", status: "No fue posible cambiar el estado de la oferta.", presentation: "No fue posible guardar la presentación de Partner Points." };
  return messages[action];
}

export function isCurrentRequest(responseGeneration: number, currentGeneration: number): boolean {
  return responseGeneration === currentGeneration;
}

export function initialMarketplaceSelection(search: string, communities: PartnerMarketplaceDto[]) {
  const params = new URLSearchParams(search);
  if (params.get("scope") !== "partner") return { scope: "dadofit" as const, organizationId: null };
  const requested = params.get("organization");
  const selected = communities.find((community) => community.organization_id === requested) ?? communities[0];
  return { scope: "partner" as const, organizationId: selected?.organization_id ?? null };
}

export function quickPartnerMarketplaces(
  communities: PartnerMarketplaceDto[],
  selectedOrganizationId: string | null,
  limit = 6,
): PartnerMarketplaceDto[] {
  if (communities.length <= limit) return communities;
  const quick = communities.slice(0, Math.max(1, limit));
  const selected = communities.find(
    (community) => community.organization_id === selectedOrganizationId,
  );
  if (selected && !quick.some((item) => item.organization_id === selected.organization_id)) {
    quick[quick.length - 1] = selected;
  }
  return quick;
}

export function filterPartnerMarketplaces(
  communities: PartnerMarketplaceDto[],
  query: string,
  state: MarketplaceState | "ALL",
): PartnerMarketplaceDto[] {
  const normalizedQuery = query
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
  return communities.filter((community) => {
    if (state !== "ALL" && community.marketplace_state !== state) return false;
    if (!normalizedQuery) return true;
    const searchable = `${community.organization_name} ${community.points_name} ${community.points_short_name}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es");
    return searchable.includes(normalizedQuery);
  });
}
