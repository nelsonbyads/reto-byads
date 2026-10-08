import { supabase } from './supabase';

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
  enabled: true;
  competitive_score_name: null;
}

/** Fallback definido por ECO-4A para organizaciones sin config. */
export function partnerPointFallback(organizationType?: string | null): PartnerPointFallback {
  void organizationType;
  return { points_name: 'Partner Points', points_short_name: 'PP', points_icon: null, points_color: null, enabled: true, competitive_score_name: null };
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
  }
  return partnerPointFallback(organizationType);
}

/** Carga configs en lote para un conjunto de organizaciones. Devuelve un Map vacío si falla. */
export async function loadPartnerPointConfigs(organizationIds: string[]): Promise<Map<string, PartnerPointConfig>> {
  const map = new Map<string, PartnerPointConfig>();
  if (!supabase || organizationIds.length === 0) return map;
  const unique = Array.from(new Set(organizationIds.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data, error } = await supabase.rpc('get_partner_point_configs', { p_organization_ids: unique });
  if (error || !Array.isArray(data)) return map;
  for (const row of data as PartnerPointConfig[]) map.set(row.organization_id, row);
  return map;
}

/** Etiqueta corta de UI para un saldo de Partner Points (p.ej. "120 Nike Points"). */
export function partnerPointsLabel(amount: number, config: ResolvedPartnerPoints): string {
  return `${Number(amount || 0).toLocaleString()} ${config.points_short_name}`;
}
