import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { modifyThread, THREAD_ACTIONS, type ThreadAction } from '@/lib/gmail-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/gmail/modify { id, action, account? } — mark read/unread, archive, star or trash ONE conversation in the
// caller's OWN Gmail (never a teammate's). Needs the gmail.modify permission; without it Gmail answers 403 and we say so
// (needsScope) so the page can offer the one-time "allow" step. Trash is recoverable in Gmail for 30 days.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({})) as { id?: string; action?: string; account?: string };
  const id = body.id ?? '';
  if (!/^[0-9a-f]{8,32}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!(THREAD_ACTIONS as readonly string[]).includes(body.action ?? '')) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  const boxes = await callerMailboxes(ctx.userId);
  const box = boxes.find(b => b.email && b.email === body.account) ?? boxes[0];
  if (!box) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
  const r = await modifyThread(box.accessToken, id, body.action as ThreadAction);
  if (r.ok) return NextResponse.json({ ok: true });
  if (r.status === 403) return NextResponse.json({ error: 'Allow the CRM to change your Gmail first.', needsScope: true }, { status: 403 });
  if (r.status === 404) return NextResponse.json({ error: 'That conversation is no longer in this mailbox.' }, { status: 404 });
  return NextResponse.json({ error: 'Gmail did not answer — try again.' }, { status: 502 });
}
