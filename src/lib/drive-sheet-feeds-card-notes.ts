import type { DriveContext } from '@/lib/drive-server';
import type { FeedData } from '@/lib/drive-sheet';

// Live feed: every note Robert logs on a contact (client) card, one row per contact, newest first. Lives as a tab in his call sheet
// (e.g. "Vacant Properties") so what he types on a card shows up beside the list he is calling from — no retyping.
// Notes that came FROM a sheet ("Team note · …", see sheet-note-mirror.ts) are left out so a note never bounces back and forth.

const ROBERT_EMAIL = 'robert@crecotx.com';
const MAX_ACTIVITIES = 5000;
const stamp = (iso: string) => new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Chicago', hour12: false }).replace(',', '').slice(0, 16);
const md = (iso: string) => { const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); return `${+d.slice(5, 7)}/${+d.slice(8, 10)}`; };
const phone = (n: string | null | undefined) => { const d = String(n ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(n ?? ''); };
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const TYPE_LABEL: Record<string, string> = { call: 'Call', email: 'Email', meeting: 'Meeting', note: '' };

type Act = { client_id: string; type: string; note: string | null; created_at: string };
type Client = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; phone: string | null; cell_phone: string | null; email: string | null };

export async function buildRobertCardNotes(dc: DriveContext): Promise<FeedData> {
  const { data: prof } = await dc.admin.from('crm_profiles').select('id').ilike('email', ROBERT_EMAIL).maybeSingle();
  const robert = (prof?.id as string) ?? '';
  const acts: Act[] = [];
  if (robert) for (let from = 0; from < MAX_ACTIVITIES; from += 1000) {
    const { data } = await dc.admin.from('crm_client_activities').select('client_id,type,note,created_at').eq('agent_id', robert)
      .not('client_id', 'is', null).not('note', 'is', null).order('created_at', { ascending: false }).range(from, from + 999);
    acts.push(...((data ?? []) as Act[])); if (!data || data.length < 1000) break;
  }
  const real = acts.filter(a => (a.note ?? '').trim() && !/^Team note · /.test(a.note ?? ''));
  const byClient = new Map<string, Act[]>();
  for (const a of real) byClient.set(a.client_id, [...(byClient.get(a.client_id) ?? []), a]);
  // Contacts are read AS THE CALLER, so a contact the viewer cannot open never shows up here.
  const clients = new Map<string, Client>();
  for (const part of chunk([...byClient.keys()], 100)) {
    const { data } = await dc.userDb.from('crm_clients').select('id,first_name,last_name,business_name,phone,cell_phone,email').in('id', part);
    for (const c of (data ?? []) as Client[]) clients.set(c.id, c);
  }
  const rows = [...byClient.entries()].filter(([id]) => clients.has(id))
    .sort((x, y) => y[1][0].created_at.localeCompare(x[1][0].created_at))
    .map(([id, list]) => {
      const c = clients.get(id)!;
      const text = list.map(a => { const t = TYPE_LABEL[a.type] ?? a.type; return `${md(a.created_at)}: ${t ? `${t} — ` : ''}${(a.note ?? '').replace(/\s+/g, ' ').trim()}`; }).join('  |  ').slice(0, 3000);
      return { key: id, cells: [stamp(list[0].created_at), [c.first_name, c.last_name].filter(Boolean).join(' ').trim(), c.business_name ?? '', phone(c.phone || c.cell_phone), c.email ?? '', String(list.length), text] };
    });
  return {
    feed: 'robert_card_notes', title: 'Card notes',
    header: ['Last note (CT)', 'Contact', 'Business', 'Phone', 'Email', 'Notes', 'What Robert logged (newest first)'],
    widths: [130, 160, 220, 120, 220, 60, 620], rows, layout: 1, freezeCols: 2,
  };
}

// ── Robert's full activity log: every move he makes, one row per action, newest first ──
// Calls (crm_call_log), emails he sent (crm_deal_emails) and everything logged on a contact card (crm_client_activities, with or
// without a note). Contacts are read as the viewer; "Team note ·" sheet-mirror entries are skipped.
type CallRow = { contact_id: string | null; started_at: string; direction: string | null; outcome: string | null; result: string | null; duration_sec: number | null; notes: string | null; to_number: string | null };
type MailRow = { client_id: string | null; to_email: string | null; subject: string | null; created_at: string; email_at: string | null };
type ActRow = { client_id: string; type: string; note: string | null; created_at: string };

export async function buildRobertActivity(dc: DriveContext): Promise<FeedData> {
  const { data: prof } = await dc.admin.from('crm_profiles').select('id').ilike('email', ROBERT_EMAIL).maybeSingle();
  const robert = (prof?.id as string) ?? '';
  const page = async <T,>(q: (from: number) => PromiseLike<{ data: unknown[] | null }>): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; from < MAX_ACTIVITIES; from += 1000) { const { data } = await q(from); out.push(...((data ?? []) as T[])); if (!data || data.length < 1000) break; }
    return out;
  };
  const calls = robert ? await page<CallRow>(f => dc.admin.from('crm_call_log').select('contact_id,started_at,direction,outcome,result,duration_sec,notes,to_number').eq('handled_by', robert).order('started_at', { ascending: false }).range(f, f + 999)) : [];
  const mails = await page<MailRow>(f => dc.admin.from('crm_deal_emails').select('client_id,to_email,subject,created_at,email_at').eq('direction', 'sent').ilike('from_email', ROBERT_EMAIL).not('subject', 'ilike', '%SAMPLE%').order('created_at', { ascending: false }).range(f, f + 999));
  const acts = robert ? await page<ActRow>(f => dc.admin.from('crm_client_activities').select('client_id,type,note,created_at').eq('agent_id', robert).not('client_id', 'is', null).order('created_at', { ascending: false }).range(f, f + 999)) : [];

  const ids = [...new Set([...calls.map(c => c.contact_id), ...mails.map(m => m.client_id), ...acts.map(a => a.client_id)].filter((x): x is string => !!x))];
  const clients = new Map<string, Client>();
  for (const part of chunk(ids, 100)) {
    const { data } = await dc.userDb.from('crm_clients').select('id,first_name,last_name,business_name,phone,cell_phone,email').in('id', part);
    for (const c of (data ?? []) as Client[]) clients.set(c.id, c);
  }
  type R = { at: string; kind: string; id: string | null; what: string; phone: string };
  const all: R[] = [
    ...calls.map(c => ({ at: c.started_at, kind: `${c.direction === 'inbound' ? 'Inbound' : 'Outbound'} call`, id: c.contact_id, what: [c.outcome || c.result, c.duration_sec != null ? `${c.duration_sec}s` : '', (c.notes ?? '').replace(/\s+/g, ' ').trim()].filter(Boolean).join(' — '), phone: phone(c.to_number) })),
    ...mails.map(m => ({ at: m.email_at || m.created_at, kind: 'Email sent', id: m.client_id, what: m.subject ?? '', phone: '' })),
    ...acts.filter(a => !/^Team note · /.test(a.note ?? '')).map(a => ({ at: a.created_at, kind: TYPE_LABEL[a.type] ? `Card: ${TYPE_LABEL[a.type]}` : 'Card note', id: a.client_id, what: (a.note ?? '').replace(/\s+/g, ' ').trim(), phone: '' })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4000);
  const rows = all.map((r, i) => {
    const c = r.id ? clients.get(r.id) : undefined;
    if (r.id && !c) return null;   // a contact the viewer cannot open
    return { key: `${r.kind}|${r.id ?? ''}|${r.at}|${i}`, cells: [stamp(r.at), r.kind, c ? [c.first_name, c.last_name].filter(Boolean).join(' ').trim() : '', c?.business_name ?? '', r.phone || phone(c?.phone || c?.cell_phone), r.what.slice(0, 1500)] };
  }).filter((x): x is { key: string; cells: string[] } => !!x);
  return {
    feed: 'robert_activity', title: 'Activity log',
    header: ['When (CT)', 'What', 'Contact', 'Business', 'Phone', 'Details'],
    widths: [130, 120, 160, 220, 120, 640], rows, layout: 1, freezeCols: 0,
  };
}
