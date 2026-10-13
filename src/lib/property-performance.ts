/**
 * How a property's web pages are performing — views, real visitors, actions, inquiries, deals —
 * for the property card and the weekly owner report.
 *
 * A pageview belongs to a property when "<host><path>" contains one of the property's tokens:
 *   - slugs derived from its name and address ("1353 W French Pl" → 1353-w-french-pl, with the
 *     usual street-suffix spellings: Circle/Cir, Highway/Hwy, …),
 *   - its web_paths (explicit, set on the property card),
 *   - its lead_keywords (already used to match website inquiries to the property).
 * Host tokens work too ("elkhornpoint.com" claims the whole Elkhorn site).
 *
 * Visitors are counted as REAL using the same tiers as the Lead Attribution funnel
 * (lib/visitor-quality.ts), so scanners and crawlers don't inflate a property's traffic.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { channelFor } from '@/lib/lead-context';
import { fetchAll } from '@/lib/campaign-engagement';
import {
  summarizeVisitors, isReal, isEngaged, INTENT_EVENTS,
  type PageviewRow, type EventRow, type VisitorTier,
} from '@/lib/visitor-quality';

export interface PerfListing {
  id: string; name: string | null; address: string | null;
  web_paths?: string[] | null; lead_keywords?: string[] | null;
}
export interface InquiryLead { id: string; created_at: string; name: string | null; lead_source: string | null; site: string | null; landing_page: string | null; page_path: string | null }
export interface PerfDeal { listing_id: string | null; stage: string | null; created_at: string }
export type PerfPageview = PageviewRow & { path: string; utm_source?: string | null; utm_medium?: string | null };
export type PerfEvent = EventRow & { path: string | null };

export interface PerfMetrics {
  views: number; visitors: number; real: number; engaged: number; acted: number;
  calls: number; texts: number; emails: number; downloads: number; forms: number; clicks: number;
  inquiries: number; deals: number; openDeals: number;
}
export interface PropertyPerf {
  listingId: string; name: string; tokens: string[];
  current: PerfMetrics; previous: PerfMetrics | null;
  daily: { date: string; visitors: number }[];
  topPages: { site: string; path: string; views: number; visitors: number }[];
  sources: { label: string; visitors: number }[];
  inquiries: { id: string; name: string | null; at: string; source: string | null; page: string | null }[];
}

const OPEN_STAGES = new Set(['Prospect', 'Active', 'In Contract']);
const OWN_HOSTS = /(^|\.)(crecotx|fairoaksrealtygroup|elkhornpoint)\.com$/i;
const SWAPS: string[][] = [
  ['circle', 'cir'], ['drive', 'dr'], ['highway', 'hwy'], ['street', 'st'], ['road', 'rd'], ['parkway', 'pkwy'],
  ['place', 'pl'], ['boulevard', 'blvd'], ['lane', 'ln'], ['avenue', 'ave'], ['court', 'ct'], ['trail', 'trl'],
  ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'],
];

const slugify = (s: string) => s.toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** "2250 Chipley Cir" → ["2250-chipley-cir", "2250-chipley-circle"]. Only street-address-shaped text qualifies. */
export function slugCandidates(text: string | null | undefined): string[] {
  const base = slugify(text ?? '');
  const toks = base.split('-').filter(Boolean);
  if (toks.length < 2 || !/^\d/.test(toks[0])) return [];     // must start with a street number
  let combos: string[][] = [[]];
  for (const t of toks) {
    const swap = SWAPS.find(p => p.includes(t));
    const opts = swap ? swap : [t];
    combos = combos.flatMap(c => opts.map(o => [...c, o])).slice(0, 24);
  }
  return [...new Set(combos.map(c => c.join('-')))];
}

export function listingTokens(l: PerfListing): string[] {
  const t = new Set<string>();
  for (const s of [...slugCandidates(l.name), ...slugCandidates(l.address)]) t.add(s);
  for (const s of [...(l.web_paths ?? []), ...(l.lead_keywords ?? [])]) {
    const v = String(s ?? '').trim().toLowerCase();
    if (v.length >= 3) t.add(v);
  }
  return [...t];
}

const hayOf = (site: string | null, path: string | null) => `${site ?? ''}${(path ?? '').split('?')[0]}`.toLowerCase();
export const matchesTokens = (tokens: string[], site: string | null, path: string | null) => {
  const hay = hayOf(site, path);
  return tokens.some(t => hay.includes(t));
};

const blank = (): PerfMetrics => ({ views: 0, visitors: 0, real: 0, engaged: 0, acted: 0, calls: 0, texts: 0, emails: 0, downloads: 0, forms: 0, clicks: 0, inquiries: 0, deals: 0, openDeals: 0 });
const extRef = (ref: string | null | undefined) => { if (!ref) return null; try { return OWN_HOSTS.test(new URL(ref).hostname) ? null : ref; } catch { return ref; } };
const chicagoDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

export function computePropertyPerformance(opts: {
  listings: PerfListing[]; pvs: PerfPageview[]; evs: PerfEvent[]; leads: InquiryLead[]; deals: PerfDeal[];
  days: number; now?: number; withPrevious?: boolean;
}): Map<string, PropertyPerf> {
  const now = opts.now ?? Date.now();
  const curFrom = now - opts.days * 86400_000;
  const prevFrom = curFrom - opts.days * 86400_000;
  const inCur = (iso: string) => Date.parse(iso) >= curFrom;
  const inPrev = (iso: string) => Date.parse(iso) >= prevFrom && Date.parse(iso) < curFrom;

  // Visitor tiers over everything we were given, once.
  const tierOf = new Map<string, VisitorTier>();
  for (const v of summarizeVisitors(opts.pvs, opts.evs, new Map())) tierOf.set(v.key, v.tier);
  const keyOf = (p: { visitor_id: string | null; session_id?: string; site: string }) => `${p.visitor_id ?? `s:${p.session_id}`}|${p.site}`;

  const out = new Map<string, PropertyPerf>();
  const dayList: string[] = [];
  for (let i = opts.days - 1; i >= 0 && i < 120; i--) dayList.push(chicagoDay(new Date(now - i * 86400_000).toISOString()));

  for (const l of opts.listings) {
    const tokens = listingTokens(l);
    const cur = blank(); const prev = blank();
    const vis = { cur: new Set<string>(), prev: new Set<string>() };
    const dayVis = new Map<string, Set<string>>();
    const pages = new Map<string, { site: string; path: string; views: number; vis: Set<string> }>();
    const firstTouch = new Map<string, PerfPageview>();
    const acted = { cur: new Set<string>(), prev: new Set<string>() };

    if (tokens.length) {
      for (const p of opts.pvs) {
        if (!matchesTokens(tokens, p.site, p.path)) continue;
        const k = keyOf(p);
        if (inCur(p.created_at)) {
          cur.views += 1; vis.cur.add(k);
          const d = chicagoDay(p.created_at);
          (dayVis.get(d) ?? dayVis.set(d, new Set()).get(d)!).add(k);
          const pk = `${p.site}${p.path.split('?')[0]}`;
          const pg = pages.get(pk) ?? { site: p.site, path: p.path.split('?')[0], views: 0, vis: new Set<string>() };
          pg.views += 1; pg.vis.add(k); pages.set(pk, pg);
          const ft = firstTouch.get(k); if (!ft || p.created_at < ft.created_at) firstTouch.set(k, p);
        } else if (opts.withPrevious && inPrev(p.created_at)) { prev.views += 1; vis.prev.add(k); }
      }
      for (const e of opts.evs) {
        if (!INTENT_EVENTS.has(e.type) || e.type === 'email_click_identified' || !matchesTokens(tokens, e.site, e.path)) continue;
        const bucket = inCur(e.created_at) ? cur : (opts.withPrevious && inPrev(e.created_at) ? prev : null);
        if (!bucket) continue;
        const k = e.visitor_id ? `${e.visitor_id}|${e.site}` : null;
        if (k) (bucket === cur ? acted.cur : acted.prev).add(k);
        if (e.type === 'phone_tap' || e.type === 'phone_call') bucket.calls += 1;
        else if (e.type === 'text_tap') bucket.texts += 1;
        else if (e.type === 'email_tap') bucket.emails += 1;
        else if (e.type === 'download') bucket.downloads += 1;
        else if (e.type === 'cta_click' || e.type === 'cta_clicked') bucket.clicks += 1;
        else bucket.forms += 1;
      }
    }

    const finish = (m: PerfMetrics, set: Set<string>, actedSet: Set<string>) => {
      m.visitors = set.size;
      for (const k of set) { const t = tierOf.get(k); if (t && isReal(t)) m.real += 1; if (t && isEngaged(t)) m.engaged += 1; }
      m.acted = actedSet.size;
    };
    finish(cur, vis.cur, acted.cur); finish(prev, vis.prev, acted.prev);
    // Traffic from before the Oct 2026 tracker upgrade can't be told apart from scanners, so a
    // prior period with visits but nobody verifiable is not a baseline — show no comparison.
    const prevUsable = !!opts.withPrevious && !(prev.visitors > 0 && prev.real === 0);

    // Inquiries: inbound leads that landed on one of this property's pages.
    const myInquiries: PropertyPerf['inquiries'] = [];
    if (tokens.length) {
      for (const ld of opts.leads) {
        const hay = `${hayOf(ld.site, ld.landing_page)} ${hayOf(ld.site, ld.page_path)} ${hayOf(null, ld.landing_page)}`;
        if (!tokens.some(t => hay.includes(t))) continue;
        if (inCur(ld.created_at)) { cur.inquiries += 1; myInquiries.push({ id: ld.id, name: ld.name, at: ld.created_at, source: ld.lead_source, page: (ld.landing_page ?? ld.page_path ?? '').split('?')[0] || null }); }
        else if (opts.withPrevious && inPrev(ld.created_at)) prev.inquiries += 1;
      }
    }
    // Deals filed against the property.
    for (const d of opts.deals) {
      if (d.listing_id !== l.id) continue;
      if (inCur(d.created_at)) { cur.deals += 1; if (OPEN_STAGES.has(d.stage ?? '')) cur.openDeals += 1; }
    }

    const sources = new Map<string, number>();
    for (const [k, p] of firstTouch) {
      if (!(tierOf.get(k) && isReal(tierOf.get(k)!))) continue;
      const ch = channelFor(extRef(p.referrer), p.utm_medium ?? null, p.utm_source ?? null, p.click_ids);
      sources.set(ch, (sources.get(ch) ?? 0) + 1);
    }

    out.set(l.id, {
      listingId: l.id, name: l.name ?? 'Property', tokens, current: cur, previous: prevUsable ? prev : null,
      daily: dayList.map(date => ({ date, visitors: dayVis.get(date)?.size ?? 0 })),
      topPages: [...pages.values()].sort((a, b) => b.views - a.views).slice(0, 6).map(p => ({ site: p.site, path: p.path, views: p.views, visitors: p.vis.size })),
      sources: [...sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, visitors]) => ({ label, visitors })),
      inquiries: myInquiries.slice(0, 5),
    });
  }
  return out;
}

// ── Loading ───────────────────────────────────────────────────────────────────


const ROW_CAP = 60000;

/** Performance for a set of properties over `days` (and the same span before it, when withPrevious). */
export async function loadPropertyPerformance(
  db: SupabaseClient, listings: PerfListing[], days: number, withPrevious = true,
): Promise<Map<string, PropertyPerf>> {
  if (!listings.length) return new Map();
  const span = withPrevious ? days * 2 : days;
  const since = new Date(Date.now() - span * 86400_000).toISOString();
  const [pvs, evs, leadsRes, dealRows] = await Promise.all([
    fetchAll<PerfPageview>((a, b) => db.from('site_pageviews')
      .select('site, session_id, visitor_id, created_at, path, referrer, utm_source, utm_medium, click_ids, city, env')
      .gte('created_at', since).order('created_at', { ascending: false }).range(a, b)).then(r => r.slice(0, ROW_CAP)),
    fetchAll<PerfEvent>((a, b) => db.from('site_events')
      .select('site, visitor_id, type, value, path, created_at')
      .gte('created_at', since).order('created_at', { ascending: false }).range(a, b)).then(r => r.slice(0, ROW_CAP)),
    db.rpc('property_inquiry_leads', { p_since: since }),
    fetchAll<PerfDeal>((a, b) => db.from('crm_deals').select('listing_id, stage, created_at')
      .in('listing_id', listings.map(l => l.id)).gte('created_at', since).range(a, b)),
  ]);
  const leads = (leadsRes.data ?? []) as InquiryLead[];
  return computePropertyPerformance({ listings, pvs, evs, leads, deals: dealRows, days, withPrevious });
}

/** One line for the weekly owner report: how the property's web pages did (30 days, with this week). */
export function websiteLine(month: PropertyPerf | undefined, week: PropertyPerf | undefined): string | null {
  if (!month || month.tokens.length === 0) return null;
  const m = month.current; const w = week?.current;
  const actions = m.calls + m.texts + m.emails + m.downloads + m.forms + m.clicks;
  const parts = [
    `${m.real.toLocaleString()} real visitors (${m.views.toLocaleString()} page views, last 30 days)`,
    `${actions} call / text / download / form actions`,
    `${m.inquiries} website inquir${m.inquiries === 1 ? 'y' : 'ies'}`,
  ];
  const wk = w ? `  (this week: ${w.real} visitors, ${w.inquiries} inquir${w.inquiries === 1 ? 'y' : 'ies'})` : '';
  return parts.join(' · ') + wk;
}
