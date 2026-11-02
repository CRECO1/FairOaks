import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { EMAIL_ATTACH_BUCKET } from '@/lib/email-attachments';

export const dynamic = 'force-dynamic';

// POST /api/crm/attach-upload { name, size } → a one-shot upload address for a file the sender wants to email.
// Vercel caps a posted body at ~4.5 MB, so a big file goes from the browser straight to private storage (under the
// sender's own `pending/<their id>/…` folder) and the email is sent with a reference to it (kind "upload"), which the
// server resolves — and only for the person who uploaded it. Sent emails clear the file again.
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const rawName = typeof b.name === 'string' ? b.name : '';
  const size = Number(b.size);
  if (!rawName.trim() || !Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'name and size required' }, { status: 400 });
  if (size > MAX_BYTES) return NextResponse.json({ error: 'Files over 15 MB are too large to email — share a link instead.' }, { status: 413 });
  const safe = rawName.replace(/[\r\n]/g, ' ').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().slice(-120) || 'file';
  const path = `pending/${ctx.userId}/${crypto.randomUUID()}/${safe}`;
  const { data, error } = await adminClient().storage.from(EMAIL_ATTACH_BUCKET).createSignedUploadUrl(path);
  if (error || !data) { console.error('[attach-upload] presign:', error); return NextResponse.json({ error: 'Could not start the upload — try again' }, { status: 500 }); }
  return NextResponse.json({ uploadUrl: data.signedUrl, path, name: safe });
}
