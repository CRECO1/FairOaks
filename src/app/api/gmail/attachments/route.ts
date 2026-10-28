import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { callerMailboxes } from '@/lib/gmail-mailbox';

// Attachments on a logged email (a tenant's signed LOI, a flyer…): list them, or download one.
//   GET ?emailId=<crm_deal_emails.id>             → { attachments: [{ part, name, size, mime }] }
//   GET ?emailId=…&part=<partId>                  → the file's bytes
// Read straight from Gmail on demand — nothing is stored. Only the CALLER'S OWN mailbox is used (same rule as the
// sync route), so an attachment on mail that lives in a teammate's mailbox comes back empty rather than leaking it.

type Part = { partId?: string; filename?: string; mimeType?: string; headers?: { name: string; value: string }[]; body?: { attachmentId?: string; size?: number }; parts?: Part[] };

function collect(part: Part | undefined, out: Part[]) {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) {
    const h = (n: string) => part.headers?.find(x => x.name.toLowerCase() === n)?.value ?? '';
    const inlineImage = /^inline/i.test(h('content-disposition')) && h('content-id') && /^image\//i.test(part.mimeType ?? '');
    if (!inlineImage) out.push(part); // signature logos and embedded pictures are not "attachments"
  }
  for (const p of part.parts ?? []) collect(p, out);
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const emailId = req.nextUrl.searchParams.get('emailId') ?? '';
  const partId = req.nextUrl.searchParams.get('part');
  if (!/^[0-9a-f-]{36}$/i.test(emailId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const { data: row } = await adminClient().from('crm_deal_emails').select('id, deal_id, client_id, gmail_message_id').eq('id', emailId).maybeSingle();
  if (!row) return notFound();
  const owned = row.deal_id
    ? await assertOwnsResource('crm_deals', row.deal_id as string, ctx, { requireOwner: false })
    : row.client_id ? await assertOwnsResource('crm_clients', row.client_id as string, ctx, { requireOwner: false }) : null;
  if (!owned) return notFound();
  if (!row.gmail_message_id) return NextResponse.json({ attachments: [] });

  const boxes = await callerMailboxes(ctx.userId);
  if (!boxes.length) return NextResponse.json({ attachments: [], unavailable: true });

  for (const box of boxes) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${row.gmail_message_id}?format=full`, { headers: { Authorization: `Bearer ${box.accessToken}` } });
    if (!res.ok) continue; // not in this mailbox
    const msg = await res.json();
    const parts: Part[] = [];
    collect(msg.payload, parts);

    if (partId === null) {
      return NextResponse.json({ attachments: parts.map(p => ({ part: p.partId, name: p.filename, size: p.body?.size ?? 0, mime: p.mimeType ?? 'application/octet-stream' })) });
    }
    const part = parts.find(p => p.partId === partId);
    if (!part?.body?.attachmentId) return notFound('Attachment not found');
    const a = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${row.gmail_message_id}/attachments/${part.body.attachmentId}`, { headers: { Authorization: `Bearer ${box.accessToken}` } });
    if (!a.ok) return NextResponse.json({ error: 'Gmail would not return that file' }, { status: 502 });
    const data = (await a.json()).data as string;
    const bytes = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const name = (part.filename ?? 'attachment').replace(/[\r\n"]/g, '_');
    // octet-stream + nosniff: never let a hostile attachment render as a page on our origin.
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  }
  // The message isn't in any mailbox this person has connected (it was filed from a teammate's inbox).
  return NextResponse.json({ attachments: [], unavailable: true });
}
