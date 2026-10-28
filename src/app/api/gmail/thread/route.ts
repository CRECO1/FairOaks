import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { readThread } from '@/lib/gmail-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/gmail/thread?id=<gmail thread id>&account=<email> — one conversation from the caller's own Gmail, with
// the message HTML (sanitized by the browser before it is shown), plain text for quoting, and its attachments.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^[0-9a-f]{8,32}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const boxes = await callerMailboxes(ctx.userId);
  const account = req.nextUrl.searchParams.get('account');
  const box = boxes.find(b => b.email && b.email === account) ?? boxes[0];
  if (!box) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
  const res = await readThread(box.accessToken, id);
  if (!res.ok) return res.status === 404 ? notFound('That conversation is not in this mailbox') : NextResponse.json({ error: 'Gmail did not answer — try again.' }, { status: 502 });
  return NextResponse.json({ messages: res.messages });
}
