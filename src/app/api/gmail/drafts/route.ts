import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { listGmailDrafts } from '@/lib/gmail-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/gmail/drafts?account=<email> → the drafts sitting in the CALLER'S OWN Gmail (newest first). Read-only: nothing is sent,
// changed or stored, and a teammate's mailbox is never read.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const boxes = await callerMailboxes(ctx.userId);
  if (!boxes.length) return NextResponse.json({ connected: false, drafts: [] });
  const box = boxes.find(b => b.email && b.email === req.nextUrl.searchParams.get('account')) ?? boxes[0];
  const drafts = await listGmailDrafts(box.accessToken).catch(() => []);
  return NextResponse.json({ connected: true, account: box.email, drafts });
}
