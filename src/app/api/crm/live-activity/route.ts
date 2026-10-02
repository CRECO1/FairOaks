/**
 * GET /api/crm/live-activity — real-time "who's on the site now" feed for the
 * CRM Lead Attribution page. Owner-only (super_admin), same boundary as
 * lead-attribution: this exposes raw visitor activity across all three sites.
 *
 * Reads the first-party site_pageviews stream (fed by the sendBeacon ingest at
 * /api/track/pageview). Pulls the last 30 minutes once and derives everything
 * in JS — the volume is tiny and it avoids three round-trips.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isSuperAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIVE_MS = 5 * 60 * 1000;    // "on the site now" = a pageview in the last 5 min
const WINDOW_MS = 30 * 60 * 1000;   // how far back we pull for the feed + volume pulse

interface PV {
  session_id: string; site: string; path: string; title: string | null;
  utm_source: string | null; utm_medium: string | null; referrer: string | null;
  country: string | null; region: string | null; city: string | null;
  device: string | null; created_at: string;
}

function channel(r: PV): string {
  if (r.utm_source) return r.utm_medium ? `${r.utm_source} / ${r.utm_medium}` : r.utm_source;
  if (r.referrer) { try { return new URL(r.referrer).hostname.replace(/^www\./, ''); } catch { return 'referral'; } }
  return 'Direct';
}
const loc = (r: PV) => [r.city, r.country].filter(Boolean).join(', ') || null;

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) {
    return NextResponse.json({ error: 'Live activity is limited to the account owner.' }, { status: 403 });
  }

  const SITES = ['crecotx.com', 'fairoaksrealtygroup.com', 'elkhornpoint.com'];
  const raw = req.nextUrl.searchParams.get('site');
  const site = raw && SITES.includes(raw) ? raw : null;

  try {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    let q = adminClient()
      .from('site_pageviews')
      .select('session_id,site,path,title,utm_source,utm_medium,referrer,country,region,city,device,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (site) q = q.eq('site', site);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as PV[];

    const now = Date.now();
    const activeCutoff = now - ACTIVE_MS;
    const activeRows = rows.filter(r => new Date(r.created_at).getTime() >= activeCutoff);

    // Distinct active sessions, and a per-site tally of them.
    const activeSessions = new Set(activeRows.map(r => r.session_id));
    const bySite = new Map<string, Set<string>>();
    for (const r of activeRows) {
      if (!bySite.has(r.site)) bySite.set(r.site, new Set());
      bySite.get(r.site)!.add(r.session_id);
    }

    const feed = rows.slice(0, 40).map(r => ({
      sid: r.session_id.slice(0, 8),
      site: r.site,
      path: r.path,
      title: r.title,
      source: channel(r),
      loc: loc(r),
      device: r.device,
      at: r.created_at,
    }));

    return NextResponse.json({
      now: new Date(now).toISOString(),
      activeCount: activeSessions.size,
      activeBySite: [...bySite.entries()].map(([label, s]) => ({ label, value: s.size })).sort((a, b) => b.value - a.value),
      last30min: rows.length,
      feed,
    });
  } catch (e) {
    console.error('[live-activity]', e);
    return NextResponse.json({ error: 'Could not load live activity.' }, { status: 500 });
  }
}
