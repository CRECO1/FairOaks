/**
 * POST /api/track/pageview — first-party pageview beacon ingest.
 *
 * All three public sites fire navigator.sendBeacon() here on every pageview (see lib/tracker.ts →
 * trackPageview, mounted via UtmCapture). Fire-and-forget: always 204, never blocks the visitor, and
 * silently drops anything that looks like a bot or malformed payload. crecotx.com / elkhornpoint.com post
 * cross-origin; that works without CORS config because sendBeacon sends a simple text/plain request.
 *
 * Feeds the live "who's on the site now" feed, the per-lead / per-contact website history, and the
 * engagement reports on the CRM Lead Attribution page (all read through service-role CRM APIs).
 *
 * v2: also carries the persistent anonymous visitor id, visit number, ad click ids and environment, and —
 * when the landing URL carried a signed `ctk` from one of OUR campaign emails — links this visitor to that
 * contact so their activity shows on the contact card.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { BOT, deviceFromUA, browserFromUA, osFromUA, clip, cleanId, cleanClickIds, cleanEnv } from '@/lib/track-ingest';
import { verifyClientToken } from '@/lib/track-link';

export const runtime = 'nodejs';

const NO_CONTENT = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  const ua = req.headers.get('user-agent') ?? '';
  if (!ua || BOT.test(ua)) return NO_CONTENT();

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (!text || text.length > 8000) return NO_CONTENT();
    body = JSON.parse(text);
  } catch { return NO_CONTENT(); }

  const site = clip(body.site, 64);
  const session_id = clip(body.session_id, 64);
  const path = clip(body.path, 512);
  if (!site || !session_id || !path) return NO_CONTENT();

  const h = req.headers;
  const city = h.get('x-vercel-ip-city');
  const visitor_id = cleanId(body.visitor_id);
  const visitN = typeof body.visit_n === 'number' && body.visit_n > 0 ? Math.min(Math.round(body.visit_n), 10000) : null;
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
    visitor_id, visit_n: visitN,
    click_ids: cleanClickIds(body.click_ids),
    browser: browserFromUA(ua), os: osFromUA(ua),
    env: cleanEnv(body.env),
  };

  const db = adminClient();
  try { await db.from('site_pageviews').insert(row); } catch { /* fire-and-forget */ }

  // Email-click identification — only on the landing view that carried a genuine signed token.
  const clientId = visitor_id ? verifyClientToken(body.ctk) : null;
  if (clientId && visitor_id) {
    try {
      const { data: c } = await db.from('crm_clients').select('id, visitor_id').eq('id', clientId).maybeSingle();
      if (c) {
        await db.from('site_visitor_links').upsert({ visitor_id, client_id: clientId, source: 'email_link' }, { onConflict: 'visitor_id', ignoreDuplicates: true });
        if (!c.visitor_id) await db.from('crm_clients').update({ visitor_id }).eq('id', clientId);
        await db.from('site_events').insert({
          site, visitor_id, session_id, type: 'email_click_identified', label: path, path, device: row.device,
          meta: { client_id: clientId, utm_campaign: row.utm_campaign },
        });
      }
    } catch { /* never block */ }
  }
  return NO_CONTENT();
}
