import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { fetchAttachment } from '@/lib/gmail-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/gmail/mailbox-attachment?messageId=…&part=…&account=<email> — one file from the caller's own Gmail.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const messageId = sp.get('messageId') ?? '', part = sp.get('part') ?? '';
  if (!/^[0-9a-f]{8,32}$/i.test(messageId) || !/^[\d.]{1,20}$/.test(part)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const boxes = await callerMailboxes(ctx.userId);
  const box = boxes.find(b => b.email && b.email === sp.get('account')) ?? boxes[0];
  if (!box) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
  const file = await fetchAttachment(box.accessToken, messageId, part);
  if (!file) return notFound('Attachment not found');
  const name = file.name.replace(/[\r\n"]/g, '_');
  // octet-stream + nosniff: a hostile attachment never renders as a page on our origin.
  return new NextResponse(file.bytes, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    },
  });
}
