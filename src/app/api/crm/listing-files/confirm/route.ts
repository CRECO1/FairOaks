import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const BUCKET = 'listing-files';

/**
 * POST /api/crm/listing-files/confirm
 * Body: { listing_id, filename, category, file_size, file_type, storage_path, uploaded_by }
 * Saves the file record to crm_listing_files and returns a signed read URL.
 * Called after the browser has PUT the file directly to Supabase Storage.
 */
export async function POST(req: NextRequest) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();

  const body = await req.json();
  const { listing_id, filename, category, file_size, file_type, storage_path } = body;

  if (!listing_id || !filename || !storage_path) {
    return NextResponse.json({ error: 'listing_id, filename, and storage_path required' }, { status: 400 });
  }

  const supabase = adminClient();
  const { data: doc, error: dbErr } = await supabase.from('crm_listing_files').insert({
    listing_id,
    name: filename,
    storage_path,
    file_size: file_size ?? null,
    file_type: file_type ?? null,
    category: category ?? 'document',
    uploaded_by: caller.id,
  }).select().single();

  if (dbErr) {
    console.error('[listing-files/confirm] db insert error:', dbErr);
    // Clean up the orphaned storage file
    await supabase.storage.from(BUCKET).remove([storage_path]);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storage_path, 3600);
  return NextResponse.json({ file: { ...doc, url: signed?.signedUrl ?? null } });
}
