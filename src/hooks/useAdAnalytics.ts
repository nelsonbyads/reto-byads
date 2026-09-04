import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { AdPlacement } from '../config/ads';

const SESSION_KEY = 'dadofit:ad-session:v144';

function getSessionId() {
  try {
    const current = sessionStorage.getItem(SESSION_KEY);
    if (current) return current;
    const next = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

function deviceType() {
  const width = window.innerWidth;
  if (width <= 767) return 'mobile';
  if (width <= 1199) return 'tablet';
  return 'desktop';
}

async function recordEvent(campaignId: string, placement: AdPlacement, eventType: 'impression' | 'click') {
  if (!supabase) return;
  await supabase.rpc('record_ad_event', {
    p_campaign_id: campaignId,
    p_placement_key: placement,
    p_event_type: eventType,
    p_session_id: getSessionId(),
    p_route_path: window.location.pathname,
    p_device_type: deviceType(),
  });
}

/**
 * First-party ad measurement for DadoFit.
 *
 * - An impression is recorded only after at least 50% of the placement has
 *   remained visible for one second.
 * - Clicks are recorded without blocking the outbound navigation.
 * - The database derives the authenticated user from auth.uid().
 * - No IP address or raw user-agent is sent by the client.
 */
export function useAdAnalytics(campaignId: string | null, placement: AdPlacement) {
  const elementRef = useRef<HTMLElement | null>(null);
  const impressionKeyRef = useRef('');

  const setElement = useCallback((node: HTMLElement | null) => {
    elementRef.current = node;
  }, []);

  useEffect(() => {
    if (!campaignId || !elementRef.current || !supabase) return;

    const node = elementRef.current;
    const impressionKey = `${campaignId}:${placement}:${window.location.pathname}`;
    let visibleTimer = 0;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      window.clearTimeout(visibleTimer);
      if (!entry || entry.intersectionRatio < 0.5 || document.visibilityState !== 'visible') return;

      visibleTimer = window.setTimeout(() => {
        if (impressionKeyRef.current === impressionKey) return;
        impressionKeyRef.current = impressionKey;
        void recordEvent(campaignId, placement, 'impression');
      }, 1000);
    }, { threshold: [0, 0.5, 1] });

    observer.observe(node);
    return () => {
      window.clearTimeout(visibleTimer);
      observer.disconnect();
    };
  }, [campaignId, placement]);

  const trackClick = useCallback(() => {
    if (!campaignId) return;
    void recordEvent(campaignId, placement, 'click');
  }, [campaignId, placement]);

  return { setElement, trackClick };
}
