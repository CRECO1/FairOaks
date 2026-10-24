// SSRF guard for server-side fetches of URLs that a signed-in user (or an email) controls.
//
// A hostname-only check is not enough: a public URL can 30x-redirect to an internal one, and a public
// name can resolve to a private address. So every hop's host is DNS-resolved and rejected if ANY answer
// is private / loopback / link-local / metadata / reserved, and redirects are followed manually (max 3).
// (Residual: a DNS rebind between this lookup and fetch()'s own lookup — acceptable for link checking.)

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True for an IPv4/IPv6 literal in a range a server must not be talked into contacting. */
export function isBlockedIp(ip: string): boolean {
  let addr = ip.trim().toLowerCase();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);

  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:7f00:1) — judge the embedded IPv4.
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mappedDotted) return isBlockedIp(mappedDotted[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  if (isIP(addr) === 4) {
    const [a, b] = addr.split('.').map(Number);
    return (
      a === 0 ||                                  // 0.0.0.0/8
      a === 10 ||                                 // 10/8
      a === 127 ||                                // loopback
      (a === 100 && b >= 64 && b <= 127) ||       // CGNAT 100.64/10
      (a === 169 && b === 254) ||                 // link-local + cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||        // 172.16/12
      (a === 192 && b === 168) ||                 // 192.168/16
      (a === 192 && b === 0) ||                   // 192.0.0/24, 192.0.2/24
      (a === 198 && (b === 18 || b === 19)) ||    // benchmarking
      a >= 224                                    // multicast + reserved + broadcast
    );
  }
  if (isIP(addr) === 6) {
    if (addr === '::' || addr === '::1') return true;
    const first = parseInt(addr.split(':')[0] || '0', 16);
    return (
      (first & 0xfe00) === 0xfc00 ||              // fc00::/7 unique local
      (first & 0xffc0) === 0xfe80 ||              // fe80::/10 link-local
      (first & 0xff00) === 0xff00                 // ff00::/8 multicast
    );
  }
  return true; // not an IP at all — never treat as safe
}

/** True when `hostname` is (or only resolves to) public addresses. */
export async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  if (isIP(host)) return !isBlockedIp(host);
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && !addrs.some(a => isBlockedIp(a.address));
  } catch { return false; }
}

/**
 * fetch() restricted to public http(s) targets. Follows up to `maxRedirects` redirects manually,
 * re-validating each hop. Returns null if any hop is disallowed, unresolvable, or redirects too often.
 */
export async function safeFetch(
  startUrl: string,
  init: Omit<RequestInit, 'redirect'> = {},
  maxRedirects = 3,
): Promise<Response | null> {
  let current = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u: URL;
    try { u = new URL(current); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    if (!(await isPublicHost(u.hostname))) return null;
    let r: Response;
    try { r = await fetch(current, { ...init, redirect: 'manual' }); } catch { return null; }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      r.body?.cancel().catch(() => {});
      if (!loc) return null;
      try { current = new URL(loc, current).href; } catch { return null; }
      continue;
    }
    return r;
  }
  return null;
}
