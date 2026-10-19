import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { ATTACHMENT_MAX_BYTES, attachmentInfo, extOf } from '@/lib/copilot-attachment-types';
import { ATT_BUCKET, newAttachmentPath, purgeOldAttachments } from '@/lib/copilot-attachments';

export const runtime = 'nodejs';

/**
 * POST /api/crm/assistant/attachments  { filename, size }
 * Hands back a signed upload URL so the browser can PUT a file straight to private storage (the file never
 * passes through this function, so Vercel's 4.5 MB body limit doesn't apply). The path is always inside the
 * caller's own folder; the chat then carries only a small reference to it.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => null) as { filename?: unknown; size?: unknown } | null;
  const filename = typeof body?.filename === 'string' ? body.filename.trim().slice(0, 200) : '';
  const size = Number(body?.size);
  if (!filename) return NextResponse.json({ error: 'filename required' }, { status: 400 });
  const info = attachmentInfo(filename);
  if (!info) return NextResponse.json({ error: `I can read photos, PDFs, Word (.docx), Excel (.xlsx), CSV and text files — not .${extOf(filename) || 'this type'}.` }, { status: 400 });
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'size required' }, { status: 400 });
  if (size > ATTACHMENT_MAX_BYTES) return NextResponse.json({ error: `${filename} is over the ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB limit.` }, { status: 400 });

  const db = adminClient();
  const { id, path } = newAttachmentPath(ctx.userId, filename);
  const { data, error } = await db.storage.from(ATT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) { console.error('[assistant/attachments] presign', error); return NextResponse.json({ error: 'Could not start the upload — try again.' }, { status: 500 }); }
  void purgeOldAttachments(db, ctx.userId);
  return NextResponse.json({ uploadUrl: data.signedUrl, path, id, name: filename, type: info.mime });
}
