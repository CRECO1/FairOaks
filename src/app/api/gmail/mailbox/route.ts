import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { listThreads, unreadCounts, hasModifyScope } from '@/lib/gmail-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/gmail/mailbox?box=inbox|sent&filter=all|unread|files&q=…&pageToken=…&account=<email>
// GET /api/gmail/mailbox?counts=1   → unread numbers for the sidebar badge
// A live page of the CALLER'S OWN Gmail — nothing is stored, and a teammate's mailbox is never read.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const boxes = await callerMailboxes(ctx.userId);
  if (!boxes.length) return NextResponse.json({ connected: false, accounts: [], threads: [], next: null });
  const account = sp.get('account');
  const box = boxes.find(b => b.email && b.email === account) ?? boxes[0];
  const accounts = boxes.map(b => b.email).filter(Boolean);

  if (sp.get('counts')) {
    const c = await unreadCounts(box.accessToken).catch(() => ({ inbox: 0, primary: null }));
    return NextResponse.json({ connected: true, accounts, account: box.email, unreadInbox: c.inbox, unreadPrimary: c.primary });
  }

  const kind = sp.get('box') === 'sent' ? 'sent' : 'inbox';
  const filter = sp.get('filter');
  const parts: string[] = [];
  if (kind === 'inbox' && filter === 'primary') parts.push('category:primary');
  if (filter === 'unread') parts.push('is:unread');
  if (filter === 'files') parts.push('has:attachment');
  if (filter === 'starred') parts.push('is:starred');
  const q = (sp.get('q') ?? '').replace(/[\r\n]/g, ' ').slice(0, 200).trim();
  if (q) parts.push(q);
  const pageToken = sp.get('pageToken');
  const canModify = await hasModifyScope(box.accessToken);
  const res = await listThreads(box.accessToken, { box: kind, q: parts.join(' ') || undefined, pageToken: pageToken && /^[\w-]{1,200}$/.test(pageToken) ? pageToken : undefined });
  if (!res.ok) return NextResponse.json({ error: res.status === 401 || res.status === 403 ? 'Gmail needs to be reconnected (Settings → reconnect Google).' : 'Gmail did not answer — try again.' }, { status: 502 });
  const reconnect = `/api/gmail/auth?userId=${encodeURIComponent(ctx.userId)}${box.email ? `&hint=${encodeURIComponent(box.email)}` : ''}${ctx.businessUnit ? `&bu=${encodeURIComponent(ctx.businessUnit)}` : ''}`;
  return NextResponse.json({ connected: true, accounts, account: box.email, threads: res.threads, next: res.next, canModify, reconnect });
}
