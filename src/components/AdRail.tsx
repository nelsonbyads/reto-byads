import { ADS_CONFIG } from '../config/ads';
import { AdSlot } from './AdSlot';

interface Props {
  side: 'left' | 'right';
}

export function AdRail({ side }: Props) {
  const placement = side === 'left' ? 'workout-left' : 'workout-right';
  const placementConfig = ADS_CONFIG.placements[placement];

  if (!ADS_CONFIG.enabled || !placementConfig.enabled) return null;

  return (
    <aside className={`ad-rail-v8 ad-rail-${side}-v8`} aria-label={`Publicidad ${side === 'left' ? 'izquierda' : 'derecha'}`}>
      <div className="ad-rail-sticky-v8">
        <AdSlot placement={placement} sideLabel={placementConfig.label} />
      </div>
    </aside>
  );
}
