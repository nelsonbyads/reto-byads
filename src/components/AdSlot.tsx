import { ExternalLink, Megaphone } from 'lucide-react';
import type { AdPlacement } from '../config/ads';
import { useActiveAd, type ActiveAd } from '../hooks/useActiveAd';
import { useAdAnalytics } from '../hooks/useAdAnalytics';

export type AdSlotVariant = 'rail' | 'compact' | 'mobile';

interface Props {
  placement: AdPlacement;
  sideLabel: string;
  variant?: AdSlotVariant;
}

interface ViewProps extends Props {
  ad: ActiveAd | null;
}

/**
 * Pure ad view used by the normal desktop rail and by V14.6's responsive
 * reflow. Keeping analytics inside this component means every visible
 * rendering is measured with the original sellable placement key.
 */
export function AdSlotView({ placement, sideLabel, variant = 'rail', ad }: ViewProps) {
  const analytics = useAdAnalytics(ad?.campaign_id ?? null, placement);
  const variantClass = variant === 'rail' ? '' : ` ad-slot-${variant}-v146`;

  if (ad) {
    const rotationCount = ad.rotation_count ?? 1;
    const rotationIndex = ad.rotation_index ?? 0;
    const rotationSeconds = ad.rotation_seconds ?? 12;

    const body = <>
      <div className="ad-live-creative-v143" key={ad.campaign_id}>
        <div className="ad-slot-badge-v8">PUBLICIDAD</div>
        {rotationCount > 1 && (
          <div className="ad-rotation-status-v143" aria-label={`Publicidad ${rotationIndex + 1} de ${rotationCount}; cambia cada ${rotationSeconds} segundos`}>
            <span>{rotationIndex + 1}/{rotationCount}</span>
            <i key={`${ad.campaign_id}-${rotationIndex}`} style={{ animationDuration: `${rotationSeconds}s` }}/>
          </div>
        )}
        {ad.image_url ? <>
          <img className="ad-live-backdrop-v1421" src={ad.image_url} alt="" aria-hidden="true"/>
          <img className="ad-live-image-v14" src={ad.image_url} alt={`${ad.brand_name} · ${ad.campaign_name}`}/>
        </> : <div className="ad-live-fallback-v14"><Megaphone size={28}/></div>}
        <div className="ad-live-copy-v14">
          <span>{ad.brand_name}</span>
          <strong>{ad.campaign_name}</strong>
          {ad.target_url && <small>Conocer más <ExternalLink size={11}/></small>}
        </div>
      </div>
    </>;

    const className = `ad-slot-v8 ad-slot-v135 ad-live-v14${variantClass}`;

    return ad.target_url
      ? <a ref={analytics.setElement} className={className} href={ad.target_url} target="_blank" rel="noreferrer sponsored" data-ad-placement={placement} data-ad-variant={variant} aria-label={`Publicidad: ${ad.brand_name}`} onClick={analytics.trackClick}>{body}</a>
      : <section ref={analytics.setElement} className={className} data-ad-placement={placement} data-ad-variant={variant} aria-label={`Publicidad: ${ad.brand_name}`}>{body}</section>;
  }

  if (variant !== 'rail') {
    return (
      <section className={`ad-slot-v8 ad-slot-v135 ad-slot-${variant}-v146 ad-slot-empty-responsive-v146`} data-ad-placement={placement} data-ad-variant={variant} aria-label={`Espacio publicitario: ${sideLabel}`}>
        <div className="ad-slot-badge-v8">PUBLICIDAD</div>
        <div className="ad-compact-placeholder-v146" aria-hidden="true">
          <Megaphone size={18}/>
          <div>
            <span>INVENTARIO DADOFIT</span>
            <strong>{sideLabel}</strong>
            <small>Espacio disponible para marcas</small>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ad-slot-v8 ad-slot-v135" data-ad-placement={placement} aria-label={`Espacio publicitario: ${sideLabel}`}>
      <div className="ad-slot-badge-v8">PUBLICIDAD</div>
      <div className="ad-slot-art-v8" aria-hidden="true"><span/><Megaphone size={22}/><span/></div>
      <div className="ad-slot-copy-v8 ad-slot-copy-v135"><span>SPORTS MEDIA</span><strong>Tu marca entrena aquí</strong><small>Formato vertical</small></div>
      <p>Equipamiento, nutrición, bienestar y marcas deportivas.</p>
      <div className="ad-slot-availability-v135">ESPACIO DISPONIBLE</div>
    </section>
  );
}

export function AdSlot({ placement, sideLabel, variant = 'rail' }: Props) {
  const ad = useActiveAd(placement);
  return <AdSlotView placement={placement} sideLabel={sideLabel} variant={variant} ad={ad}/>;
}
