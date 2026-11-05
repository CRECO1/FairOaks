import type { DriveContext } from '@/lib/drive-server';
import type { FeedData } from '@/lib/drive-sheet';

// Live feeds for "Robert's outreach emails": the one-to-one emails the team builds for Robert to send to tenants about our listings.
// Only those: an email counts when it went out from Robert's mailbox with a property flyer attached (filed on that property), or is still
// waiting in the Send-later queue. Robert's everyday email and [SAMPLE] test sends are left out.
// Two tabs: the email-by-email list (opens, replies, whether Robert has answered) and a per-property summary (open + reply rates).

const ROBERT_EMAIL = 'robert@crecotx.com';
const stamp = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Chicago', hour12: false }).replace(',', '').slice(0, 16) : '';
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const personName = (c: { first_name?: string | null; last_name?: string | null }) => [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '–');

type Client = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; phone: string | null; unsubscribed_at: string | null };
type Mail = {
  scheduled: boolean; failed: boolean; key: string; at: string; clientId: string | null; to: string; subject: string; property: string; tracked: boolean; opens: number; lastOpen: string | null;
  reply: { at: string; text: string; kind: string } | null; robertReplied: string | null; bounced: boolean; error: string; unsub: boolean;
};

const AUTO = /automatic reply|auto-?reply|out of (the )?office|autoreply|vacation/i;
const BOUNCE = /mailer-daemon|postmaster|undeliverable|delivery status notification|delivery has failed|address not found/i;
const NOT_FIT = /not (a )?fit|not interested|no thanks|no thank you|not looking|not at this time|pass\b|remove me|unsubscribe/i;
const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);
// What the person actually wrote: drop the quoted thread below ("On … wrote:", "From:", "-----Original").
const fresh = (body: string) => body.split(/\n\s*(On .{5,120}wrote:|From:|-{3,}\s*Original|>{1})/)[0] ?? body;

async function loadMail(dc: DriveContext): Promise<Mail[]> {
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

  const flyerOf = (r: Queued) => r.payload?.crmAttachments?.find(a => a.kind === 'listing_flyer')?.id ?? '';
  const listingIds = [...new Set([...sent.map(s => s.listing_id), ...queued.map(flyerOf)].filter((x): x is string => !!x))];
  const { data: ls } = listingIds.length ? await dc.admin.from('crm_listings').select('id,name,address').in('id', listingIds) : { data: [] };
  const listingName = new Map((ls ?? []).map(l => [l.id as string, String(l.address || l.name || '')]));

  const clientIds = [...new Set([...sent.map(s => s.client_id), ...queued.map(r => r.payload?.clientId)].filter((x): x is string => !!x))];
  const clients = new Map<string, Client>();
  for (const part of chunk(clientIds, 100)) {
    const { data } = await dc.userDb.from('crm_clients').select('id,first_name,last_name,business_name,email,phone,unsubscribed_at').in('id', part);
    for (const c of (data ?? []) as Client[]) clients.set(c.id, c);
  }

  // Everything else said in those Gmail threads: the contact's replies and Robert's own answers.
  type Msg = { id: string; gmail_thread_id: string; direction: string; from_email: string | null; subject: string | null; body: string | null; created_at: string; email_at: string | null };
  const threads = [...new Set(sent.map(s => s.gmail_thread_id).filter((x): x is string => !!x))];
  const msgs = new Map<string, Msg[]>();
  for (const part of chunk(threads, 100)) {
    const { data } = await dc.admin.from('crm_deal_emails').select('id,gmail_thread_id,direction,from_email,subject,body,created_at,email_at').in('gmail_thread_id', part);
    for (const m of (data ?? []) as Msg[]) msgs.set(m.gmail_thread_id, [...(msgs.get(m.gmail_thread_id) ?? []), m]);
  }
  const when = (m: Msg) => String(m.email_at ?? m.created_at);

  const out: Mail[] = []; const seen = new Set<string>();
  const keyOf = (clientId: string | null | undefined, subject: string | null | undefined, to: string | null | undefined) => `${clientId || to || ''}|${subject ?? ''}`;
  for (const s of sent) {
    const k = keyOf(s.client_id, s.subject, s.to_email); if (seen.has(k)) continue; seen.add(k);
    const c = s.client_id ? clients.get(s.client_id) : undefined;
    const at = s.email_at ?? s.created_at;
    const thread = (s.gmail_thread_id ? msgs.get(s.gmail_thread_id) : []) ?? [];
    const incoming = thread.filter(m => m.direction === 'received' && when(m) > at).sort((a, b) => when(a).localeCompare(when(b)));
    const bounce = incoming.find(m => BOUNCE.test(`${m.from_email ?? ''} ${m.subject ?? ''}`));
    const human = incoming.find(m => !BOUNCE.test(`${m.from_email ?? ''} ${m.subject ?? ''}`));
    const text = human ? clip(fresh(human.body ?? ''), 140) : '';
    const kind = human ? (AUTO.test(`${human.subject ?? ''} ${text}`) ? 'Auto-reply' : NOT_FIT.test(text) ? 'Not a fit' : 'Reply') : '';
    const answered = human ? thread.filter(m => m.direction === 'sent' && when(m) > when(human)).sort((a, b) => when(a).localeCompare(when(b)))[0] : undefined;
    out.push({ scheduled: false, failed: false, key: k, at, clientId: s.client_id, to: s.to_email ?? c?.email ?? '', subject: s.subject ?? '', property: listingName.get(s.listing_id ?? '') ?? '', tracked: !!s.tracked,
      opens: s.tracked ? Math.max(s.opened_at ? 1 : 0, s.open_count ?? 0) : 0, lastOpen: s.last_opened_at ?? s.opened_at, reply: human ? { at: when(human), text, kind } : null,
      robertReplied: answered ? when(answered) : null, bounced: !!bounce, error: '', unsub: !!c?.unsubscribed_at });
  }
  for (const r of queued) {
    const k = keyOf(r.payload?.clientId, r.summary_subject, r.summary_to); if (seen.has(k)) continue; seen.add(k);
    const c = r.payload?.clientId ? clients.get(r.payload.clientId) : undefined;
    out.push({ scheduled: true, failed: r.status === 'failed', key: k, at: r.send_at, clientId: r.payload?.clientId ?? null, to: r.summary_to ?? c?.email ?? '', subject: r.summary_subject ?? '', property: listingName.get(flyerOf(r)) ?? '',
      tracked: false, opens: 0, lastOpen: null, reply: null, robertReplied: null, bounced: false, error: (r.last_error ?? '').slice(0, 80), unsub: false });
  }
  return out.map(m => Object.assign(m, { _c: m.clientId ? clients.get(m.clientId) : undefined })) as Mail[];
}

type WithClient = Mail & { _c?: Client };

export async function buildRobertEmails(dc: DriveContext): Promise<FeedData> {
  const mail = (await loadMail(dc)) as WithClient[];
  // Order: waiting to go out (soonest first) → replies Robert still owes an answer → everything else sent, newest first.
  const owed = (m: Mail) => !!m.reply && m.reply.kind !== 'Auto-reply' && !m.robertReplied;
  const queuedRows = mail.filter(m => m.scheduled).sort((a, b) => a.at.localeCompare(b.at));
  const sentRows = mail.filter(m => !m.scheduled);
  const owedRows = sentRows.filter(owed).sort((a, b) => b.reply!.at.localeCompare(a.reply!.at));
  const rest = sentRows.filter(m => !owed(m)).sort((a, b) => b.at.localeCompare(a.at));
  const rows = [...queuedRows, ...owedRows, ...rest].map((m, i) => {
    const c = m._c;
    const status = m.scheduled ? (m.failed ? `Failed: ${m.error}` : 'Scheduled') : m.bounced ? 'Bounced' : m.unsub ? 'Unsubscribed' : 'Sent';
    const action = owed(m) ? (m.reply!.kind === 'Not a fit' ? 'Reply owed (not a fit: acknowledge)' : 'REPLY OWED') : '';
    return {
      key: m.key,
      cells: [String(i + 1), stamp(m.at), c ? personName(c) : '', c?.business_name ?? '', m.to, m.subject, m.property, status,
        m.scheduled ? '' : m.tracked ? (m.opens > 0 ? 'Yes' : 'No') : '–', m.tracked && !m.scheduled ? String(m.opens) : '', m.tracked ? stamp(m.lastOpen) : '',
        m.reply ? m.reply.kind : '', m.reply ? stamp(m.reply.at) : '', m.reply ? m.reply.text : '', m.reply && m.reply.kind !== 'Auto-reply' ? (m.robertReplied ? 'Yes' : 'No') : '', m.robertReplied ? stamp(m.robertReplied) : '', action, c?.phone ?? ''],
    };
  });
  return {
    feed: 'robert_emails', title: 'Robert’s outreach emails',
    header: ['#', 'Sent / goes out (CT)', 'Contact', 'Business', 'Email', 'Subject', 'Property', 'Status', 'Opened?', 'Opens', 'Last opened (CT)', 'Reply', 'Reply received (CT)', 'What they said', 'Robert answered?', 'Robert’s answer (CT)', 'Action', 'Phone'],
    widths: [40, 140, 150, 220, 220, 320, 160, 110, 80, 60, 140, 90, 140, 360, 110, 140, 200, 120], rows, extraHeaders: ['Team notes'], layout: 2, freezeCols: 0,
  };
}

export async function buildRobertSummary(dc: DriveContext): Promise<FeedData> {
  const mail = (await loadMail(dc)).filter(m => !m.scheduled);
  const queued = (await loadMail(dc)).filter(m => m.scheduled && !m.failed);
  const props = [...new Set([...mail, ...queued].map(m => m.property || 'Other'))].sort();
  const line = (name: string, list: Mail[], q: Mail[]) => {
    const tracked = list.filter(m => m.tracked), opened = tracked.filter(m => m.opens > 0).length;
    const real = list.filter(m => m.reply && m.reply.kind !== 'Auto-reply'), notFit = real.filter(m => m.reply!.kind === 'Not a fit').length;
    const owedN = real.filter(m => !m.robertReplied).length, answered = real.filter(m => m.robertReplied).length;
    return { key: name, cells: [name, String(list.length), String(tracked.length), String(opened), pct(opened, tracked.length), String(real.length), pct(real.length, list.length), String(notFit), String(answered), String(owedN), String(list.filter(m => m.bounced).length), String(q.length)] };
  };
  const rows = [line('All listings', mail, queued), ...props.map(p => line(p, mail.filter(m => (m.property || 'Other') === p), queued.filter(m => (m.property || 'Other') === p)))];
  return {
    feed: 'robert_summary', title: 'Open + reply rates',
    header: ['Property', 'Emails sent', 'Tracked', 'Opened', 'Open rate', 'Replies', 'Reply rate', 'Of those: not a fit', 'Robert answered', 'Answer owed', 'Bounced', 'Scheduled'],
    widths: [220, 100, 80, 80, 90, 80, 90, 130, 120, 110, 80, 100], rows, layout: 1, freezeCols: 1,
  };
}
