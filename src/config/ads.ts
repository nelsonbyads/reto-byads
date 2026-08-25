export type AdPlacement = 'workout-left' | 'workout-right';

interface AdPlacementConfig {
  enabled: boolean;
  label: string;
}

/**
 * V8 monetization configuration.
 *
 * For now these placements render visual placeholders only. When a provider
 * (AdSense, direct sponsor, internal campaign, etc.) is selected, replace the
 * placeholder body inside AdSlot without changing the workout layout.
 */
export const ADS_CONFIG: {
  enabled: boolean;
  placements: Record<AdPlacement, AdPlacementConfig>;
} = {
  enabled: true,
  placements: {
    'workout-left': { enabled: true, label: 'Lateral izquierdo' },
    'workout-right': { enabled: true, label: 'Lateral derecho' },
  },
};
