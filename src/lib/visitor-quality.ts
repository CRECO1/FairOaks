/**
 * Is this visitor a person? — and what did they do.
 *
 * Raw pageview counts are inflated by scanners, crawlers and link checkers. Of 813 visitors in a
 * two-week window (Oct 2026), 630 were a single pageview with no sign of a human: no browser
 * environment, no scroll, no time on the page, and 495 of them from cloud-provider cities (Seattle,
 * San Jose, Ashburn, Newark, Boydton…). The people were the ~110 who scrolled, stayed or tapped.
 *
 * Tiers, per visitor per site, from the first-party tracker only (no third party):
 *   acted       — tapped to call/email/text, hit a CTA, downloaded, started a form, or came in on an
 *                 identified email link.
 *   engaged     — stayed ≥ 8s on a page, scrolled, or viewed 2+ pages in a real browser.
 *   glance      — a real browser (the tracker reported its environment) that viewed one page and left.
 *   automated   — a real-browser-shaped hit from a cloud-provider city with no engagement at all.
 *   unverified  — a pageview with no browser environment: the tracker before the Oct 7 2026 upgrade
 *                 (or something that never ran it). Can't be called human or not, so it is kept out of
 *                 "real visitors" and shown on its own rather than guessed at.
 *
 * "Real visitors" = acted + engaged + glance.
 */

export type VisitorTier = 'acted' | 'engaged' | 'glance' | 'automated' | 'unverified';

/** Same list the engagement report treats as high intent, plus the form/CTA events the sites mirror. */
export const INTENT_EVENTS = new Set([
  'phone_tap', 'email_tap', 'text_tap', 'phone_call', 'cta_click', 'cta_clicked', 'download',
  'lead_form_started', 'inquiry_modal_opened', 'homepage_callback_opened',
  'inline_lead_submitted', 'property_alerts_inline_subscribed', 'email_click_identified',
]);

/** Cities that are almost only cloud / CDN / scanner hosts. Only used together with zero engagement. */
export const DATACENTER_CITIES = new Set([
  'ashburn', 'boydton', 'council bluffs', 'des moines', 'the dalles', 'boardman', 'moses lake', 'quincy',
  'santa clara', 'mountain view', 'san jose', 'seattle', 'newark', 'secaucus', 'portland', 'columbus',
  'dublin', 'frankfurt am main', 'singapore', 'mumbai', 'tokyo', 'sydney', 'sao paulo',
].map(c => c.toLowerCase()));

export const ENGAGED_SECONDS = 8;

export interface VisitorFacts {
  hasEnv: boolean;
  pageviews: number;
  intent: boolean;
  engagedSec: number;
  scrolled: boolean;
  city: string | null;
  /** A contact is linked to this visitor (lead form or signed email link). */
  linked: boolean;
}

export function classifyVisitor(f: VisitorFacts): VisitorTier {
  if (!f.hasEnv) return 'unverified';
  if (f.intent) return 'acted';
  if (f.engagedSec >= ENGAGED_SECONDS || f.scrolled || f.pageviews >= 2 || f.linked) return 'engaged';
  if (f.city && DATACENTER_CITIES.has(f.city.toLowerCase())) return 'automated';
  return 'glance';
}

export const isReal = (t: VisitorTier) => t === 'acted' || t === 'engaged' || t === 'glance';
export const isEngaged = (t: VisitorTier) => t === 'acted' || t === 'engaged';

export interface PageviewRow {
  site: string; session_id: string; visitor_id: string | null; created_at: string; path?: string | null;
  referrer: string | null; utm_source?: string | null; utm_medium?: string | null;
  click_ids: Record<string, string> | null; city: string | null; env: Record<string, unknown> | null;
}
export interface EventRow {
  site: string; visitor_id: string | null; type: string; value: number | null; created_at: string; path?: string | null;
}

export interface VisitorSummary {
  key: string; site: string; tier: VisitorTier; firstAt: string;
  referrer: string | null; utmSource: string | null; utmMedium: string | null; clickIds: Record<string, string> | null;
  clientId: string | null;
}

/** One summary per (visitor, site) from raw pageview + event rows. Legacy rows without a visitor id key on the session. */
export function summarizeVisitors(pvs: PageviewRow[], evs: EventRow[], clientOfVisitor: Map<string, string>): VisitorSummary[] {
  type Acc = { site: string; pv: number; sessions: Set<string>; hasEnv: boolean; city: string | null; first: PageviewRow; vid: string | null };
  const acc = new Map<string, Acc>();
  for (const p of pvs) {
    const key = `${p.visitor_id ?? `s:${p.session_id}`}|${p.site}`;
    let a = acc.get(key);
    if (!a) { a = { site: p.site, pv: 0, sessions: new Set(), hasEnv: false, city: p.city, first: p, vid: p.visitor_id }; acc.set(key, a); }
    a.pv += 1; a.sessions.add(p.session_id);
    if (p.env && Object.keys(p.env).length) a.hasEnv = true;
    if (!a.city && p.city) a.city = p.city;
    if (p.created_at < a.first.created_at) a.first = p;
  }
  const evAcc = new Map<string, { intent: boolean; engagedSec: number; scrolled: boolean }>();
  for (const e of evs) {
    if (!e.visitor_id) continue;
    const key = `${e.visitor_id}|${e.site}`;
    const x = evAcc.get(key) ?? { intent: false, engagedSec: 0, scrolled: false };
    if (INTENT_EVENTS.has(e.type)) x.intent = true;
    if (e.type === 'page_exit') x.engagedSec = Math.max(x.engagedSec, Number(e.value) || 0);
    if (e.type === 'scroll') x.scrolled = true;
    evAcc.set(key, x);
  }
  const out: VisitorSummary[] = [];
  for (const [key, a] of acc) {
    const e = evAcc.get(key);
    const clientId = a.vid ? (clientOfVisitor.get(a.vid) ?? null) : null;
    out.push({
      key, site: a.site, firstAt: a.first.created_at,
      tier: classifyVisitor({ hasEnv: a.hasEnv, pageviews: a.pv, intent: !!e?.intent, engagedSec: e?.engagedSec ?? 0, scrolled: !!e?.scrolled, city: a.city, linked: !!clientId }),
      referrer: a.first.referrer, utmSource: a.first.utm_source ?? null, utmMedium: a.first.utm_medium ?? null,
      clickIds: a.first.click_ids, clientId,
    });
  }
  return out;
}
