import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { extractEmailText } from '@/lib/gmail-body';
import { chicagoToday } from '@/lib/chicago-time';
import { storeGmailAttachments } from '@/lib/email-attachments';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/gmail/file-message { messageId, dealId | clientId, account? }
// "File to CRM": copies ONE message from the caller's own Gmail onto a deal's or contact's email log (with its
// attachments), so it shows in that card's thread for the whole team. Idempotent — filing it twice does nothing.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const { messageId, dealId, clientId, account } = body as { messageId?: string; dealId?: string; clientId?: string; account?: string };
  if (typeof messageId !== 'string' || !/^[0-9a-f]{8,32}$/i.test(messageId)) return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
  if ((!dealId && !clientId) || (dealId && !UUID.test(dealId)) || (clientId && !UUID.test(clientId))) return NextResponse.json({ error: 'Pick a deal or contact' }, { status: 400 });
  if (dealId && !(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
  if (clientId && !(await assertOwnsResource('crm_clients', clientId, ctx))) return notFound('Contact not found');

  const boxes = await callerMailboxes(ctx.userId);
  const box = boxes.find(b => b.email && b.email === account) ?? boxes[0];
  if (!box) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, { headers: { Authorization: `Bearer ${box.accessToken}` }, cache: 'no-store' });
  if (!res.ok) return res.status === 404 ? notFound('That message is not in this mailbox') : NextResponse.json({ error: 'Gmail did not answer — try again.' }, { status: 502 });
  const msg = await res.json();
  const h = (n: string): string => (msg.payload?.headers ?? []).find((x: { name: string }) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';

  const db = adminClient();
  const rfc = h('Message-ID') || null;
  // Already on this card? (same Gmail message, or the same RFC message another teammate filed)
  const scope = dealId ? { col: 'deal_id', val: dealId } : { col: 'client_id', val: clientId! };
  const { data: dup } = await db.from('crm_deal_emails').select('id').eq(scope.col, scope.val).or(`gmail_message_id.eq.${messageId}${rfc ? `,rfc_message_id.eq.${rfc.replace(/[,()]/g, '')}` : ''}`).limit(1);
  if (dup?.length) return NextResponse.json({ ok: true, already: true, id: dup[0].id });

  // Sent by one of the caller's mailboxes → "sent"; anyone else → "received".
  const fromAddr = (h('From').match(/<([^>]+)>/)?.[1] ?? h('From')).trim().toLowerCase();
  const mine = boxes.some(b => (b.email ?? '').toLowerCase() === fromAddr);
  // Keep what the sender wrote: cut the quoted history ("On … wrote:") like the rest of the CRM does.
  const text = extractEmailText(msg.payload).replace(/\r\n?/g, '\n');
  const cut = text.search(/\n\s*On .{5,200} wrote:\s*\n/);
  const clean = (cut > 0 ? text.slice(0, cut) : text).trim().slice(0, 4000);
  const ms = Number(msg.internalDate) || Date.now();

  const { data: row, error } = await db.from('crm_deal_emails').insert({
    gmail_message_id: messageId,
    ...(dealId ? { deal_id: dealId } : {}),
    ...(clientId ? { client_id: clientId } : {}),
    direction: mine ? 'sent' : 'received',
    from_email: h('From'), to_email: h('To'),
    ...(h('Cc').trim() ? { cc_emails: h('Cc').trim() } : {}),
    ...(h('Bcc').trim() ? { bcc_emails: h('Bcc').trim() } : {}),
    subject: h('Subject') || '(no subject)',
    body: clean,
    email_date: chicagoToday(new Date(ms)),
    email_at: new Date(ms).toISOString(),
    gmail_thread_id: msg.threadId ?? null,
    rfc_message_id: rfc,
  }).select('id').single();
  if (error || !row) { console.error('[gmail/file-message]', error?.message); return NextResponse.json({ error: 'Could not file this message.' }, { status: 500 }); }

  try { await storeGmailAttachments(row.id as string, messageId, box.accessToken, msg.payload); } catch (e) { console.error('[gmail/file-message] attachments', e); }
  return NextResponse.json({ ok: true, already: false, id: row.id });
}
