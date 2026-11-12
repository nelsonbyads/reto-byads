import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ADS_CONFIG, type AdPlacement } from '../config/ads';
import { useActiveAd, type ActiveAd } from '../hooks/useActiveAd';
import { AdSlotView } from './AdSlot';
import '../styles/v14.6-responsive-ad-fallback.css';

interface Props {
  includeMobile?: boolean;
}

type AdWithPlacement = {
  placement: AdPlacement;
  ad: ActiveAd | null;
};

const PAIRS: [AdPlacement, AdPlacement][] = [
  ['workout-left-top', 'workout-right-top'],
  ['workout-left-middle', 'workout-right-middle'],
  ['workout-left-bottom', 'workout-right-bottom'],
];

/**
 * V14.6 adaptive inventory.
 *
 * >=1600px: hidden, because the six vertical rails are already visible.
 * 768-1599px: the existing six rail placements reflow into a fixed two-unit
 * commercial dock. Paid pairs rotate; empty pairs are skipped.
 * <=767px: the dedicated mobile placement is used. If it has no paid campaign,
 * the first active desktop campaign follows the audience instead of vanishing.
 */
export function ResponsiveAdDock({ includeMobile = true }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [pairIndex, setPairIndex] = useState(0);

  const leftTop = useActiveAd('workout-left-top');
  const rightTop = useActiveAd('workout-right-top');
  const leftMiddle = useActiveAd('workout-left-middle');
  const rightMiddle = useActiveAd('workout-right-middle');
  const leftBottom = useActiveAd('workout-left-bottom');
  const rightBottom = useActiveAd('workout-right-bottom');
  const mobile = useActiveAd('workout-mobile');

  const byPlacement: Record<AdPlacement, ActiveAd | null> = {
    'workout-left-top': leftTop,
    'workout-left-middle': leftMiddle,
    'workout-left-bottom': leftBottom,
    'workout-right-top': rightTop,
    'workout-right-middle': rightMiddle,
    'workout-right-bottom': rightBottom,
    'workout-mobile': mobile,
  };

  const activePairs = useMemo(() => {
    const paid = PAIRS.filter(([left, right]) => Boolean(byPlacement[left] || byPlacement[right]));
    return paid.length > 0 ? paid : [PAIRS[0]];
  }, [leftTop, rightTop, leftMiddle, rightMiddle, leftBottom, rightBottom]);

  useEffect(() => {
    setPairIndex((current) => current % activePairs.length);
    if (activePairs.length <= 1) return;

    const id = window.setInterval(() => {
      setPairIndex((current) => (current + 1) % activePairs.length);
    }, 15_000);

    return () => window.clearInterval(id);
  }, [activePairs.length]);

  const activePair = activePairs[pairIndex % activePairs.length] ?? PAIRS[0];

  const desktopFallbacks: AdWithPlacement[] = [
    { placement: 'workout-left-top', ad: leftTop },
    { placement: 'workout-right-top', ad: rightTop },
    { placement: 'workout-left-middle', ad: leftMiddle },
    { placement: 'workout-right-middle', ad: rightMiddle },
    { placement: 'workout-left-bottom', ad: leftBottom },
    { placement: 'workout-right-bottom', ad: rightBottom },
  ];

  const mobileSelection: AdWithPlacement = mobile
    ? { placement: 'workout-mobile', ad: mobile }
    : desktopFallbacks.find((item) => item.ad) ?? { placement: 'workout-mobile', ad: null };

  if (!ADS_CONFIG.enabled || dismissed) return null;

  const [leftPlacement, rightPlacement] = activePair;

  return (
    <div className={`responsive-ad-dock-wrap-v146${includeMobile ? '' : ' responsive-ad-no-mobile-v146'}`}>
      <div className="responsive-ad-dock-spacer-v146" aria-hidden="true"/>
      <aside className="responsive-ad-dock-v146" aria-label="Publicidad adaptativa DadoFit">
        <div className="responsive-ad-dock-panel-v146">
          <div className="responsive-ad-pair-v146" key={`${leftPlacement}-${rightPlacement}`}>
            <AdSlotView
              placement={leftPlacement}
              sideLabel={ADS_CONFIG.placements[leftPlacement].label}
              variant="compact"
              ad={byPlacement[leftPlacement]}
            />
            <AdSlotView
              placement={rightPlacement}
              sideLabel={ADS_CONFIG.placements[rightPlacement].label}
              variant="compact"
              ad={byPlacement[rightPlacement]}
            />
          </div>

          {includeMobile && (
            <div className="responsive-ad-mobile-v146">
              <AdSlotView
                placement={mobileSelection.placement}
                sideLabel={ADS_CONFIG.placements[mobileSelection.placement].label}
                variant="mobile"
                ad={mobileSelection.ad}
              />
            </div>
          )}

          <button type="button" className="responsive-ad-close-v146" onClick={() => setDismissed(true)} aria-label="Cerrar publicidad">
            <X size={15}/>
          </button>

          {activePairs.length > 1 && (
            <div className="responsive-ad-pages-v146" aria-label={`Grupo publicitario ${pairIndex + 1} de ${activePairs.length}`}>
              {activePairs.map((pair, index) => <i key={`${pair[0]}-${pair[1]}`} className={index === pairIndex ? 'active' : ''}/>) }
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
