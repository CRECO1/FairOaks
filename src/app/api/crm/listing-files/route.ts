import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { LISTING_FILES_BUCKET as BUCKET, callerCanAccessListing } from '@/lib/listing-files-access';

const ALLOWED_EXT = new Set(['pdf','doc','docx','xls','xlsx','jpg','jpeg','png','gif','webp','ppt','pptx','key','zip','txt','csv','mp4','mov']);
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

// crm_listing_files carries no business_unit — every route derives access from the
// parent listing so an agent can't list, upload into, or delete another workspace's files.

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id');
  if (!listingId) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await callerCanAccessListing(listingId, ctx))) return notFound('Listing not found');
  const supabase = adminClient();
  const { data: files, error } = await supabase
    .from('crm_listing_files')
    .select('*')
    .eq('listing_id', listingId)
    // Gallery order first (NULL last, so un-ordered files keep today's behaviour),
    // then newest-first within each group.
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) { console.error('[api] db error:', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  const withUrls = await Promise.all(
    (files ?? []).map(async f => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, 3600);
      return { ...f, url: data?.signedUrl ?? null };
    })
  );
  return NextResponse.json({ files: withUrls });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const listingId = formData.get('listing_id') as string | null;
  const category = (formData.get('category') as string) || 'document';
  if (!file || !listingId) return NextResponse.json({ error: 'file and listing_id required' }, { status: 400 });
  if (!(await callerCanAccessListing(listingId, ctx))) return notFound('Listing not found');
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File must be 50 MB or smaller' }, { status: 400 });
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: `File type .${ext} not allowed` }, { status: 400 });
  const supabase = adminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${listingId}/${Date.now()}_${safeName}`;
  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(storagePath, await file.arrayBuffer(), { contentType: file.type || 'application/octet-stream', upsert: false });
  if (uploadErr) { console.error('[listing-files] storage upload error:', uploadErr); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  const { data: doc, error: dbErr } = await supabase.from('crm_listing_files').insert({
    listing_id: listingId, name: file.name, storage_path: storagePath,
    file_size: file.size, file_type: file.type || ext, category,
    uploaded_by: ctx.userId,
  }).select().single();
  if (dbErr) { console.error('[listing-files] db insert error:', dbErr); await supabase.storage.from(BUCKET).remove([storagePath]); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  return NextResponse.json({ file: { ...doc, url: signed?.signedUrl ?? null } });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { fileId } = await req.json();
  if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });
  const supabase = adminClient();
  const { data: f } = await supabase.from('crm_listing_files').select('listing_id, storage_path').eq('id', fileId).single();
  if (!f) return notFound();
  if (!(await callerCanAccessListing(f.listing_id, ctx))) return notFound();
  if (f.storage_path) await supabase.storage.from(BUCKET).remove([f.storage_path]);
  await supabase.from('crm_listing_files').delete().eq('id', fileId);
  return NextResponse.json({ deleted: true });
}

// Reorder a listing's photos. The client sends the ids in the order it wants them;
// position 0 is the flyer's cover. Writing every position (rather than a delta)
// keeps the sequence dense and makes the result independent of what was there before.
export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { listing_id, order } = await req.json().catch(() => ({}));
  if (!listing_id || !Array.isArray(order)) {
    return NextResponse.json({ error: 'listing_id and order[] required' }, { status: 400 });
  }
  if (!(await callerCanAccessListing(listing_id, ctx))) return notFound('Listing not found');
  const ids = (order as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 500);
  if (!ids.length) return NextResponse.json({ error: 'order[] is empty' }, { status: 400 });

  const supabase = adminClient();
  // Only touch rows that really belong to this listing — an id from elsewhere must
  // not be re-parented or reordered by passing it in the list.
  const { data: owned } = await supabase.from('crm_listing_files')
    .select('id').eq('listing_id', listing_id).in('id', ids);
  const ownedIds = new Set((owned ?? []).map(f => f.id as string));
  const toWrite = ids.filter(id => ownedIds.has(id));
  if (!toWrite.length) return NextResponse.json({ error: 'Nothing to reorder' }, { status: 400 });

  const results = await Promise.all(toWrite.map((id, i) =>
    supabase.from('crm_listing_files').update({ sort_order: i }).eq('id', id).eq('listing_id', listing_id)));
  const failed = results.filter(r => r.error);
  if (failed.length) {
    console.error('[api/listing-files] reorder', failed[0].error);
    return NextResponse.json({ error: 'Could not save the new order' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ordered: toWrite.length });
}
