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

    // High-intent actions in the same window (phone / email taps, downloads, button clicks, form starts,
    // and known contacts arriving from our emails) — shown above the pageview feed.
    let eventsOut: { at: string; site: string; type: string; label: string | null; path: string | null; contact: string | null }[] = [];
    try {
      let eq = adminClient().from('site_events')
        .select('site, visitor_id, type, label, path, created_at')
        .in('type', ['phone_tap', 'email_tap', 'text_tap', 'download', 'cta_click', 'lead_form_started', 'email_click_identified'])
        .gte('created_at', since).order('created_at', { ascending: false }).limit(25);
      if (site) eq = eq.eq('site', site);
      const { data: evs } = await eq;
      const vids = [...new Set((evs ?? []).map(e => e.visitor_id).filter(Boolean))] as string[];
      const nameByVisitor = new Map<string, string>();
      if (vids.length) {
        const { data: links } = await adminClient().from('site_visitor_links').select('visitor_id, client_id').in('visitor_id', vids);
        const cids = [...new Set((links ?? []).map(l => l.client_id as string))];
        if (cids.length) {
          const { data: cs } = await adminClient().from('crm_clients').select('id, first_name, last_name, business_name').in('id', cids);
          const nm = new Map((cs ?? []).map(k => [k.id as string, [k.first_name, k.last_name].filter(Boolean).join(' ') || (k.business_name as string) || 'Contact']));
          for (const l of links ?? []) { const n = nm.get(l.client_id as string); if (n) nameByVisitor.set(l.visitor_id as string, n); }
        }
      }
      eventsOut = (evs ?? []).map(e => ({ at: e.created_at as string, site: e.site as string, type: e.type as string, label: (e.label as string) ?? null, path: (e.path as string) ?? null, contact: e.visitor_id ? (nameByVisitor.get(e.visitor_id as string) ?? null) : null }));
    } catch { /* events are a bonus — never fail the live feed over them */ }

    return NextResponse.json({
      now: new Date(now).toISOString(),
      activeCount: activeSessions.size,
      activeBySite: [...bySite.entries()].map(([label, s]) => ({ label, value: s.size })).sort((a, b) => b.value - a.value),
      last30min: rows.length,
      events: eventsOut,
      feed,
    });
  } catch (e) {
    console.error('[live-activity]', e);
    return NextResponse.json({ error: 'Could not load live activity.' }, { status: 500 });
  }
}
