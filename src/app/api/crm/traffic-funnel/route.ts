/**
 * GET /api/crm/traffic-funnel?days=30&site=<host>&human=1 — "Traffic → dollars" for the Lead Attribution
 * page: visitors → engaged → took an action → leads → deals → closed, with pipeline value and commission,
 * by site and by channel.
 *
 * Visitors come from the first-party tracker (site_pageviews + site_events) and are sorted into quality
 * tiers by lib/visitor-quality.ts; `human=1` (the default) counts only real visitors at the top of the
 * funnel, `human=0` counts every pageview-bearing visitor. Leads and their deals come from the
 * traffic_funnel_leads RPC, which uses the same inbound / test / site rules as the attribution report.
 *
 * super_admin only, same boundary as lead-attribution and site-engagement: it aggregates every site.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isSuperAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { fetchAll } from '@/lib/campaign-engagement';
import { channelFor } from '@/lib/lead-context';
import { summarizeVisitors, isReal, isEngaged, type PageviewRow, type EventRow, type VisitorTier, type VisitorSummary } from '@/lib/visitor-quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITES = ['crecotx.com', 'fairoaksrealtygroup.com', 'elkhornpoint.com', 'fairoaksranchplaza.com'];
const OWN_HOSTS = /(^|\.)(crecotx|fairoaksrealtygroup|elkhornpoint|fairoaksranchplaza|fairoaksplaza)\.com$/i;
const OPEN_STAGES = new Set(['Prospect', 'Active', 'In Contract']);
const ROW_CAP = 60000;

type Deal = { id: string; stage: string | null; value: number | null; earned_commission: number | null; created_at: string };
type LeadRow = {
  id: string; created_at: string; site: string | null; channel: string | null; referrer: string | null;
  click_ids: Record<string, string> | null; visitor_id: string | null; deals: Deal[];
};

interface Bucket {
  visitors: number; engaged: number; acted: number; leads: number; deals: number; open: number; closed: number;
  pipeline: number; closedValue: number; commission: number; noValue: number;
}
const blank = (): Bucket => ({ visitors: 0, engaged: 0, acted: 0, leads: 0, deals: 0, open: 0, closed: 0, pipeline: 0, closedValue: 0, commission: 0, noValue: 0 });

/** Our own domains as a referrer are internal navigation, not a source. */
function externalReferrer(ref: string | null): string | null {
  if (!ref) return null;
  try { return OWN_HOSTS.test(new URL(ref).hostname) ? null : ref; } catch { return ref; }
}

function visitorChannel(v: VisitorSummary): string {
  return channelFor(externalReferrer(v.referrer), v.utmMedium, v.utmSource, v.clickIds);
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) return NextResponse.json({ error: 'Traffic reporting is limited to the account owner.' }, { status: 403 });

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30) || 30, 1), 90);
  const rawSite = req.nextUrl.searchParams.get('site');
  const site = rawSite && SITES.includes(rawSite) ? rawSite : null;
  const humanOnly = req.nextUrl.searchParams.get('human') !== '0';
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const db = adminClient();

  try {
    const [pvs, evs, links, leadsRes] = await Promise.all([
      fetchAll<PageviewRow>((a, b) => {
        let q = db.from('site_pageviews').select('site, session_id, visitor_id, created_at, referrer, utm_source, utm_medium, click_ids, city, env')
          .gte('created_at', since).order('created_at', { ascending: false }).range(a, b);
        if (site) q = q.eq('site', site);
        return q;
      }).then(r => r.slice(0, ROW_CAP)),
      fetchAll<EventRow>((a, b) => {
        let q = db.from('site_events').select('site, visitor_id, type, value, created_at')
          .gte('created_at', since).order('created_at', { ascending: false }).range(a, b);
        if (site) q = q.eq('site', site);
        return q;
      }).then(r => r.slice(0, ROW_CAP)),
      fetchAll<{ visitor_id: string; client_id: string }>((a, b) => db.from('site_visitor_links').select('visitor_id, client_id').range(a, b)),
      db.rpc('traffic_funnel_leads', { p_since: since, p_site: site }),
    ]);
    if (leadsRes.error) throw leadsRes.error;
    const leads = (leadsRes.data ?? []) as LeadRow[];
    const truncated = pvs.length >= ROW_CAP || evs.length >= ROW_CAP;

    const visitors = summarizeVisitors(pvs, evs, new Map(links.map(l => [l.visitor_id, l.client_id])));

    // ── quality ─────────────────────────────────────────────────────────────
    const quality: Record<VisitorTier | 'total' | 'real', number> = { acted: 0, engaged: 0, glance: 0, automated: 0, unverified: 0, total: 0, real: 0 };
    for (const v of visitors) { quality[v.tier] += 1; quality.total += 1; if (isReal(v.tier)) quality.real += 1; }
    const firstEnv = pvs.filter(p => p.env && Object.keys(p.env).length).reduce<string | null>((m, p) => (!m || p.created_at < m ? p.created_at : m), null);

    // ── buckets by site and by channel ──────────────────────────────────────
    const bySite = new Map<string, Bucket>();
    const byChannel = new Map<string, Bucket>();
    const get = (m: Map<string, Bucket>, k: string) => m.get(k) ?? m.set(k, blank()).get(k)!;
    const total = blank();
    const counts = (v: VisitorSummary) => (humanOnly ? isReal(v.tier) : true);
    const channelOfVid = new Map<string, string>();
    for (const v of visitors) {
      const ch = visitorChannel(v);
      const vid = v.key.split('|')[0];
      if (!channelOfVid.has(vid)) channelOfVid.set(vid, ch);
      if (!counts(v)) continue;
      for (const b of [get(bySite, v.site), get(byChannel, ch), total]) {
        b.visitors += 1;
        if (isEngaged(v.tier)) b.engaged += 1;
        if (v.tier === 'acted') b.acted += 1;
      }
    }

    // ── leads and dollars ───────────────────────────────────────────────────
    const leadChannel = (l: LeadRow): string => {
      if (l.channel) return l.channel;
      const viaVisitor = l.visitor_id ? channelOfVid.get(l.visitor_id) : undefined;
      if (viaVisitor) return viaVisitor;
      if (l.referrer || (l.click_ids && Object.keys(l.click_ids).length)) return channelFor(externalReferrer(l.referrer), null, null, l.click_ids);
      return 'Not recorded';
    };
    const recent = leads.slice(0, 12).map(l => ({
      id: l.id, at: l.created_at, site: l.site ?? 'Other / imported', channel: leadChannel(l),
      deals: l.deals.length, stages: [...new Set(l.deals.map(d => d.stage ?? '—'))],
    }));
    for (const l of leads) {
      const targets = [get(bySite, l.site ?? 'Other / imported'), get(byChannel, leadChannel(l)), total];
      for (const b of targets) b.leads += 1;
      for (const d of l.deals) {
        const stage = d.stage ?? '';
        const value = Number(d.value) || 0;
        const comm = stage === 'Lost' ? 0 : Number(d.earned_commission) || 0;   // a lost deal earned nothing
        for (const b of targets) {
          b.deals += 1;
          if (OPEN_STAGES.has(stage)) { b.open += 1; b.pipeline += value; }
          if (stage === 'Closed') { b.closed += 1; b.closedValue += value; }
          b.commission += comm;
          if ((OPEN_STAGES.has(stage) || stage === 'Closed') && !value) b.noValue += 1;
        }
      }
    }
    const rows = (m: Map<string, Bucket>) => [...m.entries()]
      .map(([label, b]) => ({ label, ...b }))
      .sort((a, b) => (b.leads - a.leads) || (b.visitors - a.visitors));

    return NextResponse.json({
      days, site, humanOnly, truncated,
      since, trackerUpgradedAt: firstEnv,
      quality,
      total, bySite: rows(bySite), byChannel: rows(byChannel),
      recentLeads: recent,
    });
  } catch (e) {
    console.error('[traffic-funnel]', e);
    return NextResponse.json({ error: 'Could not load the traffic funnel.' }, { status: 500 });
  }
}
