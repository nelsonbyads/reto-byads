export type AdPlacement =
  | 'workout-left-top'
  | 'workout-left-middle'
  | 'workout-left-bottom'
  | 'workout-right-top'
  | 'workout-right-middle'
  | 'workout-right-bottom'
  | 'workout-mobile';

interface AdPlacementConfig {
  enabled: boolean;
  label: string;
}

/**
 * DadoFit monetization configuration.
 *
 * V13.5.1 exposes three independent sellable placements per desktop rail
 * plus the existing mobile sticky banner. Each placement can later map to a
 * different direct sponsor, campaign or ad-network unit without changing the
 * workout layout.
 */
export const ADS_CONFIG: {
  enabled: boolean;
  placements: Record<AdPlacement, AdPlacementConfig>;
} = {
  enabled: true,
  placements: {
    'workout-left-top': { enabled: true, label: 'Lateral izquierdo · superior' },
    'workout-left-middle': { enabled: true, label: 'Lateral izquierdo · medio' },
    'workout-left-bottom': { enabled: true, label: 'Lateral izquierdo · inferior' },
    'workout-right-top': { enabled: true, label: 'Lateral derecho · superior' },
    'workout-right-middle': { enabled: true, label: 'Lateral derecho · medio' },
    'workout-right-bottom': { enabled: true, label: 'Lateral derecho · inferior' },
    'workout-mobile': { enabled: true, label: 'Banner móvil inferior' },
  },
};
