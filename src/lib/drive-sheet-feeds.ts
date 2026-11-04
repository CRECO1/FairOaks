import type { DriveContext } from '@/lib/drive-server';
import type { FeedData } from '@/lib/drive-sheet';

// Live CRM feeds for My Drive spreadsheets. Contacts are read AS THE CALLER (RLS decides which people they may see); the call and
// email history tables are service-only, so they are read with the service role but only for those same contacts.

export const FEEDS = {
  elkhorn_tenants: { name: 'Emailed Tenants', build: buildTenants },
  elkhorn_calls: { name: 'Call Log', build: buildCalls },
} as const;
export type FeedKey = keyof typeof FEEDS;
export const isFeed = (k: unknown): k is FeedKey => typeof k === 'string' && k in FEEDS;

const CALLER_EMAIL = 'brian@crecotx.com';                 // whose calls the Elkhorn sheet tracks
const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : '';
const stamp = (iso: string) => new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Chicago', hour12: false }).replace(',', '').slice(0, 16);
const phone = (n: string | null | undefined) => { const d = String(n ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(n ?? ''); };
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const personName = (c: { first_name?: string | null; last_name?: string | null }) => [c.first_name, c.last_name].filter(Boolean).join(' ').trim();

type Client = { notes?: string | null; id: string; first_name: string | null; last_name: string | null; business_name: string | null; phone: string | null; cell_phone: string | null; email: string | null; unsubscribed_at: string | null; tags?: string[] | null };
type Call = { contact_id: string; started_at: string; result: string | null; outcome: string | null; notes: string | null; duration_sec: number | null; to_number: string | null };


// ── grouping: which leads go together ──
// The CRM already tags every prospect with a broad business type (Dental, Restaurant/F&B…) and the area it came from; the sheet groups on those.
const CATEGORY_ORDER = ['Dental', 'Medical', 'Optometry & Vision', 'Med-Spa/Wellness', 'Wellness & Recovery', 'Fitness & Studio', 'Personal Care', 'Restaurant/F&B', 'Coffee & Bakery', 'Specialty Food & Retail', 'Veterinary & Pet', 'Kids & Enrichment', 'Daycare & Childcare', 'Other'];
const CATEGORY_FROM_DETAIL: Array<[RegExp, string]> = [
  [/dental|ortho|oral/i, 'Dental'], [/optom|optical|eyewear|ophthal/i, 'Optometry & Vision'], [/med.?spa|dermat|aesthetic|laser|botox|plastic/i, 'Med-Spa/Wellness'],
  [/physical therapy|\bPT\b|chiropract|IV therapy|cryo|recovery|stretch|contrast|hormone|longevity|wellness/i, 'Wellness & Recovery'], [/fitness|pilates|yoga|barre|studio|cycle|gym/i, 'Fitness & Studio'],
  [/beauty|salon|nail|lash|barber|grooming|blow ?dry|wax|spa\b|massage/i, 'Personal Care'], [/coffee|bakery|cafe|dessert|juice|smoothie|acai|tea\b/i, 'Coffee & Bakery'], [/F&B|restaurant|wine|bistro|grill/i, 'Restaurant/F&B'],
  [/vet|pet|animal/i, 'Veterinary & Pet'], [/tutor|enrich|kids|learning|swim|dance|cheer|gymnast|school/i, 'Kids & Enrichment'], [/daycare|child ?care|preschool/i, 'Daycare & Childcare'],
];
const AREAS = ['US-281 Corridor', 'I-10 Corridor', 'Boerne Chamber', 'Bulverde Chamber'];
function categoryOf(tags: string[] | null | undefined): string {
  const t = tags ?? [];
  const direct = CATEGORY_ORDER.find(c => c !== 'Other' && t.includes(c)); if (direct) return direct;
  for (const tag of t.filter(x => /^Elkhorn\s+[–-]\s+/.test(x))) for (const [re, cat] of CATEGORY_FROM_DETAIL) if (re.test(tag)) return cat;
  return 'Other';
}
const categoryRank = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? CATEGORY_ORDER.length : i; };
const areaOf = (tags: string[] | null | undefined) => AREAS.filter(a => (tags ?? []).includes(a)).map(a => a.replace(' Corridor', '').replace(' Chamber', '')).join(' / ');

async function callerId(dc: DriveContext): Promise<string | null> {
  const { data } = await dc.admin.from('crm_profiles').select('id').ilike('email', CALLER_EMAIL).maybeSingle();
  return (data?.id as string) ?? null;
}
async function callsFor(dc: DriveContext, agent: string, ids: string[]): Promise<Call[]> {
  const out: Call[] = [];
  for (const part of chunk(ids, 150)) {
    const { data } = await dc.admin.from('crm_call_log').select('contact_id,started_at,result,outcome,notes,duration_sec,to_number')
      .eq('handled_by', agent).eq('direction', 'outbound').in('contact_id', part).order('started_at', { ascending: true }).limit(5000);
    out.push(...((data ?? []) as Call[]));
  }
  return out;
}
async function clientsById(dc: DriveContext, ids: string[]): Promise<Map<string, Client>> {
  const m = new Map<string, Client>();
  for (const part of chunk(ids, 100)) {
    const { data } = await dc.userDb.from('crm_clients').select('id,first_name,last_name,business_name,phone,cell_phone,email,unsubscribed_at,tags,notes').in('id', part);
    for (const c of (data ?? []) as Client[]) m.set(c.id, c);
  }
  return m;
}

async function buildCalls(dc: DriveContext): Promise<FeedData> {
  const agent = await callerId(dc);
  const tagged: Client[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data } = await dc.userDb.from('crm_clients').select('id,first_name,last_name,business_name,phone,cell_phone,email,unsubscribed_at,tags').contains('tags', ['Elkhorn Point']).range(from, from + 999);
    tagged.push(...((data ?? []) as Client[])); if (!data || data.length < 1000) break;
  }
  const byId = new Map(tagged.map(c => [c.id, c]));
  const calls = agent ? await callsFor(dc, agent, [...byId.keys()]) : [];
  const rows = calls.slice().sort((a, b) => b.started_at.localeCompare(a.started_at)).map((l, i) => {
    const c = byId.get(l.contact_id)!;
    return { key: `${l.contact_id}|${l.started_at}|${i}`, cells: [stamp(l.started_at), personName(c), c.business_name ?? '', categoryOf(c.tags), phone(l.to_number ?? c.phone ?? c.cell_phone), l.outcome || l.result || '', l.duration_sec != null ? String(l.duration_sec) : '', l.notes ?? ''] };
  });
  return { feed: 'elkhorn_calls', title: 'Call Log', header: ['Date/Time (CT)', 'Contact', 'Business', 'Category', 'Phone', 'Outcome', 'Seconds', 'Notes'], widths: [130, 150, 230, 160, 120, 110, 70, 340], rows, extraHeaders: ['Follow-up'], prevCols: 7 };
}

async function buildTenants(dc: DriveContext): Promise<FeedData> {
  const agent = await callerId(dc);
  const { data: camps } = await dc.admin.from('crm_campaigns').select('id,name').ilike('name', 'Elkhorn Point%');
  const live = (camps ?? []).filter(c => !/^\[RETIRED\]/i.test(String(c.name)));
  const nameOf = new Map(live.map(c => [c.id as string, String(c.name).replace(/^Elkhorn Point\s+—\s+/, '')]));
  type Send = { client_id: string; campaign_id: string; status: string; sent_at: string | null; opened_at: string | null };
  const sends: Send[] = [];
  if (live.length) for (let from = 0; from < 20000; from += 1000) {
    const { data } = await dc.admin.from('crm_campaign_sends').select('client_id,campaign_id,status,sent_at,opened_at').in('campaign_id', live.map(c => c.id as string)).eq('type', 'email').in('status', ['sent', 'delivered', 'opened', 'clicked']).range(from, from + 999);
    sends.push(...((data ?? []) as Send[])); if (!data || data.length < 1000) break;
  }
  const byClient = new Map<string, { sent: number; opened: number; last: string; camps: Set<string> }>();
  for (const s of sends) {
    const e = byClient.get(s.client_id) ?? { sent: 0, opened: 0, last: '', camps: new Set<string>() };
    e.sent++; if (s.opened_at) e.opened++; if (s.sent_at && s.sent_at > e.last) e.last = s.sent_at; e.camps.add(nameOf.get(s.campaign_id) ?? ''); byClient.set(s.client_id, e);
  }
  const clients = await clientsById(dc, [...byClient.keys()]);
  const calls = agent ? await callsFor(dc, agent, [...clients.keys()]) : [];
  const callsBy = new Map<string, Call[]>();
  for (const l of calls) callsBy.set(l.contact_id, [...(callsBy.get(l.contact_id) ?? []), l]);

  type Row = { cat: string; area: string; id: string; c: Client; e: NonNullable<ReturnType<typeof byClient.get>>; calls: Call[]; last?: Call; notInterested: boolean; unsub: boolean; talked: boolean };
  const all: Row[] = [...clients.values()].map(c => {
    const cl = callsBy.get(c.id) ?? [], last = cl[cl.length - 1];
    const notes = cl.map(x => x.notes ?? '').join(' ');
    return { cat: categoryOf(c.tags), area: areaOf(c.tags), id: c.id, c, e: byClient.get(c.id)!, calls: cl, last, notInterested: /not interested|wouldn.?t be interested|signed a \d|just signed/i.test(notes), unsub: !!c.unsubscribed_at, talked: cl.some(x => (x.outcome || x.result) === 'answered') };
  });
  const bottom = (r: Row) => r.notInterested || r.unsub;
  const called = all.filter(r => r.calls.length && !bottom(r)).sort((a, b) => b.last!.started_at.localeCompare(a.last!.started_at));
  const uncalled = all.filter(r => !r.calls.length && !bottom(r)).sort((a, b) => b.e.opened - a.e.opened || b.e.last.localeCompare(a.e.last));
  const bot = all.filter(bottom).sort((a, b) => Number(a.unsub && !a.notInterested) - Number(b.unsub && !b.notInterested) || (b.last?.started_at ?? '').localeCompare(a.last?.started_at ?? ''));
  // Contacted leads stay in order of who was reached most recently. The ones not yet called are grouped by business type (leads that go
  // together sit together), most-engaged first inside each type. Not-interested / unsubscribed go last.
  uncalled.sort((a, b) => categoryRank(a.cat) - categoryRank(b.cat) || b.e.opened - a.e.opened || b.e.last.localeCompare(a.e.last));
  const group = (r: Row) => (bottom(r) ? '3 Not interested / unsubscribed' : r.calls.length ? '1 Recently contacted' : '2 Not yet called');
  const md = (iso: string) => { const d = day(iso); return d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : ''; };
  const notesOf = (r: Row) => {
    const mine = r.calls.filter(x => (x.notes ?? '').trim()).map(x => `${md(x.started_at)}: ${(x.notes ?? '').trim()}`);
    if (mine.length) return mine.join('  |  ');
    const crm = (r.c.notes ?? '').trim();
    return crm ? `CRM note: ${crm.slice(0, 400)}` : '';
  };
  const status = (r: Row) => !r.calls.length ? 'NOT CALLED' : r.talked ? 'Called - reached' : 'Called - no contact yet';
  const followUp = (r: Row) => {
    if (!r.calls.length) return '';
    const n = (r.last?.notes ?? '').toLowerCase(), out = r.last?.outcome || r.last?.result;
    if (bottom(r)) return 'Skip - said not interested';
    if (out === 'answered' && /@|send|more info|email|website|elkhorn point/.test(n)) return 'OWED - asked for / promised info';
    return out === 'answered' ? 'Send - reached by phone' : 'Send - voicemail / no answer';
  };
  const rows = [...called, ...uncalled, ...bot].map((r, i) => ({
    key: r.id,
    cells: [String(i + 1), r.c.business_name ?? '', status(r), r.last ? day(r.last.started_at) : '', personName(r.c), phone(r.c.phone || r.c.cell_phone), r.last ? (r.last.outcome || r.last.result || '') : '', notesOf(r), followUp(r), r.c.email ?? '', r.cat, r.area, group(r), String(r.calls.length || ''), String(r.e.sent), String(r.e.opened), day(r.e.last), [...r.e.camps].filter(Boolean).join('; '), r.unsub ? 'YES' : ''],
  }));
  return {
    feed: 'elkhorn_tenants', title: 'Emailed Tenants',
    header: ['#', 'Business', 'Call status', 'Last call', 'Contact', 'Phone', 'Last outcome', 'Notes', 'Follow-up email', 'Email', 'Category', 'Area', 'List group', 'Brian calls', 'Emails sent', 'Opened', 'Last email', 'Campaigns', 'Unsubscribed'],
    widths: [40, 240, 150, 95, 150, 120, 110, 420, 230, 220, 170, 130, 190, 90, 80, 70, 95, 260, 100], rows, extraHeaders: ['Team notes'], prevCols: 17, layout: 2, freezeCols: 2,
  };
}
