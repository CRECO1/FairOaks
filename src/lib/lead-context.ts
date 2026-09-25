/**
 * Server-side lead context — turns a form POST into the answer to
 * "where did this lead come from?"
 *
 * The client sends what only the browser knows (utm_* + referrer from the
 * attribution cookie, the page it was submitted from, the viewport). This adds
 * what only the server knows (coarse geo from Vercel's edge headers, the
 * user-agent) and normalises the pair into one stored shape.
 *
 * Mirrors the `buildSignupContext` idea already used for crecotx.com
 * newsletter signups, so a *lead* now carries the same page/geo/device/surface
 * detail a *subscriber* does — previously leads had none of it.
 *
 * Privacy posture: coarse geo only. Vercel resolves the IP to city/region at
 * the edge and hands us those headers; we never read, store or log the address
 * itself.
 */

import type { NextRequest } from 'next/server';

export interface LeadContext {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
  landing_page: string | null;
  page_path: string | null;
  page_url: string | null;
  page_title: string | null;
  surface: string | null;
  geo: string | null;
  device: string | null;
  /** Human label for the acquisition channel, e.g. "Google" / "Direct". */
  channel: string;
}

function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Coarse channel bucket from the referrer + utm_medium, using roughly GA4's
 * default channel grouping so our first-party numbers can sit beside GA's
 * without meaning something different.
 */
export function channelFor(referrer: string | null, utmMedium: string | null, utmSource: string | null): string {
  const m = (utmMedium ?? '').toLowerCase();
  if (m.includes('cpc') || m.includes('ppc') || m.includes('paid')) return 'Paid Search';
  if (m.includes('email')) return 'Email';
  if (m.includes('social')) return 'Organic Social';
  if (m.includes('referral')) return 'Referral';

  const r = (referrer ?? '').toLowerCase();
  const s = (utmSource ?? '').toLowerCase();
  const hay = `${r} ${s}`;
  if (!r && !s) return 'Direct';
  if (/google|bing|yahoo|duckduckgo|ecosia/.test(hay)) return 'Organic Search';
  if (/facebook|instagram|linkedin|twitter|x\.com|tiktok|youtube|pinterest|nextdoor/.test(hay)) return 'Organic Social';
  if (/zillow|realtor\.com|redfin|har\.com|trulia|homes\.com|loopnet|crexi/.test(hay)) return 'Listing Portal';
  if (/mail\.|outlook|gmail/.test(hay)) return 'Email';
  return 'Referral';
}

/** "Desktop (Mac) · 1440px wide" — enough to see mobile-vs-desktop lead mix. */
function deviceFrom(ua: string | null, viewportWidth: unknown): string | null {
  if (!ua) return null;
  const mobile = /iPhone|Android.*Mobile|Windows Phone/i.test(ua);
  const tablet = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua);
  const kind = mobile ? 'Mobile' : tablet ? 'Tablet' : 'Desktop';
  const os = /iPhone|iPad|iPod|Mac OS X/i.test(ua) ? 'Apple'
    : /Android/i.test(ua) ? 'Android'
    : /Windows/i.test(ua) ? 'Windows'
    : /Linux/i.test(ua) ? 'Linux' : null;
  const w = typeof viewportWidth === 'number' && viewportWidth > 0 ? `${Math.round(viewportWidth)}px wide` : null;
  return [os ? `${kind} (${os})` : kind, w].filter(Boolean).join(' · ');
}

export function buildLeadContext(req: NextRequest, body: Record<string, unknown>): LeadContext {
  const h = req.headers;

  const city = str(h.get('x-vercel-ip-city'), 80);
  const region = str(h.get('x-vercel-ip-country-region'), 40);
  const country = str(h.get('x-vercel-ip-country'), 8);
  const geoParts = [
    city ? decodeURIComponent(city) : null,
    region,
    country && country !== 'US' ? country : null,
  ].filter(Boolean);

  const utm_source = str(body.utm_source, 120);
  const utm_medium = str(body.utm_medium, 120);
  const referrer = str(body.referrer, 300);

  return {
    utm_source,
    utm_medium,
    utm_campaign: str(body.utm_campaign, 120),
    utm_term: str(body.utm_term, 120),
    utm_content: str(body.utm_content, 120),
    referrer,
    landing_page: str(body.landing_page, 300),
    page_path: str(body.page_path, 300),
    page_url: str(body.page_url, 500),
    page_title: str(body.page_title, 200),
    surface: str(body.surface, 120) ?? str(body.valuation_surface, 120),
    geo: geoParts.length ? geoParts.join(', ') : null,
    device: deviceFrom(h.get('user-agent'), body.viewport_width),
    channel: channelFor(referrer, utm_medium, utm_source),
  };
}
