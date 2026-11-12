import { useEffect, useState } from 'react';
import { backend } from '../lib/backend';
import type { AdPlacement } from '../config/ads';

export interface ActiveAd {
  campaign_id: string;
  brand_name: string;
  campaign_name: string;
  image_url: string | null;
  target_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  rotation_seconds?: number;
  rotation_count?: number;
  rotation_index?: number;
}

// Several slots on one page share a placement, and navigation remounts them.
// One in-flight request and a 50 s cache per placement keep the public ads
// endpoint well under its per-IP rate limit.
const CACHE_TTL_MS = 50_000;
const adCache = new Map<string, { at: number; promise: Promise<ActiveAd[] | null> }>();

function fetchAds(placement: string): Promise<ActiveAd[] | null> {
  const cached = adCache.get(placement);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise;
  const promise = backend.rpc('get_active_ads', { p_placement_key: placement }).then(({ data, error }) => {
    if (error) {
      adCache.delete(placement);
      return null;
    }
    return (Array.isArray(data) ? data : []) as ActiveAd[];
  });
  adCache.set(placement, { at: Date.now(), promise });
  return promise;
}

/**
 * Returns the currently visible ad for a placement.
 *
 * V14.3 allows multiple active campaigns in one placement. The visible
 * campaign is derived from a shared wall-clock bucket, so every visitor sees
 * a stable billboard for the configured number of seconds before the next
 * active campaign rotates in.
 */
export function useActiveAd(placement: AdPlacement) {
  const [ads, setAds] = useState<ActiveAd[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const rows = await fetchAds(placement);
      if (!active || rows === null) return;
      setAds(rows);
    };

    void load();
    const refreshId = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);

    return () => {
      active = false;
      window.clearInterval(refreshId);
    };
  }, [placement]);

  useEffect(() => {
    if (ads.length <= 1) {
      setIndex(0);
      return;
    }

    const seconds = Math.max(5, Math.min(120, Number(ads[0]?.rotation_seconds ?? 12)));
    const bucketMs = seconds * 1000;
    let timeoutId = 0;

    const syncToClock = () => {
      const now = Date.now();
      setIndex(Math.floor(now / bucketMs) % ads.length);
      const delay = bucketMs - (now % bucketMs) + 25;
      timeoutId = window.setTimeout(syncToClock, delay);
    };

    syncToClock();
    return () => window.clearTimeout(timeoutId);
  }, [ads]);

  const selected = ads[index] ?? ads[0] ?? null;
  if (!selected) return null;

  return {
    ...selected,
    rotation_seconds: Number(selected.rotation_seconds ?? 12),
    rotation_count: ads.length,
    rotation_index: Math.min(index, Math.max(0, ads.length - 1)),
  };
}
