/**
 * Pure helpers for geocoding Property DB addresses (no network, no DB) so they can be tested.
 *
 * Broker emails give messy addresses — "28323 W IH 10 (Fast Food pad)", "13313 FM471", "Higdon Rd",
 * "Marbach Rd & Holwick Rd". The geocoders want a clean "number street, city, state zip", so this
 * cleans what it can, says which addresses are cross-streets (no house number), and provides a
 * distance check so a wrong match (a same-named road in another town) is rejected, not pinned.
 */

export interface AddrRow { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }

/** Tidy an address for a geocoder. Returns '' if nothing usable is left. */
export function cleanAddress(raw?: string | null): string {
  let a = String(raw ?? '');
  a = a.replace(/[’‘`´]/g, "'").replace(/[–—]/g, '-');
  a = a.replace(/\([^)]*\)/g, ' ');                       // "(Fast Food pad)", "(2 acres)"
  a = a.replace(/\b(suite|ste|unit|bldg|building|#)\s*[\w-]+/gi, ' ');   // suite / building numbers
  a = a.replace(/\b(FM|RM|CR|SH|TX|IH|US|I)[\s-]?(\d{1,4})\b/gi, (_m, p, n) => `${p.toUpperCase()} ${n}`); // FM471 → FM 471
  a = a.replace(/\bU\.S\.?\s*Hwy\b/gi, 'US Highway').replace(/\bInterstate\b/gi, 'IH');
  a = a.replace(/\s+/g, ' ').replace(/^[\s,;-]+|[\s,;-]+$/g, '');
  return a;
}

/** A cross-street ("A Rd & B Rd", "A and B") has no house number; Census can't place those. */
export function isIntersection(addr: string): boolean {
  return /\s(&|and|at|\/)\s/i.test(addr) && !/^\d+\s/.test(addr);
}

export function hasHouseNumber(addr: string): boolean {
  return /^\d+[a-z]?\s+\S/i.test(addr.trim());
}

/**
 * Is this a street (or highway) rather than just a place name? "Comfort, TX" / "Austin" is a town, and a
 * geocoder would pin the middle of it — a misleading dot, so those are skipped.
 */
export function looksLikeStreet(addr: string): boolean {
  const a = addr.trim();
  if (!a) return false;
  if (hasHouseNumber(a)) return true;
  // a street word ("Higdon Rd", "Cinema Drive") or a route number ("TX 46", "IH 35", "Loop 1604")
  return /\b(rd|road|st|street|dr|drive|ln|lane|blvd|boulevard|ave|avenue|hwy|highway|loop|pkwy|parkway|fwy|freeway|expy|expressway|way|trl|trail|ct|court|pass|cir|circle|pl|place|run|path|pike)\b/i.test(a)
    || /\b(ih|fm|rm|us|sh|tx|cr|loop|hwy|highway|interstate)\s*-?\d{1,4}\b/i.test(a);
}

/** The queries to try, best first. `fallback` is null when there is no street to look up. */
export function buildQueries(row: AddrRow): { census: string | null; fallback: string | null } {
  const addr = cleanAddress(row.address);
  const city = (row.city || '').trim();
  const state = (row.state || 'TX').trim();
  const tail = [city, state, row.zip].filter(Boolean).join(', ');
  const full = [addr, tail].filter(Boolean).join(', ');
  return { census: hasHouseNumber(addr) ? full : null, fallback: looksLikeStreet(addr) ? full : null };
}

/** Great-circle distance in km. */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Rough Texas box — nothing in this database should be outside it. */
export function inTexas(p: { lat: number; lng: number }): boolean {
  return p.lat >= 25.8 && p.lat <= 36.7 && p.lng >= -106.8 && p.lng <= -93.4;
}

/**
 * Accept a geocoder result only if it is in Texas and, when we know where that city's other
 * properties sit, within `maxKm` of them. A same-named street in another town fails this.
 */
export function plausible(p: { lat: number; lng: number }, cityCentre: { lat: number; lng: number } | null, maxKm = 45): boolean {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !inTexas(p)) return false;
  return !cityCentre || km(p, cityCentre) <= maxKm;
}
