/**
 * Who actually engaged with a campaign — the people worth a phone call.
 *
 * Opens are not used: Apple Mail Privacy Protection "opens" every message it
 * delivers, so an open says nothing about a person. Clicks are the signal, but
 * the raw click log is mostly machines: corporate mail filters (Defender Safe
 * Links, Mimecast, Proofpoint, Barracuda) fetch every link in a message within
 * seconds of delivery to check it for malware. Measured on our own log in
 * Oct 2026: 114 "clickers", of whom 25 were people. A scanner looks like this —
 *   - a burst: 3+ different links fetched inside one minute (a person clicks
 *     one, maybe two, and they are minutes apart),
 *   - a click within seconds of the send, before anyone could have read it,
 *   - a non-browser user agent (python-requests, Go-http-client, CloudFront…).
 * Whatever survives those rules is treated as a person.
 *
 * Other signals, all tied to a known contact:
 *   - owner-report views / Broker Opinion of Value requests (crm_owner_reports),
 *   - inbound calls from the contact's number after the send (crm_call_log),
 *   - email replies (Gmail, checked only in the per-campaign panel because it
 *     costs API calls — see app/api/campaigns/engagement).
 *
 * "Contacted" = a call/email/note/meeting activity, a completed call/follow-up
 * task or an outbound call to their number AFTER they engaged. Engaged and not
 * contacted is the call list.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const SCANNER_UA = /python-requests|go-http-client|curl\/|wget|headless|\bbot\b|crawler|spider|cloudfront|okhttp|java\/|libwww|scanner|barracuda|proofpoint|mimecast|safelinks|urldefense/i;
const BURST_WINDOW_MS = 60_000;
const BURST_MIN_LINKS = 3;
const TOO_SOON_MS = 30_000;

export interface ClickEvent {
  campaign_id: string;
  client_id: string | null;
  url: string | null;
  occurred_at: string;
  user_agent: string | null;
}

/**
 * The clicks one recipient made on one campaign, minus scanner traffic.
 * `events` must all belong to the same (campaign, recipient).
 */
export function humanClicks(events: ClickEvent[], firstSentAt?: string | null): ClickEvent[] {
  const ev = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const t = ev.map(e => Date.parse(e.occurred_at));
  const burst = new Set<number>();
  for (let i = 0; i < ev.length; i++) {
    const urls = new Set<string>();
    let j = i;
    while (j < ev.length && t[j] - t[i] <= BURST_WINDOW_MS) { urls.add(ev[j].url ?? ''); j++; }
    if (urls.size >= BURST_MIN_LINKS) for (let x = i; x < j; x++) burst.add(x);
  }
  const sent = firstSentAt ? Date.parse(firstSentAt) : NaN;
  return ev.filter((e, i) => {
    if (!e.user_agent || SCANNER_UA.test(e.user_agent)) return false;
    if (burst.has(i)) return false;
    if (!Number.isNaN(sent) && t[i] - sent < TOO_SOON_MS) return false;
    if (/unsubscribe/i.test(e.url ?? '')) return false;
    return true;
  });
}

/** "https://www.crecotx.com/listings/1353-w-french-pl?utm_…" → "Listing · 1353 W French Pl" */
export function linkLabel(url: string | null): string {
  if (!url) return 'a link';
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, '');
    const title = (s: string) => decodeURIComponent(s).replace(/[-_]+/g, ' ').replace(/\b\w+/g, w =>
      /^(us|fm|ih|sh|rm|n|s|e|w|ne|nw|se|sw)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
    if (/\.pdf$/i.test(p)) return /flyer/i.test(p) ? 'Flyer (PDF)' : 'PDF';
    let m = p.match(/^\/listings\/([^/]+)/);
    if (m) return `Listing · ${title(m[1])}`;
    if (/^\/r\//.test(p)) return 'Owner report';
    if (/property-valuation/.test(p)) return 'Valuation page';
    m = p.match(/^\/([^/]+)/);
    if (!p || p === '') return u.hostname.replace(/^www\./, '');
    return `${u.hostname.replace(/^www\./, '')} · ${title(m ? m[1] : p)}`;
  } catch { return 'a link'; }
}

/** Page through a PostgREST query — the API silently stops at 1000 rows. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const digits10 = (p?: string | null) => (p ?? '').replace(/\D/g, '').slice(-10);

export interface Signal {
  kind: 'click' | 'report' | 'bov' | 'call' | 'reply';
  at: string;
  label: string;
}

export interface EngagedPerson {
  client_id: string;
  campaign_ids: string[];
  first_sent_at: string;
  signals: Signal[];
  tier: 'hot' | 'warm';
  last_signal_at: string;
  first_signal_at: string;
  contacted_at: string | null;
  contacted_how: string | null;
  open_task: boolean;
}

export interface CampaignFunnel {
  delivered: number;
  engaged: number;
  responded: number;
  to_call: number;
  /** Unique recipients with at least one human (non-scanner) click. */
  clickers: number;
  /** Unique human clickers / delivered — the honest click rate. */
  click_rate: number | null;
  /** Clickers the raw log counted but the filter rejected as mail scanners. */
  scanner_clickers: number;
}

const HOT: Signal['kind'][] = ['bov', 'call', 'reply'];

/**
 * Engagement for a set of campaigns. Gmail replies are passed in by the caller
 * (they need the caller's OAuth tokens); everything else is read here.
 */
export async function computeEngagement(
  db: SupabaseClient,
  campaigns: { id: string; email_body?: string | null }[],
  extraSignals: Map<string, Signal[]> = new Map(),
  /** client → when we last emailed them from Gmail (counts as contact). */
  emailedAt: Map<string, string> = new Map(),
): Promise<{ funnels: Map<string, CampaignFunnel>; people: Map<string, EngagedPerson> }> {
  const ids = campaigns.map(c => c.id);
  const funnels = new Map<string, CampaignFunnel>();
  const people = new Map<string, EngagedPerson>();
  if (!ids.length) return { funnels, people };

  // ── Sends + clicks, paged and chunked (both tables pass 1000 rows) ──────────
  const sends: { campaign_id: string; client_id: string; sent_at: string }[] = [];
  const clicks: ClickEvent[] = [];
  for (const part of chunk(ids, 80)) {
    sends.push(...await fetchAll<{ campaign_id: string; client_id: string; sent_at: string }>((a, b) =>
      db.from('crm_campaign_sends').select('campaign_id, client_id, sent_at')
        .in('campaign_id', part).eq('status', 'sent').eq('type', 'email').order('sent_at').range(a, b)));
    clicks.push(...await fetchAll<ClickEvent>((a, b) =>
      db.from('email_tracking_events').select('campaign_id, client_id, url, occurred_at, user_agent')
        .in('campaign_id', part).eq('event_type', 'click').order('occurred_at').range(a, b)));
  }

  // First send per (campaign, recipient)
  const firstSent = new Map<string, string>();
  const delivered = new Map<string, Set<string>>();
  for (const s of sends) {
    if (!s.client_id) continue;
    const k = `${s.campaign_id}|${s.client_id}`;
    if (!firstSent.has(k)) firstSent.set(k, s.sent_at);
    (delivered.get(s.campaign_id) ?? delivered.set(s.campaign_id, new Set()).get(s.campaign_id)!).add(s.client_id);
  }

  // signals[campaign|client]
  const sig = new Map<string, Signal[]>();
  const add = (k: string, s: Signal) => (sig.get(k) ?? sig.set(k, []).get(k)!).push(s);

  const rawClickers = new Map<string, Set<string>>();
  const byPair = new Map<string, ClickEvent[]>();
  for (const e of clicks) {
    if (!e.client_id) continue;
    const k = `${e.campaign_id}|${e.client_id}`;
    (byPair.get(k) ?? byPair.set(k, []).get(k)!).push(e);
    (rawClickers.get(e.campaign_id) ?? rawClickers.set(e.campaign_id, new Set()).get(e.campaign_id)!).add(e.client_id);
  }
  const humanClickers = new Map<string, Set<string>>();
  for (const [k, ev] of byPair) {
    const kept = humanClicks(ev, firstSent.get(k));
    if (!kept.length) continue;
    const [cid, client] = k.split('|');
    (humanClickers.get(cid) ?? humanClickers.set(cid, new Set()).get(cid)!).add(client);
    // One signal per distinct link (repeat clicks on the same link are one interest).
    const seen = new Set<string>();
    for (const e of kept) {
      const label = linkLabel(e.url);
      if (seen.has(label)) continue;
      seen.add(label);
      add(k, { kind: 'click', at: e.occurred_at, label: `Clicked ${label}` });
    }
  }

  // Recipients per campaign and the earliest send to each client across the set.
  const recipients = new Map<string, string[]>(); // client → campaign ids
  for (const k of firstSent.keys()) {
    const [cid, client] = k.split('|');
    (recipients.get(client) ?? recipients.set(client, []).get(client)!).push(cid);
  }
  const clientIds = [...recipients.keys()];
  const earliest = (client: string) => recipients.get(client)!.map(c => firstSent.get(`${c}|${client}`)!).sort()[0];

  // ── Owner reports (only for campaigns whose email links to one) ─────────────
  const reportCampaigns = new Set(campaigns.filter(c => /\{\{owner_report_url\}\}|\/r\//.test(c.email_body ?? '')).map(c => c.id));
  if (reportCampaigns.size) {
    const reports: { client_id: string; first_viewed_at: string | null; last_viewed_at: string | null; view_count: number | null; bov_requested_at: string | null }[] = [];
    for (const part of chunk(clientIds, 150)) {
      const { data } = await db.from('crm_owner_reports')
        .select('client_id, first_viewed_at, last_viewed_at, view_count, bov_requested_at')
        .in('client_id', part).not('first_viewed_at', 'is', null);
      reports.push(...(data ?? []));
    }
    for (const r of reports) {
      for (const cid of recipients.get(r.client_id) ?? []) {
        if (!reportCampaigns.has(cid)) continue;
        const k = `${cid}|${r.client_id}`;
        const sent = firstSent.get(k)!;
        if (r.last_viewed_at && r.last_viewed_at >= sent) {
          const n = r.view_count ?? 1;
          add(k, { kind: 'report', at: r.last_viewed_at, label: `Viewed their owner report${n > 1 ? ` ${n}×` : ''}` });
        }
        if (r.bov_requested_at && r.bov_requested_at >= sent) add(k, { kind: 'bov', at: r.bov_requested_at, label: 'Requested a valuation (BOV)' });
      }
    }
  }

  // ── Recipient phones (inbound calls + outbound "contacted") ─────────────────
  const phones = new Map<string, string[]>(); // client → last-10 digits
  for (const part of chunk(clientIds, 150)) {
    const { data } = await db.from('crm_clients').select('id, phone, cell_phone').in('id', part);
    for (const c of data ?? []) phones.set(c.id, [digits10(c.phone), digits10(c.cell_phone)].filter(d => d.length === 10));
  }
  const byDigits = new Map<string, string>();
  for (const [id, ds] of phones) for (const d of ds) byDigits.set(d, id);

  const since = clientIds.length ? clientIds.map(earliest).sort()[0] : new Date().toISOString();
  const calls = await fetchAll<{ direction: string; from_number: string | null; to_number: string | null; contact_id: string | null; started_at: string }>((a, b) =>
    db.from('crm_call_log').select('direction, from_number, to_number, contact_id, started_at')
      .gte('started_at', since).order('started_at').range(a, b));
  const outboundCalls = new Map<string, string>(); // client → latest outbound call
  for (const c of calls) {
    const inbound = c.direction === 'inbound';
    const who = (c.contact_id && recipients.has(c.contact_id)) ? c.contact_id : byDigits.get(digits10(inbound ? c.from_number : c.to_number));
    if (!who) continue;
    if (inbound) {
      for (const cid of recipients.get(who) ?? []) {
        const k = `${cid}|${who}`;
        const sent = firstSent.get(k)!;
        // Within 30 days of the send — a call months later isn't this email's doing.
        if (c.started_at >= sent && Date.parse(c.started_at) - Date.parse(sent) < 30 * 86400_000) {
          add(k, { kind: 'call', at: c.started_at, label: 'Called the office' });
        }
      }
    } else if (!outboundCalls.has(who) || c.started_at > outboundCalls.get(who)!) {
      outboundCalls.set(who, c.started_at);
    }
  }

  // Replies (and anything else the caller found) keyed campaign|client.
  for (const [k, list] of extraSignals) for (const s of list) add(k, s);

  // ── Fold into people ────────────────────────────────────────────────────────
  for (const [k, list] of sig) {
    const [cid, client] = k.split('|');
    const p = people.get(client) ?? {
      client_id: client, campaign_ids: [], first_sent_at: firstSent.get(k)!, signals: [],
      tier: 'warm' as const, last_signal_at: '', first_signal_at: '', contacted_at: null, contacted_how: null, open_task: false,
    };
    if (!p.campaign_ids.includes(cid)) p.campaign_ids.push(cid);
    if (firstSent.get(k)! < p.first_sent_at) p.first_sent_at = firstSent.get(k)!;
    p.signals.push(...list);
    people.set(client, p);
  }
  for (const p of people.values()) {
    p.signals.sort((a, b) => b.at.localeCompare(a.at));
    p.last_signal_at = p.signals[0].at;
    p.first_signal_at = p.signals[p.signals.length - 1].at;
    const strong = p.signals.some(s => HOT.includes(s.kind))
      || p.signals.filter(s => s.kind === 'click' || s.kind === 'report').length >= 2;
    p.tier = strong ? 'hot' : 'warm';
  }

  // ── Contacted since they engaged? ───────────────────────────────────────────
  const engagedIds = [...people.keys()];
  for (const part of chunk(engagedIds, 150)) {
    const [{ data: acts }, { data: tasks }] = await Promise.all([
      db.from('crm_client_activities').select('client_id, type, created_at').in('client_id', part)
        .in('type', ['call', 'email', 'note', 'meeting']).gte('created_at', since),
      db.from('crm_tasks').select('client_id, type, status, completed_at, created_at').in('client_id', part)
        .in('type', ['call', 'follow_up']),
    ]);
    for (const a of acts ?? []) {
      const p = people.get(a.client_id);
      if (p && a.created_at >= p.first_signal_at && (!p.contacted_at || a.created_at > p.contacted_at)) {
        p.contacted_at = a.created_at; p.contacted_how = a.type === 'note' ? 'note logged' : a.type;
      }
    }
    for (const t of tasks ?? []) {
      const p = people.get(t.client_id);
      if (!p) continue;
      const done = t.completed_at || ['done', 'completed'].includes(t.status);
      if (done && t.completed_at && t.completed_at >= p.first_signal_at && (!p.contacted_at || t.completed_at > p.contacted_at)) {
        p.contacted_at = t.completed_at; p.contacted_how = 'task completed';
      } else if (!done && t.created_at >= p.first_sent_at) {
        p.open_task = true;
      }
    }
  }
  for (const [client, at] of emailedAt) {
    const p = people.get(client);
    if (p && at >= p.first_signal_at && (!p.contacted_at || at > p.contacted_at)) { p.contacted_at = at; p.contacted_how = 'emailed'; }
  }
  for (const [client, at] of outboundCalls) {
    const p = people.get(client);
    if (p && at >= p.first_signal_at && (!p.contacted_at || at > p.contacted_at)) { p.contacted_at = at; p.contacted_how = 'call'; }
  }

  // ── Funnels ────────────────────────────────────────────────────────────────
  for (const id of ids) {
    const d = delivered.get(id)?.size ?? 0;
    const engaged = [...people.values()].filter(p => p.campaign_ids.includes(id));
    const responded = engaged.filter(p => p.signals.some(s => HOT.includes(s.kind) && sig.get(`${id}|${p.client_id}`)?.includes(s)));
    const human = humanClickers.get(id)?.size ?? 0;
    const raw = rawClickers.get(id)?.size ?? 0;
    funnels.set(id, {
      delivered: d,
      engaged: engaged.length,
      responded: responded.length,
      to_call: engaged.filter(p => !p.contacted_at).length,
      clickers: human,
      click_rate: d > 0 && clicks.length > 0 ? Math.round((human / d) * 100) : null,
      scanner_clickers: Math.max(0, raw - human),
    });
  }
  return { funnels, people };
}
