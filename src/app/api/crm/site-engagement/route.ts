/**
 * GET /api/crm/site-engagement?days=7&site=<host> — owner-only engagement report built from the first-party
 * tracker (site_pageviews + site_events): visitors new vs returning, high-intent actions (phone / email taps,
 * CTA clicks, downloads, form starts), top pages with time + scroll, devices / browsers / places, paid click
 * ids, and — the useful bit — KNOWN contacts who are active on the sites (linked by a campaign-email click or
 * a lead form), with what they did.
 *
 * super_admin only, same boundary as lead-attribution: it aggregates every visitor on all three sites.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isSuperAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { fetchAll } from '@/lib/campaign-engagement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITES = ['crecotx.com', 'fairoaksrealtygroup.com', 'elkhornpoint.com'];
const top = (m: Map<string, number>, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value]) => ({ label, value }));
const bump = (m: Map<string, number>, k: string | null | undefined, by = 1) => { if (k) m.set(k, (m.get(k) ?? 0) + by); };
const HIGH_INTENT = new Set(['phone_tap', 'email_tap', 'text_tap', 'download', 'cta_click', 'lead_form_started', 'email_click_identified']);

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) return NextResponse.json({ error: 'Engagement reporting is limited to the account owner.' }, { status: 403 });

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 7) || 7, 1), 90);
  const rawSite = req.nextUrl.searchParams.get('site');
  const site = rawSite && SITES.includes(rawSite) ? rawSite : null;
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const db = adminClient();

  try {
    type PV = { site: string; session_id: string; visitor_id: string | null; visit_n: number | null; path: string; title: string | null; referrer: string | null; click_ids: Record<string, string> | null; device: string | null; browser: string | null; os: string | null; city: string | null; country: string | null; env: { lang?: string } | null; created_at: string };
    type EV = { site: string; visitor_id: string | null; type: string; label: string | null; value: number | null; path: string | null; meta: Record<string, unknown> | null; created_at: string };

    const pvs = await fetchAll<PV>((a, b) => {
      let q = db.from('site_pageviews').select('site, session_id, visitor_id, visit_n, path, title, referrer, click_ids, device, browser, os, city, country, env, created_at').gte('created_at', since).order('id', { ascending: false }).range(a, b);
      if (site) q = q.eq('site', site);
      return q;
    }).then(r => r.slice(0, 30000));
    const evs = await fetchAll<EV>((a, b) => {
      let q = db.from('site_events').select('site, visitor_id, type, label, value, path, meta, created_at').gte('created_at', since).order('id', { ascending: false }).range(a, b);
      if (site) q = q.eq('site', site);
      return q;
    }).then(r => r.slice(0, 30000));

    // ── visitors ─────────────────────────────────────────────────────────────────────────────
    const visitors = new Set<string>(), returning = new Set<string>(), sessions = new Set<string>();
    const devices = new Map<string, number>(), browsers = new Map<string, number>(), oss = new Map<string, number>(), places = new Map<string, number>(), langs = new Map<string, number>(), referrers = new Map<string, number>(), clickIdCounts = new Map<string, number>();
    const pageStats = new Map<string, { views: number; title: string | null; engaged: number; engagedN: number; scroll: number; scrollN: number }>();
    for (const p of pvs) {
      sessions.add(p.session_id);
      if (p.visitor_id) { visitors.add(p.visitor_id); if ((p.visit_n ?? 1) > 1) returning.add(p.visitor_id); }
      bump(devices, p.device); bump(browsers, p.browser); bump(oss, p.os);
      bump(places, [p.city, p.country].filter(Boolean).join(', ') || null);
      bump(langs, p.env?.lang?.split('-')[0]);
      if (p.referrer) { try { bump(referrers, new URL(p.referrer).hostname.replace(/^www\./, '')); } catch { /* skip */ } }
      for (const k of Object.keys(p.click_ids ?? {})) bump(clickIdCounts, k);
      const s = pageStats.get(p.path) ?? { views: 0, title: p.title, engaged: 0, engagedN: 0, scroll: 0, scrollN: 0 };
      s.views += 1; if (!s.title) s.title = p.title; pageStats.set(p.path, s);
    }

    // ── events ───────────────────────────────────────────────────────────────────────────────
    const byType = new Map<string, number>(), typeVisitors = new Map<string, Set<string>>();
    const ctas = new Map<string, number>(), phones = new Map<string, number>(), outbound = new Map<string, number>(), downloads = new Map<string, number>(), errors = new Map<string, number>();
    const scroll = new Map<string, number>();
    let loadSum = 0, loadN = 0;
    for (const e of evs) {
      bump(byType, e.type);
      if (e.visitor_id) { if (!typeVisitors.has(e.type)) typeVisitors.set(e.type, new Set()); typeVisitors.get(e.type)!.add(e.visitor_id); }
      if (e.type === 'cta_click') bump(ctas, e.label);
      else if (e.type === 'phone_tap') bump(phones, e.label);
      else if (e.type === 'outbound_click') bump(outbound, e.label?.split('/')[0]);
      else if (e.type === 'download') bump(downloads, e.label);
      else if (e.type === 'js_error') bump(errors, e.label);
      else if (e.type === 'scroll') bump(scroll, e.label);
      else if (e.type === 'page_load' && e.value) { loadSum += Number(e.value); loadN += 1; }
      else if (e.type === 'page_exit' && e.path) {
        const s = pageStats.get(e.path);
        if (s) { s.engaged += Number(e.value) || 0; s.engagedN += 1; const ms = Number((e.meta as { max_scroll?: number } | null)?.max_scroll); if (Number.isFinite(ms)) { s.scroll += ms; s.scrollN += 1; } }
      }
    }

    // ── known contacts on the site ───────────────────────────────────────────────────────────
    const vIds = [...visitors];
    const links: { visitor_id: string; client_id: string; source: string }[] = [];
    for (let i = 0; i < vIds.length; i += 200) {
      const { data } = await db.from('site_visitor_links').select('visitor_id, client_id, source').in('visitor_id', vIds.slice(i, i + 200));
      links.push(...((data ?? []) as typeof links));
    }
    const clientOfVisitor = new Map(links.map(l => [l.visitor_id, l.client_id]));
    const perClient = new Map<string, { pages: number; events: number; last: string; sites: Set<string>; paths: Map<string, number>; actions: Map<string, number> }>();
    const touch = (vid: string | null, at: string, siteHost: string) => {
      const cid = vid ? clientOfVisitor.get(vid) : null; if (!cid) return null;
      let c = perClient.get(cid); if (!c) { c = { pages: 0, events: 0, last: at, sites: new Set(), paths: new Map(), actions: new Map() }; perClient.set(cid, c); }
      if (at > c.last) c.last = at; c.sites.add(siteHost); return c;
    };
    for (const p of pvs) { const c = touch(p.visitor_id, p.created_at, p.site); if (c) { c.pages += 1; bump(c.paths, p.path); } }
    for (const e of evs) { const c = touch(e.visitor_id, e.created_at, e.site); if (c) { c.events += 1; if (HIGH_INTENT.has(e.type)) bump(c.actions, e.type); } }
    const clientIds = [...perClient.keys()];
    const nameOf = new Map<string, { name: string; type: string | null; business: string | null }>();
    if (clientIds.length) {
      const { data } = await db.from('crm_clients').select('id, first_name, last_name, business_name, type').in('id', clientIds.slice(0, 200));
      for (const k of data ?? []) nameOf.set(k.id as string, { name: [k.first_name, k.last_name].filter(Boolean).join(' ') || (k.business_name as string) || 'Contact', type: (k.type as string) ?? null, business: (k.business_name as string) ?? null });
    }
    const known = clientIds.map(id => {
      const c = perClient.get(id)!; const n = nameOf.get(id);
      return {
        client_id: id, name: n?.name ?? 'Contact', type: n?.type ?? null, business: n?.business ?? null,
        last: c.last, pages: c.pages, events: c.events, sites: [...c.sites],
        topPages: top(c.paths, 3).map(x => x.label), actions: top(c.actions, 4),
      };
    }).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 25);

    // ── recent high-intent feed ──────────────────────────────────────────────────────────────
    const feed = evs.filter(e => HIGH_INTENT.has(e.type)).slice(0, 40).map(e => {
      const cid = e.visitor_id ? clientOfVisitor.get(e.visitor_id) : null;
      return { at: e.created_at, site: e.site, type: e.type, label: e.label, path: e.path, contact: cid ? (nameOf.get(cid)?.name ?? null) : null, client_id: cid ?? null };
    });

    const pages = [...pageStats.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 12).map(([path, s]) => ({
      path, title: s.title, views: s.views,
      avgEngagedSec: s.engagedN ? Math.round(s.engaged / s.engagedN) : null,
      avgScroll: s.scrollN ? Math.round(s.scroll / s.scrollN) : null,
    }));

    return NextResponse.json({
      days, site,
      totals: {
        visitors: visitors.size, returning: returning.size, sessions: sessions.size, pageviews: pvs.length, events: evs.length,
        avgLoadMs: loadN ? Math.round(loadSum / loadN) : null,
      },
      intent: ['phone_tap', 'email_tap', 'text_tap', 'cta_click', 'download', 'lead_form_started'].map(t => ({
        type: t, count: byType.get(t) ?? 0, visitors: typeVisitors.get(t)?.size ?? 0,
      })),
      pages,
      ctas: top(ctas), phones: top(phones, 5), outbound: top(outbound, 6), downloads: top(downloads, 6),
      scroll: [25, 50, 75, 90].map(m => ({ label: `${m}%`, value: scroll.get(String(m)) ?? 0 })),
      devices: top(devices), browsers: top(browsers), os: top(oss), places: top(places), languages: top(langs, 5), referrers: top(referrers, 8),
      clickIds: top(clickIdCounts), errors: top(errors, 5),
      known, feed,
    });
  } catch (e) {
    console.error('[site-engagement]', e);
    return NextResponse.json({ error: 'Could not load engagement.' }, { status: 500 });
  }
}
