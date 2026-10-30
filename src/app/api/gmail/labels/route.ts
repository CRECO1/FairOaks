import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { createLabel } from '@/lib/gmail-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/gmail/labels { name, account? } — create a label in the caller's OWN Gmail (needs gmail.modify).
// Listing labels rides along with /api/gmail/mailbox; applying one goes through /api/gmail/modify (label:<id>).
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({})) as { name?: string; account?: string };
  const name = (body.name ?? '').replace(/[\r\n]/g, ' ').trim().replace(/^\/+|\/+$/g, '');
  if (!name || name.length > 60) return NextResponse.json({ error: 'Give the label a name (60 characters or fewer).' }, { status: 400 });
  const boxes = await callerMailboxes(ctx.userId);
  const box = boxes.find(b => b.email && b.email === body.account) ?? boxes[0];
  if (!box) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
  const r = await createLabel(box.accessToken, name);
  if (r.ok) return NextResponse.json({ label: r.label });
  if (r.status === 403) return NextResponse.json({ error: 'Allow the CRM to change your Gmail first.', needsScope: true }, { status: 403 });
  if (r.status === 409) return NextResponse.json({ error: 'You already have a label with that name.' }, { status: 409 });
  return NextResponse.json({ error: 'Gmail did not answer — try again.' }, { status: 502 });
}
