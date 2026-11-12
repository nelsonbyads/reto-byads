/**
 * External links rendered from user/partner data must be http(s) (SEC-03).
 * React 18 does not block `javascript:` URLs in href, so every dynamic link
 * goes through safeExternalUrl().
 */
export function safeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Normalises a website typed by a user ("marca.com" → "https://marca.com"). */
export function normalizeWebsiteInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return safeExternalUrl(withScheme) ?? '';
}
