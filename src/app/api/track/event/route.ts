/**
 * POST /api/track/event — first-party behaviour-event ingest (batched, fire-and-forget; always 204).
 *
 * lib/tracker.ts queues events (phone/email taps, CTA clicks, outbound clicks, downloads, scroll depth,
 * engaged seconds per page, page load time, JS errors, and every form event the sites already raise) and
 * flushes them here in batches via sendBeacon. Stored in site_events; read only through the service-role
 * CRM APIs (lead / contact activity, engagement report, live feed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { BOT, deviceFromUA, clip, cleanId } from '@/lib/track-ingest';

export const runtime = 'nodejs';
const NO_CONTENT = () => new NextResponse(null, { status: 204 });

const TYPE = /^[a-z][a-z0-9_:.-]{1,39}$/i;

export async function POST(req: NextRequest) {
  const ua = req.headers.get('user-agent') ?? '';
  if (!ua || BOT.test(ua)) return NO_CONTENT();

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (!text || text.length > 16000) return NO_CONTENT();
    body = JSON.parse(text);
  } catch { return NO_CONTENT(); }

  const site = clip(body.site, 64);
  const visitor_id = cleanId(body.visitor_id);
  const session_id = clip(body.session_id, 64);
  if (!site || !Array.isArray(body.events) || !body.events.length) return NO_CONTENT();

  const device = deviceFromUA(ua);
  const rows = [];
  for (const raw of body.events.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const type = typeof e.type === 'string' && TYPE.test(e.type) ? e.type : null;
    if (!type) continue;
    let meta: Record<string, unknown> | null = null;
    if (e.meta && typeof e.meta === 'object' && !Array.isArray(e.meta)) {
      meta = {};
      for (const [k, v] of Object.entries(e.meta as Record<string, unknown>).slice(0, 8)) {
        if (typeof v === 'string') meta[k.slice(0, 24)] = v.slice(0, 160);
        else if (typeof v === 'number' || typeof v === 'boolean') meta[k.slice(0, 24)] = v;
      }
    }
    // Event time from the browser, clamped so a bad clock can't write into the far past/future.
    const t = typeof e.t === 'number' ? e.t : Date.now();
    const created_at = new Date(Math.min(Date.now(), Math.max(Date.now() - 6 * 3600_000, t))).toISOString();
    rows.push({
      site, visitor_id, session_id, type,
      label: clip(e.label, 160),
      value: typeof e.value === 'number' && Number.isFinite(e.value) ? e.value : null,
      path: clip(e.path, 300),
      meta, device, created_at,
    });
  }
  if (!rows.length) return NO_CONTENT();
  try { await adminClient().from('site_events').insert(rows); } catch { /* fire-and-forget */ }
  return NO_CONTENT();
}
