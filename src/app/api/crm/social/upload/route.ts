import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient, SUPABASE_URL } from '@/lib/supabase-admin';

const BUCKET = 'images';
const MAX_SIZE_BYTES = 12 * 1024 * 1024; // 12 MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
];

/**
 * POST /api/crm/social/upload
 * Body: JSON { filename, contentType, size }
 * Returns a Supabase signed upload URL so the browser can PUT the file
 * directly to storage — bypasses the 4.5 MB Next.js/Vercel body limit.
 * The client then constructs the public URL from the returned path.
 */
export async function POST(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  let body: { filename?: string; contentType?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { filename, contentType, size } = body;

  if (!filename || !contentType) {
    return NextResponse.json({ error: 'filename and contentType are required' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 });
  }
  if (size && size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 12 MB)' }, { status: 400 });
  }

  const safeName = filename.replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
  const path = `social/${user.id}/${Date.now()}_${safeName}`;

  const supabase = adminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error('[social/upload] Failed to create signed URL:', error?.message);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  return NextResponse.json({ signedUrl: data.signedUrl, path, publicUrl });
}
