import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { getCrmContext, assertOwnsResource, isAdminRole, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

// Import a one-off document to be signed — a lease addendum, a vendor agreement,
// anything that isn't in the Transaction Docs form library. The upload becomes a
// crm_form_submissions row with NO form_id: it's a document, not a reusable template,
// so it never lands in the forms library. `source_path` holds the original upload
// immutably; `filled_path` is what actually gets signed and is regenerated from the
// source every time the agent saves, so re-editing can't stamp values twice.
//
//   POST  → a signed upload URL (the browser PUTs the file straight to storage)
//   PUT   → confirm the upload, validate it really is a PDF, create the document
//   GET   → the imported documents waiting to be sent

const BUCKET = 'transaction-forms';
const MAX_SIZE = 25 * 1024 * 1024;   // 25 MB — well past a normal contract scan

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { filename, file_size } = await req.json().catch(() => ({}));
  if (!filename) return NextResponse.json({ error: 'filename required' }, { status: 400 });
  // Signing needs fixed page geometry to place fields against, which only a PDF has.
  if (!/\.pdf$/i.test(String(filename))) {
    return NextResponse.json({ error: 'Only PDFs can be sent for signature — save the document as a PDF and import that.' }, { status: 400 });
  }
  if (file_size && file_size > MAX_SIZE) {
    return NextResponse.json({ error: 'That file is over 25 MB — try a smaller scan.' }, { status: 400 });
  }

  const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `imports/${ctx.userId}/${Date.now()}_${safe}`;
  const { data, error } = await adminClient().storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) {
    console.error('[esign-import] presign', error);
    return NextResponse.json({ error: 'Could not start the upload' }, { status: 500 });
  }
  return NextResponse.json({ uploadUrl: data.signedUrl, token: data.token, storagePath });
}

export async function PUT(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { storage_path, title, deal_id, listing_id, business_unit } = await req.json().catch(() => ({}));
  if (!storage_path) return NextResponse.json({ error: 'storage_path required' }, { status: 400 });
  // Only the uploader's own import prefix — a caller can't confirm a path they didn't get.
  if (!String(storage_path).startsWith(`imports/${ctx.userId}/`)) return notFound('Upload not found');
  if (deal_id && !(await assertOwnsResource('crm_deals', deal_id, ctx))) return notFound('Deal not found');
  if (listing_id && !(await assertCanAccessListing(listing_id, ctx))) return notFound('Listing not found');

  const supabase = adminClient();
  const { data: blob } = await supabase.storage.from(BUCKET).download(storage_path);
  if (!blob) return NextResponse.json({ error: 'The upload did not finish — try again.' }, { status: 400 });

  // Confirm it opens as a PDF before it can be sent to a client; a mislabelled file
  // would otherwise fail silently at signing time.
  let pageCount = 0;
  try {
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { ignoreEncryption: true });
    pageCount = doc.getPageCount();
  } catch {
    await supabase.storage.from(BUCKET).remove([storage_path]);
    return NextResponse.json({ error: 'That file could not be read as a PDF. Re-save it as a PDF and try again.' }, { status: 400 });
  }
  if (!pageCount) {
    await supabase.storage.from(BUCKET).remove([storage_path]);
    return NextResponse.json({ error: 'That PDF has no pages.' }, { status: 400 });
  }

  const unit = isAdminRole(ctx.role) ? (business_unit || ctx.businessUnit || 'commercial') : (ctx.businessUnit ?? 'commercial');
  const name = String(title || storage_path.split('/').pop() || 'Document').replace(/\.pdf$/i, '');
  const { data: sub, error } = await supabase.from('crm_form_submissions').insert({
    form_id: null,                    // an imported document, not a library form
    deal_id: deal_id || null, listing_id: listing_id || null,
    business_unit: unit, title: name, values: [], status: 'saved',
    source_path: storage_path,
    // Sendable as-is: an agent who places no fields still gets the appended
    // Signatures page, exactly like a template doc with no placements.
    filled_path: storage_path,
    created_by: ctx.userId,
  }).select('id, title, filled_path, source_path, deal_id, listing_id').single();
  if (error) {
    console.error('[esign-import] insert', error);
    return NextResponse.json({ error: 'Could not save the document' }, { status: 500 });
  }
  return NextResponse.json({ submission: sub, page_count: pageCount });
}

// The imported documents an agent still has in hand, newest first, each with the
// envelope (if any) so the UI can show sent / signed rather than offering a resend.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const supabase = adminClient();
  let q = supabase.from('crm_form_submissions')
    .select('id, title, filled_path, deal_id, listing_id, created_at, updated_at')
    .is('form_id', null)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (!isAdminRole(ctx.role)) q = q.eq('business_unit', ctx.businessUnit);
  const { data, error } = await q;
  if (error) { console.error('[esign-import] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }

  const ids = (data ?? []).map(s => s.id);
  const envBySub = new Map<string, { id: string; status: string; created_at: string }>();
  if (ids.length) {
    const { data: envs } = await supabase.from('crm_envelopes')
      .select('id, submission_id, status, created_at').in('submission_id', ids).order('created_at', { ascending: false });
    for (const e of envs ?? []) if (e.submission_id && !envBySub.has(e.submission_id)) envBySub.set(e.submission_id, { id: e.id, status: e.status, created_at: e.created_at });
  }
  const documents = await Promise.all((data ?? []).map(async s => {
    let url: string | null = null;
    if (s.filled_path) {
      const { data: sg } = await supabase.storage.from(BUCKET).createSignedUrl(s.filled_path, 3600);
      url = sg?.signedUrl ?? null;
    }
    return { ...s, url, envelope: envBySub.get(s.id) ?? null };
  }));
  return NextResponse.json({ documents });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_form_submissions', id, ctx))) return notFound('Document not found');
  const supabase = adminClient();
  const { data: sub } = await supabase.from('crm_form_submissions').select('form_id, source_path, filled_path').eq('id', id).maybeSingle();
  if (!sub) return notFound('Document not found');
  if (sub.form_id) return NextResponse.json({ error: 'That is a library form, not an import.' }, { status: 400 });
  // Refuse to pull the source out from under a document that is already out for signature.
  const { count } = await supabase.from('crm_envelopes').select('id', { count: 'exact', head: true }).eq('submission_id', id);
  if (count) return NextResponse.json({ error: 'This document has already been sent — void the signature request first.' }, { status: 400 });

  const paths = Array.from(new Set([sub.source_path, sub.filled_path].filter(Boolean) as string[]));
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  const { error } = await supabase.from('crm_form_submissions').delete().eq('id', id);
  if (error) { console.error('[esign-import] DELETE', error); return NextResponse.json({ error: 'Could not remove the document' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
