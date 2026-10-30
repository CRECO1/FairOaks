import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { listAttachments } from '@/lib/gmail-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/gmail/files?box=inbox|sent&q=…&pageToken=…&account=<email> — the attachments in the CALLER'S OWN Gmail, one row per file.
// Nothing is stored. Opening / downloading a file goes through /api/gmail/mailbox-attachment like everywhere else.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const boxes = await callerMailboxes(ctx.userId);
  if (!boxes.length) return NextResponse.json({ connected: false, files: [], next: null });
  const account = sp.get('account');
  const box = boxes.find(b => b.email && b.email === account) ?? boxes[0];
  const q = (sp.get('q') ?? '').replace(/[\r\n]/g, ' ').slice(0, 200).trim();
  const pageToken = sp.get('pageToken');
  const res = await listAttachments(box.accessToken, { box: sp.get('box') === 'sent' ? 'sent' : 'inbox', q: q || undefined, pageToken: pageToken && /^[\w-]{1,200}$/.test(pageToken) ? pageToken : undefined });
  if (!res.ok) return NextResponse.json({ error: res.status === 401 || res.status === 403 ? 'Gmail needs to be reconnected (Settings → reconnect Google).' : 'Gmail did not answer — try again.' }, { status: 502 });
  return NextResponse.json({ connected: true, files: res.files, next: res.next });
}
