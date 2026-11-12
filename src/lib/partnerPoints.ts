import { backend } from './backend';

export interface PartnerPointConfig {
  organization_id: string;
  points_name: string;
  points_short_name: string;
  points_icon: string | null;
  points_color: string | null;
  enabled: boolean;
  competitive_score_name: string | null;
}

export interface PartnerPointFallback {
  points_name: string;
  points_short_name: string;
  points_icon: null;
  points_color: null;
  enabled: false;
  competitive_score_name: null;
}

/** Fallback definido por ECO-4A para organizaciones sin config. */
export function partnerPointFallback(organizationType?: string | null): PartnerPointFallback {
  void organizationType;
  return { points_name: 'Partner Points', points_short_name: 'PP', points_icon: null, points_color: null, enabled: false, competitive_score_name: null };
}

export type ResolvedPartnerPoints = Pick<PartnerPointConfig, 'points_name' | 'points_short_name' | 'points_icon' | 'points_color' | 'enabled' | 'competitive_score_name'>;

/**
 * Resuelve la config de Partner Points para una organización.
 * Sin config → fallback ECO-4A por tipo de organización.
 */
export function resolvePartnerPointConfig(
  configs: Map<string, PartnerPointConfig>,
  organizationId: string | null | undefined,
  organizationType?: string | null
): ResolvedPartnerPoints {
  const config = organizationId ? configs.get(organizationId) : undefined;
  if (config) {
    const legacyShortNames = new Set(['GP', 'SP', 'TP']);
    const legacyNames = new Set(['Gym Points', 'Sponsor Points', 'Team Points']);
    if (!legacyShortNames.has(config.points_short_name.toUpperCase()) && !legacyNames.has(config.points_name)) return config;
    const fallback = partnerPointFallback(organizationType);
    return { ...config, points_name: fallback.points_name, points_short_name: fallback.points_short_name };
  }
  return partnerPointFallback(organizationType);
}

/** Carga únicamente la presentación pública autorizada de cada organización. */
export async function loadPartnerPointConfigs(organizationIds: string[]): Promise<Map<string, PartnerPointConfig>> {
  const map = new Map<string, PartnerPointConfig>();
  if (!backend || organizationIds.length === 0) return map;
  const unique = Array.from(new Set(organizationIds.filter(Boolean)));
  if (unique.length === 0) return map;
  // One authorised batch call instead of one request per organization (PERF-01).
  const result = await backend.rpc('get_partner_point_configs_batch', { p_organization_ids: unique.slice(0, 200) });
  if (result.error || !Array.isArray(result.data)) return map;
  for (const row of result.data as PartnerPointConfig[]) map.set(row.organization_id, row);
  return map;
}

/** Etiqueta corta de UI para un saldo de Partner Points (p.ej. "120 Nike Points"). */
export function partnerPointsLabel(amount: number, config: ResolvedPartnerPoints): string {
  return `${Number(amount || 0).toLocaleString()} ${config.points_short_name}`;
}
