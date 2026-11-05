import type { DriveContext } from '@/lib/drive-server';
import type { FeedData } from '@/lib/drive-sheet';

// Live feed for "Robert's outreach emails": the one-to-one emails the team builds for Robert to send to tenants who opened our campaigns.
// Only those: an email counts when it went out from Robert's mailbox with a property flyer attached (filed on that property), or is still
// waiting in the Send-later queue. Robert's everyday email and [SAMPLE] test sends are left out.

const ROBERT_EMAIL = 'robert@crecotx.com';
const stamp = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Chicago', hour12: false }).replace(',', '').slice(0, 16) : '';
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const personName = (c: { first_name?: string | null; last_name?: string | null }) => [c.first_name, c.last_name].filter(Boolean).join(' ').trim();

type Client = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; phone: string | null; unsubscribed_at: string | null };
type Row = { sortAt: string; scheduled: boolean; key: string; cells: string[] };

export async function buildRobertEmails(dc: DriveContext): Promise<FeedData> {
  const { data: prof } = await dc.admin.from('crm_profiles').select('id').ilike('email', ROBERT_EMAIL).maybeSingle();
  const robert = (prof?.id as string) ?? '';

  type Sent = { id: string; client_id: string | null; to_email: string | null; subject: string | null; created_at: string; email_at: string | null; opened_at: string | null; last_opened_at: string | null; open_count: number | null; listing_id: string | null; gmail_thread_id: string | null; tracked: boolean | null };
  const sent: Sent[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data } = await dc.admin.from('crm_deal_emails')
      .select('id,client_id,to_email,subject,created_at,email_at,opened_at,last_opened_at,open_count,listing_id,gmail_thread_id,tracked')
      .eq('direction', 'sent').ilike('from_email', ROBERT_EMAIL).not('listing_id', 'is', null).not('subject', 'ilike', '%SAMPLE%')
      .order('created_at', { ascending: false }).range(from, from + 999);
    sent.push(...((data ?? []) as Sent[])); if (!data || data.length < 1000) break;
  }

  type Queued = { id: string; status: string; send_at: string; summary_subject: string | null; summary_to: string | null; last_error: string | null; payload: { clientId?: string; crmAttachments?: Array<{ kind?: string; id?: string }> } | null };
  const { data: q } = robert ? await dc.admin.from('crm_scheduled_emails').select('id,status,send_at,summary_subject,summary_to,last_error,payload')
    .eq('user_id', robert).in('status', ['pending', 'sending', 'failed']).order('send_at', { ascending: true }).limit(500) : { data: [] };
  const queued = ((q ?? []) as Queued[]).filter(r => (r.payload?.crmAttachments ?? []).some(a => a.kind === 'listing_flyer') && !/SAMPLE/i.test(r.summary_subject ?? ''));

  const listingIds = [...new Set([...sent.map(s => s.listing_id), ...queued.map(r => r.payload?.crmAttachments?.find(a => a.kind === 'listing_flyer')?.id)].filter((x): x is string => !!x))];
  const { data: ls } = listingIds.length ? await dc.admin.from('crm_listings').select('id,name,address').in('id', listingIds) : { data: [] };
  const listingName = new Map((ls ?? []).map(l => [l.id as string, String(l.address || l.name || '')]));

  const clientIds = [...new Set([...sent.map(s => s.client_id), ...queued.map(r => r.payload?.clientId)].filter((x): x is string => !!x))];
  const clients = new Map<string, Client>();
  for (const part of chunk(clientIds, 100)) {
    const { data } = await dc.userDb.from('crm_clients').select('id,first_name,last_name,business_name,email,phone,unsubscribed_at').in('id', part);
    for (const c of (data ?? []) as Client[]) clients.set(c.id, c);
  }

  // Replies: a received message in the same Gmail thread from the same contact.
  const threads = [...new Set(sent.map(s => s.gmail_thread_id).filter((x): x is string => !!x))];
  const replied = new Map<string, string>();
  for (const part of chunk(threads, 150)) {
    const { data } = await dc.admin.from('crm_deal_emails').select('gmail_thread_id,created_at,email_at').eq('direction', 'received').in('gmail_thread_id', part);
    for (const r of data ?? []) { const t = String(r.email_at ?? r.created_at); const k = r.gmail_thread_id as string; if (!replied.has(k) || t < (replied.get(k) as string)) replied.set(k, t); }
  }

  const rows: Row[] = [];
  const keyOf = (clientId: string | null | undefined, subject: string | null | undefined, to: string | null | undefined) => `${clientId || to || ''}|${subject ?? ''}`;
  const seen = new Set<string>();
  for (const s of sent) {
    const k = keyOf(s.client_id, s.subject, s.to_email); if (seen.has(k)) continue; seen.add(k);
    const c = s.client_id ? clients.get(s.client_id) : undefined;
    const at = s.email_at ?? s.created_at, rep = s.gmail_thread_id ? replied.get(s.gmail_thread_id) : undefined;
    const opens = s.tracked ? Math.max(s.opened_at ? 1 : 0, s.open_count ?? 0) : 0;
    rows.push({ sortAt: at, scheduled: false, key: k, cells: ['', stamp(at), c ? personName(c) : '', c?.business_name ?? '', s.to_email ?? c?.email ?? '', s.subject ?? '', listingName.get(s.listing_id ?? '') ?? '', rep ? 'Replied' : c?.unsubscribed_at ? 'Unsubscribed' : 'Sent',
      s.tracked ? String(opens) : '–', s.tracked ? stamp(s.last_opened_at ?? s.opened_at) : '', rep ? stamp(rep) : '', c?.phone ?? ''] });
  }
  for (const r of queued) {
    const k = keyOf(r.payload?.clientId, r.summary_subject, r.summary_to); if (seen.has(k)) continue; seen.add(k);
    const c = r.payload?.clientId ? clients.get(r.payload.clientId) : undefined;
    const fl = r.payload?.crmAttachments?.find(a => a.kind === 'listing_flyer')?.id ?? '';
    rows.push({ sortAt: r.send_at, scheduled: true, key: k, cells: ['', stamp(r.send_at), c ? personName(c) : '', c?.business_name ?? '', r.summary_to ?? c?.email ?? '', r.summary_subject ?? '', listingName.get(fl) ?? '',
      r.status === 'failed' ? `Failed: ${(r.last_error ?? '').slice(0, 80)}` : 'Scheduled', '', '', '', c?.phone ?? ''] });
  }
  // Waiting to go out first (soonest on top), then everything already sent, newest first.
  const queuedRows = rows.filter(r => r.scheduled).sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  const sentRows = rows.filter(r => !r.scheduled).sort((a, b) => b.sortAt.localeCompare(a.sortAt));
  const all = [...queuedRows, ...sentRows].map((r, i) => ({ key: r.key, cells: [String(i + 1), ...r.cells.slice(1)] }));
  return {
    feed: 'robert_emails', title: 'Robert’s outreach emails',
    header: ['#', 'Sent / goes out (CT)', 'Contact', 'Business', 'Email', 'Subject', 'Property', 'Status', 'Opens', 'Last opened (CT)', 'Replied (CT)', 'Phone'],
    widths: [40, 140, 150, 230, 230, 330, 170, 130, 70, 140, 140, 120], rows: all, extraHeaders: ['Team notes'], layout: 1, freezeCols: 0,
  };
}
