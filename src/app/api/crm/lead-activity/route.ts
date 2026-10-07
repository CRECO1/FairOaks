/**
 * GET /api/crm/lead-activity?client_id=<uuid> — a contact's whole website story.
 *
 * Stitches together everything we know about this person's browsing: the anonymous visitor ids tied to
 * them (a lead form they submitted, or a signed link from one of our campaign emails), then every pageview
 * and behaviour event those visitor ids produced — before AND after they became a lead. Plus the first
 * touch, ad click ids and environment stored on the contact.
 *
 * Access: any agent who can see the contact (workspace + ownership rules via assertOwnsResource). This is
 * per-contact detail, unlike the owner-only aggregate reports.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, assertOwnsResource } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const clientId = req.nextUrl.searchParams.get('client_id');
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_clients', clientId, ctx))) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  const db = adminClient();
  try {
    const { data: c } = await db.from('crm_clients')
      .select('visitor_id, visit_count, first_touch, click_ids, env, channel, utm_source, utm_medium, utm_campaign, landing_page, referrer, created_at, journey, time_on_site_sec')
      .eq('id', clientId).maybeSingle();
    const { data: links } = await db.from('site_visitor_links').select('visitor_id, source, linked_at').eq('client_id', clientId);

    const ids = new Set<string>();
    if (c?.visitor_id) ids.add(c.visitor_id as string);
    for (const l of links ?? []) ids.add(l.visitor_id as string);
    const visitorIds = [...ids];

    let pageviews: Record<string, unknown>[] = [];
    let events: Record<string, unknown>[] = [];
    if (visitorIds.length) {
      const [pv, ev] = await Promise.all([
        db.from('site_pageviews')
          .select('site, session_id, visitor_id, visit_n, path, title, referrer, utm_source, utm_medium, utm_campaign, device, browser, os, city, region, country, created_at')
          .in('visitor_id', visitorIds).order('created_at', { ascending: false }).limit(400),
        db.from('site_events')
          .select('site, session_id, visitor_id, type, label, value, path, meta, created_at')
          .in('visitor_id', visitorIds).order('created_at', { ascending: false }).limit(800),
      ]);
      pageviews = (pv.data ?? []) as Record<string, unknown>[];
      events = (ev.data ?? []) as Record<string, unknown>[];
    }

    // ── summary ────────────────────────────────────────────────────────────────────────────────
    const sessions = new Set<string>();
    const sites = new Set<string>(), devices = new Set<string>(), browsers = new Set<string>(), places = new Set<string>();
    const pageCount = new Map<string, number>();
    const campaigns = new Set<string>();
    let first: string | null = null, last: string | null = null;
    for (const p of pageviews) {
      sessions.add(String(p.session_id));
      sites.add(String(p.site));
      if (p.device) devices.add(String(p.device));
      if (p.browser || p.os) browsers.add([p.browser, p.os].filter(Boolean).join(' · '));
      const where = [p.city, p.region].filter(Boolean).join(', '); if (where) places.add(where);
      if (p.utm_campaign) campaigns.add(String(p.utm_campaign));
      pageCount.set(String(p.path), (pageCount.get(String(p.path)) ?? 0) + 1);
      const t = String(p.created_at);
      if (!first || t < first) first = t;
      if (!last || t > last) last = t;
    }
    for (const e of events) { const t = String(e.created_at); if (!first || t < first) first = t; if (!last || t > last) last = t; }
    const count = (type: string) => events.filter(e => e.type === type).length;
    const engagedSec = events.filter(e => e.type === 'page_exit').reduce((n, e) => n + (Number(e.value) || 0), 0);
    const maxScroll = events.filter(e => e.type === 'page_exit').reduce((n, e) => Math.max(n, Number((e.meta as { max_scroll?: number } | null)?.max_scroll) || 0), 0);

    return NextResponse.json({
      contact: c ?? null,
      linked: (links ?? []).map(l => ({ source: l.source, at: l.linked_at })),
      visitorIds: visitorIds.map(v => v.slice(0, 8)),
      summary: {
        firstSeen: first, lastSeen: last,
        visits: sessions.size, pageviews: pageviews.length, engagedSec, maxScroll,
        phoneTaps: count('phone_tap'), emailTaps: count('email_tap'), downloads: count('download'),
        ctaClicks: count('cta_click'), formStarts: count('lead_form_started'),
        sites: [...sites], devices: [...devices], browsers: [...browsers], places: [...places], campaigns: [...campaigns],
        topPages: [...pageCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, n]) => ({ path, n })),
      },
      pageviews, events,
    });
  } catch (e) {
    console.error('[lead-activity]', e);
    return NextResponse.json({ error: 'Could not load website activity.' }, { status: 500 });
  }
}
