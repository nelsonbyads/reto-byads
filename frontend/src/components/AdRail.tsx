import { ADS_CONFIG, type AdPlacement } from '../config/ads';
import { AdSlot } from './AdSlot';
import { ResponsiveAdDock } from './ResponsiveAdDock';

interface Props {
  side: 'left' | 'right';
  /** Whether the adaptive dock is allowed to monetize the mobile breakpoint. */
  includeMobile?: boolean;
}

const DESKTOP_PLACEMENTS: Record<Props['side'], AdPlacement[]> = {
  left: ['workout-left-top', 'workout-left-middle', 'workout-left-bottom'],
  right: ['workout-right-top', 'workout-right-middle', 'workout-right-bottom'],
};

export function AdRail({ side, includeMobile = true }: Props) {
  const placements = DESKTOP_PLACEMENTS[side].filter((placement) => ADS_CONFIG.placements[placement].enabled);
  const desktopEnabled = ADS_CONFIG.enabled && placements.length > 0;

  return (
    <>
      {desktopEnabled && (
        <aside className={`ad-rail-v8 ad-rail-${side}-v8 ad-rail-v1351`} aria-label={`Publicidad ${side === 'left' ? 'izquierda' : 'derecha'}`}>
          <div className="ad-rail-stack-v1351">
            {placements.map((placement, index) => {
              const placementConfig = ADS_CONFIG.placements[placement];
              return (
                <div className="ad-rail-slot-wrap-v1351" data-ad-index={index + 1} key={placement}>
                  <AdSlot placement={placement} sideLabel={placementConfig.label}/>
                </div>
              );
            })}
          </div>
        </aside>
      )}
      {side === 'left' && <ResponsiveAdDock includeMobile={includeMobile}/>} 
    </>
  );
}
