import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { createSkipInboxFilter } from '@/lib/gmail-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/gmail/filters { email, account? } — in the caller's OWN Gmail, make mail FROM this address skip the inbox
// (a standing Gmail filter, the same one you could make in Gmail's settings). Only ever called from an explicit,
// confirmed click on the Emails page. Mail stays in All Mail and searchable; nothing is deleted.
const EMAIL_RE = /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/;
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({})) as { email?: string; account?: string };
  const email = (b.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) return NextResponse.json({ error: 'That does not look like an email address.' }, { status: 400 });
  const boxes = await callerMailboxes(ctx.userId);
  const box = boxes.find(x => x.email && x.email === b.account) ?? boxes[0];
  if (!box) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
  if (box.email && email === box.email.toLowerCase()) return NextResponse.json({ error: 'That is your own address.' }, { status: 400 });
  const r = await createSkipInboxFilter(box.accessToken, email);
  if (r.ok) return NextResponse.json({ ok: true, existed: r.existed });
  if (r.status === 403) return NextResponse.json({ error: 'Gmail needs to be reconnected to allow filters (Settings → reconnect Google).' }, { status: 403 });
  return NextResponse.json({ error: 'Gmail did not answer — try again.' }, { status: 502 });
}
