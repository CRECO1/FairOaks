import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const BUCKET = 'listing-files';
const ALLOWED_EXT = new Set(['pdf','doc','docx','xls','xlsx','jpg','jpeg','png','gif','webp','ppt','pptx','key','zip','txt','csv','mp4','mov']);
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * POST /api/crm/listing-files/presign
 * Body: { listing_id, filename, category, file_size, file_type }
 * Returns a signed Supabase Storage upload URL so the browser can PUT the file
 * directly to storage without routing through this serverless function.
 * After the PUT succeeds, the client calls POST /api/crm/listing-files/confirm
 * to save the DB record.
 */
export async function POST(req: NextRequest) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();

  const body = await req.json();
  const { listing_id, filename, category, file_size, file_type } = body;

  if (!listing_id || !filename) {
    return NextResponse.json({ error: 'listing_id and filename required' }, { status: 400 });
  }
  if (file_size && file_size > MAX_SIZE) {
    return NextResponse.json({ error: 'File must be 50 MB or smaller' }, { status: 400 });
  }
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: `File type .${ext} not allowed` }, { status: 400 });
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${listing_id}/${Date.now()}_${safeName}`;

  const supabase = adminClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) {
    console.error('[listing-files/presign] error:', error);
    return NextResponse.json({ error: error?.message ?? 'Could not generate upload URL' }, { status: 500 });
  }

  return NextResponse.json({
    uploadUrl: data.signedUrl,
    storagePath,
    token: data.token,
    // pass back metadata so the client can call /confirm
    meta: { listing_id, filename, category: category ?? 'document', file_size, file_type, uploaded_by: caller.id },
  });
}
