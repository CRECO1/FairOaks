import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { listGmailDrafts, countGmailDrafts, getGmailDraft, deleteGmailDraft, hasModifyScope } from '@/lib/gmail-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// The drafts sitting in the CALLER'S OWN Gmail — never a teammate's mailbox.
//   GET /api/gmail/drafts?account=<email>            → the list (newest first)
//   GET /api/gmail/drafts?count=1                    → { count } for the tab badge
//   GET /api/gmail/drafts?id=<draftId>               → one draft with its body, to open in the CRM composer
//   DELETE /api/gmail/drafts?id=<draftId>            → discard it in Gmail (needs the same Gmail permission as archiving)
// Nothing here ever SENDS a message.
const ID = /^[\w-]{4,60}$/;
async function box(req: NextRequest, userId: string) {
  const boxes = await callerMailboxes(userId);
  if (!boxes.length) return null;
  return boxes.find(b => b.email && b.email === req.nextUrl.searchParams.get('account')) ?? boxes[0];
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await box(req, ctx.userId);
  if (!b) return NextResponse.json({ connected: false, drafts: [], count: 0 });
  const sp = req.nextUrl.searchParams;
  if (sp.get('count')) return NextResponse.json({ connected: true, count: await countGmailDrafts(b.accessToken).catch(() => 0) });
  const id = sp.get('id');
  if (id) {
    if (!ID.test(id)) return NextResponse.json({ error: 'Invalid draft' }, { status: 400 });
    const draft = await getGmailDraft(b.accessToken, id);
    return draft ? NextResponse.json({ draft }) : NextResponse.json({ error: 'That draft is gone from Gmail.' }, { status: 404 });
  }
  const [drafts, canModify] = await Promise.all([listGmailDrafts(b.accessToken).catch(() => []), hasModifyScope(b.accessToken).catch(() => false)]);
  return NextResponse.json({ connected: true, account: b.email, canModify, drafts });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await box(req, ctx.userId);
  if (!b) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!ID.test(id)) return NextResponse.json({ error: 'Invalid draft' }, { status: 400 });
  if (!(await hasModifyScope(b.accessToken).catch(() => false))) return NextResponse.json({ error: 'Allow the CRM to change your Gmail first (see the note on the Inbox).', needsScope: true }, { status: 403 });
  return (await deleteGmailDraft(b.accessToken, id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Could not discard it in Gmail — try again.' }, { status: 502 });
}
