/**
 * Tokens from e-mail links (password recovery, e-mail confirmation).
 *
 * New links carry the token in the URL fragment (`/reset-password#token=…`),
 * which the browser never sends to a server, so it cannot end up in proxy
 * access logs or Referer headers. Links sent before that change used the query
 * string (`?token=…`) and are still accepted.
 *
 * Returns the token and the same URL without it, to put in the address bar.
 */
export function readAuthLinkToken(href: string, key: string): { token: string | null; cleanedUrl: string } {
  const url = new URL(href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const token = hashParams.get(key) || url.searchParams.get(key) || null;

  hashParams.delete(key);
  url.searchParams.delete(key);
  const hash = hashParams.toString();
  const search = url.searchParams.toString();
  const cleanedUrl = `${url.pathname}${search ? `?${search}` : ''}${hash ? `#${hash}` : ''}`;
  return { token, cleanedUrl };
}
