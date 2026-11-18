/**
 * Pages whose URL IS the credential (a signing link, a secure upload/folder link, a private owner report, a client portal link).
 * They must never reach first-party analytics: the stored path would let anyone with database or backup access open them.
 * (Found in the Nov 2026 audit: 54 page views and 151 events held live /sign/<token> links.)
 */
export const PRIVATE_PATH_PREFIXES = ['/sign', '/secure', '/r/', '/client/'];

export const isPrivatePath = (p: string | null | undefined) => !!p && PRIVATE_PATH_PREFIXES.some(x => p.startsWith(x));

/** Keeps the page kind, drops the token: /sign/abc… → /sign/[private]. Also handles a full URL (referrers). */
export function redactPrivatePath(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  let path = v;
  let prefix = '';
  const m = /^(https?:\/\/[^/]+)(\/.*)?$/i.exec(v);
  if (m) { prefix = m[1]; path = m[2] ?? '/'; }
  const hit = PRIVATE_PATH_PREFIXES.find(x => path.startsWith(x));
  return hit ? `${prefix}${hit.replace(/\/$/, '')}/[private]` : v;
}
