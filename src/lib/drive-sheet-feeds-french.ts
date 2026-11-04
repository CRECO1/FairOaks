import type { DriveContext } from '@/lib/drive-server';
import type { FeedData } from '@/lib/drive-sheet';

// Live feeds for the 1353 W French Pl (Beacon Hill warehouse / Auto Brite) lease outreach. Same rules as the Elkhorn tracker:
// contacted businesses first (most recent on top, with their notes), then the ones not yet contacted grouped by type of business,
// not-interested / unsubscribed last. "Contacted" counts logged calls, Call Queue call entries and meetings from ANY agent.

const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : '';
const md = (iso: string) => { const d = day(iso); return d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : ''; };
const phone = (n: string | null | undefined) => { const d = String(n ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(n ?? ''); };
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const personName = (c: { first_name?: string | null; last_name?: string | null }) => [c.first_name, c.last_name].filter(Boolean).join(' ').trim();

type Client = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; phone: string | null; cell_phone: string | null; email: string | null; unsubscribed_at: string | null; tags: string[] | null; notes: string | null };
type Touch = { at: string; who: string; kind: 'call' | 'meeting'; text: string; outcome: string; reached: boolean };

const CAMPAIGN_LIKE = ['%French Pl%', 'Beacon Hill Warehouse%'];
const NOT_INTERESTED = /not interested|no longer (looking|interested)|wouldn.?t be interested|already (signed|leased)|just signed|do not (call|contact)/i;

const GENERIC_TAG = /^(CRECO|Opened Email|Opened Brochure|Dead Email|Hard Bounce|Email Bounced|New Lead|Viewed Space|Crexi Lead|San Antonio Metro|SA CRE Import.*|2250 Chipley Cir|Beacon Hill Prospect|Warehouse Prospect|AutoBrite Pad Prospect|Auto Brite.*|French Pl.*|Prospective Tenant|Tenant Prospects|Cold Prospects|Pad Site User|Local Operator|Do Not Call|Corporate.*|Bounced.*)$/i;
const BROKER_TAG = /^(Broker\/Agent|CRE Broker|Industrial Broker|SA Broker|Office Agent|Listing Agent)$/i;
/** The kind of business, from the CRM's own tags (a trade tag such as Roofing, or "French Pl – Electrical"). */
function typeOf(tags: string[] | null | undefined): string {
  const t = tags ?? [];
  const f = t.map(x => /^French Pl\s+[–-]\s+(.+)$/.exec(x)?.[1]?.trim()).find(x => x && !GENERIC_TAG.test(x)); if (f) return f;
  if (t.some(x => BROKER_TAG.test(x))) return 'Broker / agent';
  const trade = t.find(x => !GENERIC_TAG.test(x) && !BROKER_TAG.test(x)); if (trade) return trade;
  if (t.some(x => /pad site|autobrite pad/i.test(x))) return 'Pad-site user';
  if (t.some(x => /warehouse prospect|beacon hill prospect/i.test(x))) return 'Warehouse user';
  return 'Other';
}

/** Read how Zack / Brian reached people: the Calling Log, plus the call + meeting entries on the contact card (Call Queue). */
async function loadTouches(dc: DriveContext, ids: string[]): Promise<Map<string, Touch[]>> {
  const out = new Map<string, Touch[]>(); const add = (id: string, t: Touch) => out.set(id, [...(out.get(id) ?? []), t]);
  const { data: profs } = await dc.admin.from('crm_profiles').select('id,first_name');
  const name = new Map((profs ?? []).map(p => [p.id as string, String(p.first_name ?? '').split(' ')[0]]));
  for (const part of chunk(ids, 150)) {
    const { data: calls } = await dc.admin.from('crm_call_log').select('contact_id,started_at,result,outcome,notes,handled_by,direction').in('contact_id', part).eq('direction', 'outbound').limit(5000);
    for (const l of calls ?? []) { const o = String(l.outcome || l.result || ''); add(l.contact_id as string, { at: l.started_at as string, who: name.get(l.handled_by as string) ?? '', kind: 'call', text: String(l.notes ?? '').trim(), outcome: o, reached: o === 'answered' }); }
    const { data: acts } = await dc.admin.from('crm_client_activities').select('client_id,agent_id,type,note,created_at').in('client_id', part).in('type', ['call', 'meeting']).order('created_at', { ascending: true }).limit(5000);
    for (const a of acts ?? []) {
      const raw = String(a.note ?? ''); const text = raw.replace(/^Outbound call\s*·\s*/i, '').replace(/^Call\s+—\s+/i, '').trim();
      const outcome = /voicemail|\bvm\b/i.test(raw) ? 'left_voicemail' : /no answer/i.test(raw) ? 'no_answer' : /connected|spoke|talked|reached/i.test(raw) ? 'answered' : a.type === 'meeting' ? 'meeting' : 'called';
      add(a.client_id as string, { at: a.created_at as string, who: name.get(a.agent_id as string) ?? '', kind: a.type as 'call' | 'meeting', text, outcome, reached: outcome === 'answered' || outcome === 'meeting' });
    }
  }
  // the same call can appear in both the Calling Log and the card; keep one per person per day per kind of outcome
  for (const [id, list] of out) { const seen = new Set<string>(); out.set(id, list.sort((a, b) => a.at.localeCompare(b.at)).filter(t => { const k = `${day(t.at)}|${t.outcome}|${t.who}`; if (seen.has(k)) return false; seen.add(k); return true; })); }
  return out;
}

async function emailed(dc: DriveContext): Promise<{ byClient: Map<string, { sent: number; opened: number; last: string; camps: Set<string> }>; clients: Map<string, Client> }> {
  const { data: camps } = await dc.admin.from('crm_campaigns').select('id,name').or(CAMPAIGN_LIKE.map(l => `name.ilike.${l}`).join(','));
  const live = (camps ?? []).filter(c => !/^\[(TEST|RETIRED)\]/i.test(String(c.name)));
  const nameOf = new Map(live.map(c => [c.id as string, String(c.name).replace(/\s*\(1353 W French Pl\)\s*$/, '').replace(/^Auto Brite\s+–\s+French Pl\s+—\s+/, 'Auto Brite · ').replace(/^Beacon Hill Warehouse\s+—\s+/, 'Beacon Hill · ')]));
  type Send = { client_id: string; campaign_id: string; sent_at: string | null; opened_at: string | null };
  const sends: Send[] = [];
  if (live.length) for (let from = 0; from < 20000; from += 1000) {
    const { data } = await dc.admin.from('crm_campaign_sends').select('client_id,campaign_id,sent_at,opened_at').in('campaign_id', live.map(c => c.id as string)).eq('type', 'email').in('status', ['sent', 'delivered', 'opened', 'clicked']).range(from, from + 999);
    sends.push(...((data ?? []) as Send[])); if (!data || data.length < 1000) break;
  }
  const byClient = new Map<string, { sent: number; opened: number; last: string; camps: Set<string> }>();
  for (const s of sends) { const e = byClient.get(s.client_id) ?? { sent: 0, opened: 0, last: '', camps: new Set<string>() }; e.sent++; if (s.opened_at) e.opened++; if (s.sent_at && s.sent_at > e.last) e.last = s.sent_at; e.camps.add(nameOf.get(s.campaign_id) ?? ''); byClient.set(s.client_id, e); }
  const clients = new Map<string, Client>();
  for (const part of chunk([...byClient.keys()], 100)) { const { data } = await dc.userDb.from('crm_clients').select('id,first_name,last_name,business_name,phone,cell_phone,email,unsubscribed_at,tags,notes').in('id', part); for (const c of (data ?? []) as Client[]) clients.set(c.id, c); }
  return { byClient, clients };
}

export async function buildFrenchTenants(dc: DriveContext): Promise<FeedData> {
  const { byClient, clients } = await emailed(dc);
  const touches = await loadTouches(dc, [...clients.keys()]);
  type Row = { id: string; c: Client; e: NonNullable<ReturnType<typeof byClient.get>>; t: Touch[]; last?: Touch; type: string; notInterested: boolean; unsub: boolean; reached: boolean };
  const all: Row[] = [...clients.values()].map(c => {
    const t = touches.get(c.id) ?? [], last = t[t.length - 1];
    return { id: c.id, c, e: byClient.get(c.id)!, t, last, type: typeOf(c.tags), notInterested: NOT_INTERESTED.test(t.map(x => x.text).join(' ')), unsub: !!c.unsubscribed_at || (c.tags ?? []).some(x => /dead email|hard bounce|do not call/i.test(x)), reached: t.some(x => x.reached) };
  });
  const bottom = (r: Row) => r.notInterested || r.unsub;
  const contacted = all.filter(r => r.t.length && !bottom(r)).sort((a, b) => b.last!.at.localeCompare(a.last!.at));
  const rank = (s: string) => (s === 'Other' ? 'zzz' : s === 'Broker / agent' ? 'zzy' : s.toLowerCase());
  const open = all.filter(r => !r.t.length && !bottom(r)).sort((a, b) => rank(a.type).localeCompare(rank(b.type)) || b.e.opened - a.e.opened || b.e.last.localeCompare(a.e.last));
  const bot = all.filter(bottom).sort((a, b) => Number(a.unsub && !a.notInterested) - Number(b.unsub && !b.notInterested) || (b.last?.at ?? '').localeCompare(a.last?.at ?? ''));
  const group = (r: Row) => (bottom(r) ? '3 Not interested / unsubscribed' : r.t.length ? '1 Contacted' : '2 Not yet contacted');
  const status = (r: Row) => (!r.t.length ? 'NOT CONTACTED' : r.reached ? 'Contacted - reached' : 'Contacted - no answer yet');
  const notesOf = (r: Row) => {
    const mine = r.t.filter(x => x.text).map(x => `${md(x.at)}${x.who ? ' ' + x.who : ''}: ${x.text}`);
    if (mine.length) return mine.join('  |  ');
    const crm = (r.c.notes ?? '').trim(); return crm ? `CRM note: ${crm.slice(0, 400)}` : '';
  };
  const followUp = (r: Row) => { if (!r.t.length) return ''; if (bottom(r)) return 'Skip - not interested'; const n = r.t.map(x => x.text).join(' ').toLowerCase(); if (r.reached && /@|send|more info|email|website|flyer|brochure|tour/.test(n)) return 'OWED - asked for / promised info'; return r.reached ? 'Send - reached by phone' : 'Send - voicemail / no answer'; };
  const rows = [...contacted, ...open, ...bot].map((r, i) => ({
    key: r.id,
    cells: [String(i + 1), r.c.business_name ?? '', status(r), r.last ? day(r.last.at) : '', personName(r.c), phone(r.c.phone || r.c.cell_phone), r.last ? r.last.outcome : '', notesOf(r), followUp(r), r.c.email ?? '', r.type, group(r), [...new Set(r.t.map(x => x.who).filter(Boolean))].join(', '), String(r.e.sent), String(r.e.opened), day(r.e.last), [...r.e.camps].filter(Boolean).join('; '), r.unsub ? 'YES' : ''],
  }));
  return {
    feed: 'french_pl_tenants', title: 'Emailed Businesses',
    header: ['#', 'Business', 'Status', 'Last contact', 'Contact', 'Phone', 'Last outcome', 'Notes', 'Follow-up email', 'Email', 'Type of business', 'List group', 'Reached by', 'Emails sent', 'Opened', 'Last email', 'Campaigns', 'Unsubscribed'],
    widths: [40, 240, 170, 95, 150, 120, 110, 420, 230, 220, 190, 190, 110, 80, 70, 95, 300, 100], rows, extraHeaders: ['Team notes'], layout: 2, freezeCols: 2,
  };
}

export async function buildFrenchCalls(dc: DriveContext): Promise<FeedData> {
  const { clients } = await emailed(dc);
  const touches = await loadTouches(dc, [...clients.keys()]);
  const list: Array<{ id: string; t: Touch; c: Client }> = [];
  for (const [id, ts] of touches) { const c = clients.get(id); if (c) for (const t of ts) list.push({ id, t, c }); }
  list.sort((a, b) => b.t.at.localeCompare(a.t.at));
  const rows = list.map((x, i) => ({ key: `${x.id}|${x.t.at}|${i}`, cells: [new Date(x.t.at).toLocaleString('en-CA', { timeZone: 'America/Chicago', hour12: false }).replace(',', '').slice(0, 16), x.t.who, x.c.business_name ?? '', personName(x.c), typeOf(x.c.tags), phone(x.c.phone || x.c.cell_phone), x.t.kind === 'meeting' ? 'meeting' : x.t.outcome, x.t.text] }));
  return { feed: 'french_pl_calls', title: 'Call Log', header: ['Date/Time (CT)', 'By', 'Business', 'Contact', 'Type of business', 'Phone', 'Outcome', 'Notes'], widths: [130, 80, 230, 150, 190, 120, 120, 420], rows, extraHeaders: ['Follow-up'] };
}
