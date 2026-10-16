import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { findIdenticalFile } from '@/lib/dup-files';
import { LISTING_FILES_BUCKET as BUCKET, callerCanAccessListing, isPathInsideListing } from '@/lib/listing-files-access';

/**
 * POST /api/crm/listing-files/confirm
 * Body: { listing_id, filename, category, file_size, file_type, storage_path }
 * Saves the file record to crm_listing_files and returns a signed read URL.
 * Called after the browser has PUT the file directly to Supabase Storage.
 *
 * SECURITY: both `listing_id` and `storage_path` are client-supplied, so we verify the
 * caller owns the listing AND that the path sits under that listing's prefix before
 * minting a signed URL. `uploaded_by` is always the authenticated caller, never the body.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const { listing_id, filename, category, file_size, file_type, storage_path, allow_duplicate } = body;

  if (!listing_id || !filename || !storage_path) {
    return NextResponse.json({ error: 'listing_id, filename, and storage_path required' }, { status: 400 });
  }
  if (!(await callerCanAccessListing(listing_id, ctx))) return notFound('Listing not found');
  if (!isPathInsideListing(storage_path, listing_id)) {
    return NextResponse.json({ error: 'storage_path does not belong to this listing' }, { status: 400 });
  }

  const supabase = adminClient();

  // Same file already on this property (any name, any category): keep the existing row and drop the
  // new object. `allow_duplicate` is for replacing a photo with identical bytes, which must still work.
  if (file_size && allow_duplicate !== true) {
    const { data: same } = await supabase.from('crm_listing_files').select('*').eq('listing_id', listing_id).eq('file_size', file_size).neq('storage_path', storage_path).limit(6);
    const dup = same?.length ? await findIdenticalFile(supabase, BUCKET, storage_path, same) : null;
    if (dup) {
      await supabase.storage.from(BUCKET).remove([storage_path]);
      const { data: signedDup } = await supabase.storage.from(BUCKET).createSignedUrl(dup.storage_path, 3600);
      return NextResponse.json({ duplicate: true, file: { ...dup, url: signedDup?.signedUrl ?? null } });
    }
  }

  const { data: doc, error: dbErr } = await supabase.from('crm_listing_files').insert({
    listing_id,
    name: filename,
    storage_path,
    file_size: file_size ?? null,
    file_type: file_type ?? null,
    category: category ?? 'document',
    uploaded_by: ctx.userId,
  }).select().single();

  if (dbErr) {
    console.error('[listing-files/confirm] db insert error:', dbErr);
    // Clean up the orphaned storage file
    await supabase.storage.from(BUCKET).remove([storage_path]);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }

  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storage_path, 3600);
  return NextResponse.json({ file: { ...doc, url: signed?.signedUrl ?? null } });
}
