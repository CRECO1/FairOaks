import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { callerMailboxes } from '@/lib/gmail-mailbox';
import { fetchAttachment } from '@/lib/gmail-live';
import { EMAIL_ATTACH_BUCKET, type StoredAttachment } from '@/lib/email-attachments';
import { findIdenticalFile } from '@/lib/dup-files';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'deal-docs';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
// Exactly what the deal-docs bucket accepts (same table as /api/crm/docs).
const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};
const extOf = (n: string) => (n.split('.').pop() ?? '').toLowerCase();

// POST /api/gmail/save-attachment
//   { source: 'gmail',  messageId, part, dealId, account? }   a file on a message in the caller's OWN Gmail
//   { source: 'logged', emailId, index, dealId }              a file on an email already logged in the CRM
// "Save to Docs": copies the file onto the deal's Docs tab (where agents can then attach it to outgoing mail).
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const dealId = typeof b.dealId === 'string' ? b.dealId : '';
  if (!UUID.test(dealId)) return NextResponse.json({ error: 'Pick a deal' }, { status: 400 });
  if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
  const db = adminClient();

  let bytes: Buffer | null = null, name = 'attachment';
  if (b.source === 'gmail') {
    const messageId = String(b.messageId ?? ''), part = String(b.part ?? '');
    if (!/^[0-9a-f]{8,32}$/i.test(messageId) || !/^[\d.]{1,20}$/.test(part)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const boxes = await callerMailboxes(ctx.userId);
    const box = boxes.find(x => x.email && x.email === b.account) ?? boxes[0];
    if (!box) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
    const f = await fetchAttachment(box.accessToken, messageId, part);
    if (!f) return notFound('Attachment not found');
    bytes = f.bytes; name = f.name;
  } else if (b.source === 'logged') {
    const emailId = String(b.emailId ?? ''), index = Number(b.index);
    if (!UUID.test(emailId) || !Number.isInteger(index) || index < 0 || index > 40) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { data: m } = await db.from('crm_deal_emails').select('deal_id, client_id, attachments').eq('id', emailId).maybeSingle();
    const owned = m?.deal_id ? await assertOwnsResource('crm_deals', m.deal_id as string, ctx) : m?.client_id ? await assertOwnsResource('crm_clients', m.client_id as string, ctx) : null;
    const item = Array.isArray(m?.attachments) ? (m!.attachments as StoredAttachment[])[index] : undefined;
    if (!m || !owned || !item?.path) return notFound('Attachment not found');
    const { data: file } = await db.storage.from(EMAIL_ATTACH_BUCKET).download(item.path);
    if (!file) return NextResponse.json({ error: 'That file could not be read' }, { status: 502 });
    bytes = Buffer.from(await file.arrayBuffer()); name = item.name;
  } else return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const contentType = CONTENT_TYPES[extOf(name)];
  if (!contentType) return NextResponse.json({ error: `.${extOf(name) || '?'} files can't be saved to a deal — only PDF, Word, JPG, PNG or WebP.` }, { status: 400 });
  if (bytes.length > MAX_FILE_SIZE) return NextResponse.json({ error: 'File must be 25 MB or smaller' }, { status: 400 });

  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  const storagePath = `${dealId}/${Date.now()}_${safeName}`;
  const up = await db.storage.from(BUCKET).upload(storagePath, bytes, { contentType, upsert: false });
  if (up.error) { console.error('[gmail/save-attachment] upload', up.error.message); return NextResponse.json({ error: 'Could not save the file — try again' }, { status: 500 }); }

  // The same file twice on one deal (even under another name) is never wanted: keep the existing row.
  const { data: same } = await db.from('crm_deal_docs').select('*').eq('deal_id', dealId).eq('file_size', bytes.length).limit(6);
  const dup = same?.length ? await findIdenticalFile(db, BUCKET, storagePath, same) : null;
  if (dup) { await db.storage.from(BUCKET).remove([storagePath]); return NextResponse.json({ ok: true, duplicate: true, doc: dup }); }

  const { data: doc, error } = await db.from('crm_deal_docs')
    .insert([{ deal_id: dealId, name, storage_path: storagePath, file_size: bytes.length, file_type: contentType, uploaded_by: ctx.userId }]).select().single();
  if (error) { await db.storage.from(BUCKET).remove([storagePath]); console.error('[gmail/save-attachment] insert', error.message); return NextResponse.json({ error: 'Could not save the file to the deal' }, { status: 500 }); }
  return NextResponse.json({ ok: true, duplicate: false, doc });
}
