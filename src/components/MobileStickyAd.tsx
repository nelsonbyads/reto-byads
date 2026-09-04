import { ExternalLink, Megaphone, X } from 'lucide-react';
import { useState } from 'react';
import { ADS_CONFIG } from '../config/ads';
import { useActiveAd } from '../hooks/useActiveAd';

export function MobileStickyAd() {
  const placement = ADS_CONFIG.placements['workout-mobile'];
  const [dismissed, setDismissed] = useState(false);
  const ad = useActiveAd('workout-mobile');
  if (!ADS_CONFIG.enabled || !placement.enabled || dismissed) return null;
  const copy = ad ? <><span>PUBLICIDAD · {ad.brand_name}</span><strong>{ad.campaign_name}</strong><small>{ad.target_url ? <>Conocer más <ExternalLink size={10}/></> : 'Contenido patrocinado'}</small></> : <><span>PUBLICIDAD</span><strong>Tu marca puede entrenar aquí</strong><small>Fitness · deporte · bienestar</small></>;
  const content = <><div className="mobile-ad-icon-v135" aria-hidden="true"><Megaphone size={17}/></div><div className="mobile-ad-copy-v135">{copy}</div>{ad?.image_url ? <img className="mobile-ad-image-v14" src={ad.image_url} alt=""/> : <div className="mobile-ad-format-v135">320×50</div>}</>;
  return <div className="mobile-ad-wrap-v135"><div className="mobile-ad-spacer-v135" aria-hidden="true"/><aside className="mobile-sticky-ad-v135" aria-label={`Publicidad: ${placement.label}`}>{ad?.target_url ? <a className="mobile-ad-live-link-v14" href={ad.target_url} target="_blank" rel="noreferrer sponsored">{content}</a> : content}<button type="button" className="mobile-ad-close-v135" aria-label="Cerrar publicidad" onClick={() => setDismissed(true)}><X size={15}/></button></aside></div>;
}
