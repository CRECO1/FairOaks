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
