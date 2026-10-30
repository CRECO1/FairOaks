import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, assertOwnsResource } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { validAssignee } from '@/lib/crm-assignee';
import { pushBellNotification, senderName } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// POST /api/crm/email-share { recipientId, subject, contactId? | dealId? } — tell a teammate "I shared this email with you".
// The conversation itself is filed on the contact/deal card first (by the page, via /api/gmail/file-message), which is what lets the
// teammate read it; this just puts a bell notification (and a phone alert, if they have those on) in front of them.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({})) as { recipientId?: string; subject?: string; contactId?: string; dealId?: string };
  const recipientId = String(b.recipientId ?? '');
  if (!recipientId || recipientId === ctx.userId) return NextResponse.json({ error: 'Pick a teammate.' }, { status: 400 });
  if (!(await validAssignee(recipientId, ctx))) return NextResponse.json({ error: 'You can only share with someone in your workspace.' }, { status: 400 });
  const dealId = b.dealId ? String(b.dealId) : null, contactId = b.contactId ? String(b.contactId) : null;
  if (!dealId && !contactId) return NextResponse.json({ error: 'Share needs a deal or contact card to file the email on.' }, { status: 400 });
  if (dealId && !(await assertOwnsResource('crm_deals', dealId, ctx))) return NextResponse.json({ error: 'Invalid deal' }, { status: 400 });
  if (!dealId && contactId && !(await assertOwnsResource('crm_clients', contactId, ctx))) return NextResponse.json({ error: 'Invalid contact' }, { status: 400 });
  const db = adminClient();
  const from = await senderName(db, ctx.userId);
  const message = `${from} shared an email with you: ${String(b.subject ?? '(no subject)').slice(0, 120)}`;
  const entity_type = dealId ? 'deal' : 'contact', entity_id = dealId ?? contactId;
  const { error } = await db.from('crm_notifications').insert({ recipient_id: recipientId, sender_id: ctx.userId, type: 'mention', message, entity_type, entity_id });
  if (error) { console.error('[email-share]', error.message); return NextResponse.json({ error: 'Could not notify them — try again.' }, { status: 500 }); }
  await pushBellNotification(db, { recipientId, type: 'mention', message, entityType: entity_type, tag: `share-${entity_id}` });
  return NextResponse.json({ ok: true });
}
