import { Megaphone } from 'lucide-react';
import type { AdPlacement } from '../config/ads';

interface Props {
  placement: AdPlacement;
  sideLabel: string;
}

/**
 * Provider-agnostic ad slot.
 *
 * V8 intentionally ships without a real advertising network. This reserves
 * the exact space and UX contract so a provider can be connected later
 * without moving the workout UI or causing layout shift.
 */
export function AdSlot({ placement, sideLabel }: Props) {
  return (
    <section className="ad-slot-v8" data-ad-placement={placement} aria-label={`Espacio publicitario: ${sideLabel}`}>
      <div className="ad-slot-badge-v8">AD</div>
      <div className="ad-slot-art-v8" aria-hidden="true">
        <span />
        <Megaphone size={22} />
        <span />
      </div>
      <div className="ad-slot-copy-v8">
        <span>PUBLICIDAD</span>
        <strong>Espacio publicitario</strong>
        <small>160 × 600</small>
      </div>
      <p>Reservado para patrocinadores o red publicitaria.</p>
    </section>
  );
}
