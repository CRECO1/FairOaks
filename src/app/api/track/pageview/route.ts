/**
 * POST /api/track/pageview — first-party pageview beacon ingest.
 *
 * Both public sites fire navigator.sendBeacon() here on every pageview (see
 * lib/attribution.ts → sendPageviewBeacon, mounted via UtmCapture). It's a
 * fire-and-forget write: always returns 204, never blocks the visitor, and
 * silently drops anything that looks like a bot or malformed payload.
 *
 * crecotx.com posts here cross-origin; that works without CORS config because
 * sendBeacon sends a simple text/plain request and ignores the response.
 *
 * The row feeds the real-time "who's on the site now" feed on the CRM Lead
 * Attribution page (read only via the service-role /api/crm/live-activity).
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { stripClickTracking } from '@/lib/strip-click-tracking';

export const runtime = 'nodejs';

const NO_CONTENT = () => new NextResponse(null, { status: 204 });

// Cheap UA bot screen — keeps obvious crawlers/monitors/link-unfurlers out of
// the live feed. Real visitors on real browsers pass; false negatives just add
// a row we can ignore.
const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|pinterest|vkshare|whatsapp|telegram|headless|lighthouse|pagespeed|gtmetrix|uptime|statuscake|pingdom|curl|wget|python-requests|axios|node-fetch|go-http|java\//i;

function deviceFromUA(ua: string): string {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

const clip = (v: unknown, n: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = stripClickTracking(v).trim();
  return s ? s.slice(0, n) : null;
};

export async function POST(req: NextRequest) {
  const ua = req.headers.get('user-agent') ?? '';
  if (!ua || BOT.test(ua)) return NO_CONTENT();

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (!text || text.length > 4000) return NO_CONTENT();
    body = JSON.parse(text);
  } catch { return NO_CONTENT(); }

  const site = clip(body.site, 64);
  const session_id = clip(body.session_id, 64);
  const path = clip(body.path, 512);
  if (!site || !session_id || !path) return NO_CONTENT();

  const h = req.headers;
  const city = h.get('x-vercel-ip-city');
  const row = {
    site, session_id, path,
    title: clip(body.title, 300),
    referrer: clip(body.referrer, 512),
    utm_source: clip(body.utm_source, 128),
    utm_medium: clip(body.utm_medium, 128),
    utm_campaign: clip(body.utm_campaign, 128),
    utm_term: clip(body.utm_term, 128),
    utm_content: clip(body.utm_content, 128),
    country: clip(h.get('x-vercel-ip-country'), 8),
    region: clip(h.get('x-vercel-ip-country-region'), 16),
    city: clip(city ? decodeURIComponent(city) : null, 80),
    device: deviceFromUA(ua),
  };

  try { await adminClient().from('site_pageviews').insert(row); } catch { /* fire-and-forget */ }
  return NO_CONTENT();
}
