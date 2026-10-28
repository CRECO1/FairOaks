/**
 * GET /api/cron/gmail-replies — every 10 minutes, pull replies from known contacts into the CRM.
 *
 * Until now an inbound email only reached a contact's card when somebody pressed Sync on it, so an agent who
 * emailed from the CRM never learned the answer had arrived. This reads each connected Gmail inbox for the last
 * few hours, keeps ONLY messages whose sender is a CRM contact, files them in crm_deal_emails (same shape the
 * manual Sync writes, so the threads line up), tells the agent in the bell, and settles any "remind me if no
 * reply" follow-up task. It never sends anything and never stores mail from people who aren't contacts —
 * except someone Cc'd/Bcc'd who answers INSIDE a conversation already on a contact's or deal's card (same Gmail
 * thread), which is filed with it so the whole team sees it and can reply all.
 */
import { NextRequest, NextResponse } from 'next/server';
import { extractEmailText } from '@/lib/gmail-body';
import { adminClient } from '@/lib/supabase-admin';
import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { chicagoToday } from '@/lib/chicago-time';
import { storeGmailAttachments } from '@/lib/email-attachments';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_HOURS = 3; // 18 runs of overlap: a missed run or two costs nothing (inserts are de-duplicated)
const MAX_MESSAGES = 100;

type Conn = { id: string; user_id: string; gmail_email: string | null; access_token: string; refresh_token: string; expires_at: string };
type ContactRow = { id: string; first_name: string | null; last_name: string | null; email: string | null; extra_emails: string[] | null; agent_id: string | null };

async function getValidToken(db: ReturnType<typeof adminClient>, conn: Conn): Promise<string | null> {
  if (Date.now() < new Date(conn.expires_at).getTime() - 120_000) return decryptToken(conn.access_token);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: decryptToken(conn.refresh_token), grant_type: 'refresh_token' }),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) return null;
  await db.from('gmail_connections').update({ access_token: encryptToken(data.access_token), expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('id', conn.id);
  return data.access_token;
}

const extractBody = extractEmailText;

// Same trimming the manual Sync applies: drop quoted history, "On … wrote:" tails, and disclaimers.
function cleanBody(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.startsWith('>')) continue;
    if (/^On .{5,120} wrote:$/.test(t)) break;
    if (/^[-_]{3,}/.test(t)) break;
    if (/^CONFIDENTIALITY NOTICE/i.test(t)) break;
    if (/^This (e-?mail|message) (message |communication )?(is intended|may contain)/i.test(t)) break;
    if (/^(Thanks,?|Thank you,?|Best,?|Regards,?|Sincerely,?|Cheers,?)$/i.test(t)) { out.push(line); break; }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}


// Emails logged before 2026-10-28 had their line breaks flattened (and "&nbsp;" left in): re-read each from the mailbox
// it lives in and store it properly. Only this connection's own mail, a few per run, and a row stops matching once fixed.
async function healBodies(db: ReturnType<typeof adminClient>, mailbox: string, auth: Record<string, string>, all = false): Promise<number> {
  const addr = mailbox.trim().toLowerCase();
  if (!addr) return 0;
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db.from('crm_deal_emails').select('id, gmail_message_id, body')
    .not('gmail_message_id', 'is', null).gte('email_date', since)
    .or(`from_email.ilike.%${addr}%,to_email.ilike.%${addr}%`)
    .order('created_at', { ascending: false }).limit(300);
  const bad = (data ?? []).filter((r: { body: string | null }) => { const b = r.body ?? ''; return all || /&(nbsp|amp|lt|gt|quot|#\d+);/i.test(b) || (b.length > 140 && !b.includes('\n')); }).slice(0, all ? 120 : 25);
  let healed = 0;
  for (const r of bad as Array<{ id: string; gmail_message_id: string; body: string | null }>) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${r.gmail_message_id}?format=full`, { headers: auth });
    if (!res.ok) continue; // not in this mailbox
    const text = extractEmailText((await res.json()).payload).slice(0, 4000);
    if (text && text !== r.body) { await db.from('crm_deal_emails').update({ body: text }).eq('id', r.id); healed++; }
  }
  return healed;
}

// Emails logged before attachments were kept (attachments IS NULL): look at the message once, copy any files into
// storage, and mark it checked ([]), a few per run per mailbox. ?attachments=all raises the batch for a catch-up.
async function backfillAttachments(db: ReturnType<typeof adminClient>, mailbox: string, token: string, all = false): Promise<number> {
  const addr = mailbox.trim().toLowerCase().replace(/[%,()]/g, '');
  if (!addr) return 0;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db.from('crm_deal_emails').select('id, gmail_message_id, from_email')
    .not('gmail_message_id', 'is', null).is('attachments', null).gte('email_date', since)
    .or(`from_email.ilike.%${addr}%,to_email.ilike.%${addr}%,cc_emails.ilike.%${addr}%`)
    .order('created_at', { ascending: false }).limit(all ? 60 : 12);
  let done = 0;
  for (const r of (data ?? []) as Array<{ id: string; gmail_message_id: string; from_email: string }>) {
    const got = await storeGmailAttachments(r.id, r.gmail_message_id, token);
    if (got) done++;
    // The sender's own copy is always in their mailbox: if it's gone (deleted), stop re-checking it every run.
    else if (r.from_email.toLowerCase().includes(addr)) await db.from('crm_deal_emails').update({ attachments: [] }).eq('id', r.id);
  }
  return done;
}

const addrOf = (h: string) => (h.match(/<([^>]+)>/)?.[1] ?? h).trim().toLowerCase();
const hdr = (msg: any, name: string): string => (msg?.payload?.headers ?? []).find((h: { name: string }) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = adminClient();
  // ?hours=N (max 168) widens the window for a catch-up after an outage; the scheduled run uses the default.
  const hours = Math.min(168, Math.max(1, Math.floor(Number(req.nextUrl.searchParams.get('hours'))) || DEFAULT_HOURS));
  const LOOKBACK = `newer_than:${hours}h`;

  const { data: conns } = await db.from('gmail_connections').select('id, user_id, gmail_email, access_token, refresh_token, expires_at');
  if (!conns?.length) return NextResponse.json({ ok: true, connections: 0, filed: 0 });

  // Every contact address (primary + extras) → contact. Paged: the list is in the thousands.
  const byEmail = new Map<string, ContactRow>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('crm_clients').select('id, first_name, last_name, email, extra_emails, agent_id').range(from, from + 999);
    for (const c of (data ?? []) as ContactRow[]) {
      for (const e of [c.email, ...(c.extra_emails ?? [])]) { const k = (e ?? '').trim().toLowerCase(); if (k && !byEmail.has(k)) byEmail.set(k, c); }
    }
    if (!data || data.length < 1000) break;
  }
  // The team's own addresses are never "a contact replying".
  const { data: team } = await db.from('crm_profiles').select('email');
  const own = new Set<string>([...(team ?? []).map((p: { email: string | null }) => (p.email ?? '').toLowerCase()), ...conns.map(c => (c.gmail_email ?? '').toLowerCase())].filter(Boolean));

  let filed = 0, scanned = 0, tokenFailures = 0, healed = 0, attachmentsChecked = 0;
  const errors: string[] = [];

  for (const conn of conns as Conn[]) {
    const token = await getValidToken(db, conn);
    if (!token) { tokenFailures++; errors.push(`token refresh failed for ${conn.gmail_email}`); continue; }
    const auth = { Authorization: `Bearer ${token}` };
    try { healed += await healBodies(db, conn.gmail_email ?? '', auth, req.nextUrl.searchParams.get('heal') === 'all'); } catch (e) { errors.push(`heal ${conn.gmail_email}: ${e instanceof Error ? e.message : String(e)}`); }
    try { attachmentsChecked += await backfillAttachments(db, conn.gmail_email ?? '', token, req.nextUrl.searchParams.get('attachments') === 'all'); } catch (e) { errors.push(`attachments ${conn.gmail_email}: ${e instanceof Error ? e.message : String(e)}`); }
    try {
      const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(`in:inbox ${LOOKBACK}`)}&maxResults=${MAX_MESSAGES}`, { headers: auth });
      if (!list.ok) { errors.push(`list ${conn.gmail_email}: ${list.status}`); continue; }
      const ids: string[] = ((await list.json()).messages ?? []).map((m: { id: string }) => m.id);
      if (!ids.length) continue;

      const { data: have } = await db.from('crm_deal_emails').select('gmail_message_id').in('gmail_message_id', ids);
      const haveSet = new Set((have ?? []).map((r: { gmail_message_id: string | null }) => r.gmail_message_id));

      for (const id of ids.filter(i => !haveSet.has(i))) {
        scanned++;
        const metaRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID`, { headers: auth });
        if (!metaRes.ok) continue;
        const meta = await metaRes.json();
        const sender = addrOf(hdr(meta, 'From'));
        if (own.has(sender)) continue;
        let contact: ContactRow | undefined = byEmail.get(sender);
        let threadDealId: string | null = null;
        let viaThread = false;
        if (!contact && meta.threadId) {
          // Not a contact — but if it is part of a conversation already on a card (someone who was Cc'd or Bcc'd
          // answering), it belongs to that card.
          const { data: sib } = await db.from('crm_deal_emails').select('client_id, deal_id').eq('gmail_thread_id', meta.threadId).limit(1);
          const sr = sib?.[0] as { client_id: string | null; deal_id: string | null } | undefined;
          if (sr) {
            let cid = sr.client_id;
            threadDealId = sr.deal_id;
            if (!cid && sr.deal_id) cid = ((await db.from('crm_deals').select('client_id').eq('id', sr.deal_id).maybeSingle()).data?.client_id as string | null) ?? null;
            if (cid) {
              const { data: c } = await db.from('crm_clients').select('id, first_name, last_name, email, extra_emails, agent_id').eq('id', cid).maybeSingle();
              if (c) { contact = c as ContactRow; viaThread = true; }
            }
          }
        }
        if (!contact) continue;
        const rfc = hdr(meta, 'Message-ID') || null;
        if (rfc) { // the other mailbox may have filed this exact message already
          const { data: dup } = await db.from('crm_deal_emails').select('id').eq('rfc_message_id', rfc).limit(1);
          if (dup?.length) continue;
        }

        const fullRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: auth });
        if (!fullRes.ok) continue;
        const msg = await fullRes.json();
        const subject = hdr(msg, 'Subject') || '(no subject)';
        const dateStr = hdr(msg, 'Date');
        const threadId: string | null = msg.threadId ?? null;
        // Keep a reply on the same deal as the rest of its thread.
        let dealId: string | null = threadDealId;
        if (threadId && !dealId) {
          const { data: sib } = await db.from('crm_deal_emails').select('deal_id').eq('gmail_thread_id', threadId).not('deal_id', 'is', null).limit(1);
          dealId = (sib?.[0]?.deal_id as string | undefined) ?? null;
        }
        const { data: insRow, error: insErr } = await db.from('crm_deal_emails').insert({
          gmail_message_id: id,
          client_id: contact.id,
          ...(dealId ? { deal_id: dealId } : {}),
          direction: 'received',
          from_email: hdr(msg, 'From'),
          to_email: hdr(msg, 'To'),
          ...(hdr(msg, 'Cc').trim() ? { cc_emails: hdr(msg, 'Cc').trim() } : {}),
          subject,
          body: cleanBody(extractBody(msg.payload)).slice(0, 4000),
          email_date: chicagoToday(dateStr ? new Date(dateStr) : new Date()),
          gmail_thread_id: threadId,
          rfc_message_id: rfc,
        }).select('id').single();
        if (insErr) { errors.push(`insert ${id}: ${insErr.message}`); continue; }
        filed++;
        if (insRow?.id) { try { await storeGmailAttachments(insRow.id as string, id, token, msg.payload); } catch (e) { errors.push(`attachments ${id}: ${e instanceof Error ? e.message : String(e)}`); } }

        // Tell the agent whose inbox it landed in (and the contact's owner, if that is someone else).
        const contactName = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || sender;
        const fromName = hdr(msg, 'From').replace(/<.*$/, '').replace(/"/g, '').trim() || sender;
        const name = viaThread ? `${fromName} (on ${contactName}'s thread)` : contactName;
        const recipients = new Set<string>([conn.user_id]);
        if (contact.agent_id) recipients.add(contact.agent_id);
        await db.from('crm_notifications').insert([...recipients].map(rid => ({
          recipient_id: rid, sender_id: null, type: 'email_reply',
          message: `✉ ${name} replied: ${subject.slice(0, 90)}`, entity_type: 'contact', entity_id: contact.id,
        })));

        // They answered: settle the "remind me if no reply" tasks created before this message.
        if (!viaThread) {
        const sentMs = Number(msg.internalDate) || Date.now();
        await db.from('crm_tasks').update({ completed_at: new Date().toISOString() })
          .eq('client_id', contact.id).is('completed_at', null).like('notes', 'Email follow-up%').lt('created_at', new Date(sentMs).toISOString());
        }
      }
    } catch (e) {
      errors.push(`${conn.gmail_email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length) console.error('[cron/gmail-replies]', errors.join(' | '));
  // A run where every inbox failed to authorise must show up as a failure in Vercel, not a quiet 200.
  const status = tokenFailures === conns.length ? 500 : 200;
  return NextResponse.json({ ok: status === 200, connections: conns.length, scanned, filed, healed, attachmentsChecked, errors: errors.slice(0, 5) }, { status });
}
