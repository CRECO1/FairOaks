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
const DEAL_BUCKET = 'deal-docs';     // where a deal's own attachments live
const MAX_SIZE = 25 * 1024 * 1024;   // 25 MB — well past a normal contract scan

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));

  // Send an existing library form (a clean, unencrypted CRM template) straight to
  // signing — no re-uploading it from the agent's computer. Copy its PDF into an
  // import and hand back a ready-to-prepare submission the composer can open.
  if (body.from_form_id) {
    const supabase = adminClient();
    const { data: form } = await supabase.from('crm_forms').select('id, name, storage_path, business_unit').eq('id', body.from_form_id).maybeSingle();
    if (!form?.storage_path) return notFound('Form not found');
    if (!isAdminRole(ctx.role) && form.business_unit !== ctx.businessUnit) return notFound('Form not found');
    const { data: blob } = await supabase.storage.from(BUCKET).download(form.storage_path);
    if (!blob) return NextResponse.json({ error: 'Could not read that form.' }, { status: 500 });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const safe = String(form.name || 'Form').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    const path = `imports/${ctx.userId}/${Date.now()}_${safe}.pdf`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) { console.error('[esign-import] form copy', upErr); return NextResponse.json({ error: 'Could not prepare that form.' }, { status: 500 }); }
    const unit = isAdminRole(ctx.role) ? (body.business_unit || ctx.businessUnit || 'commercial') : (ctx.businessUnit ?? 'commercial');
    const { data: sub, error } = await supabase.from('crm_form_submissions').insert({
      form_id: null, business_unit: unit, title: form.name, values: [], status: 'saved',
      source_path: path, filled_path: path, created_by: ctx.userId,
    }).select('id, title').single();
    if (error) { console.error('[esign-import] form submission', error); return NextResponse.json({ error: 'Could not prepare that form.' }, { status: 500 }); }
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    return NextResponse.json({ submission: { id: sub.id, title: sub.title, url: signed?.signedUrl ?? null } });
  }

  // Send a document that is already attached to a deal — the counter-signed lease
  // the other side emailed over, a vendor agreement, whatever is sitting in the
  // deal's folder — without downloading it and dropping it back in. Same shape as
  // the library-form path: copy the bytes into an import and hand back a
  // ready-to-prepare submission.
  if (body.from_deal_doc_id) {
    const supabase = adminClient();
    const { data: doc } = await supabase.from('crm_deal_docs')
      .select('id, deal_id, storage_path, name').eq('id', body.from_deal_doc_id).maybeSingle();
    if (!doc?.storage_path) return notFound('Document not found');
    // crm_deal_docs carries no business_unit of its own — access comes from the deal.
    if (!(await assertOwnsResource('crm_deals', doc.deal_id, ctx))) return notFound('Document not found');
    // A deal folder also holds Word files and photos; signing needs fixed page
    // geometry to place fields against, which only a PDF has.
    if (!/\.pdf$/i.test(doc.storage_path)) {
      return NextResponse.json({ error: 'Only PDFs can be sent for signature — save that document as a PDF and attach it to the deal.' }, { status: 400 });
    }
    const { data: blob } = await supabase.storage.from(DEAL_BUCKET).download(doc.storage_path);
    if (!blob) return NextResponse.json({ error: 'Could not read that document.' }, { status: 500 });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const base = String(doc.name || doc.storage_path.split('/').pop() || 'Document').replace(/\.pdf$/i, '');
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    const path = `imports/${ctx.userId}/${Date.now()}_${safe}.pdf`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) { console.error('[esign-import] deal doc copy', upErr); return NextResponse.json({ error: 'Could not prepare that document.' }, { status: 500 }); }
    const unit = isAdminRole(ctx.role) ? (body.business_unit || ctx.businessUnit || 'commercial') : (ctx.businessUnit ?? 'commercial');
    // deal_id is carried over, so the signed copy files itself back onto the deal
    // it came from rather than landing unattached.
    const { data: sub, error } = await supabase.from('crm_form_submissions').insert({
      form_id: null, business_unit: unit, title: base, values: [], status: 'saved',
      source_path: path, filled_path: path, deal_id: doc.deal_id, created_by: ctx.userId,
    }).select('id, title').single();
    if (error) { console.error('[esign-import] deal doc submission', error); return NextResponse.json({ error: 'Could not prepare that document.' }, { status: 500 }); }
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    return NextResponse.json({ submission: { id: sub.id, title: sub.title, url: signed?.signedUrl ?? null } });
  }

  const { filename, file_size } = body;
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
  let encrypted = false;
  try {
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { ignoreEncryption: true });
    pageCount = doc.getPageCount();
    encrypted = doc.isEncrypted;
  } catch {
    await supabase.storage.from(BUCKET).remove([storage_path]);
    return NextResponse.json({ error: 'That file could not be read as a PDF. Re-save it as a PDF and try again.' }, { status: 400 });
  }
  if (!pageCount) {
    await supabase.storage.from(BUCKET).remove([storage_path]);
    return NextResponse.json({ error: 'That PDF has no pages.' }, { status: 400 });
  }
  // Reject encrypted / password-protected PDFs at the door. pdf.js can't render many
  // of them, so a signer would receive a blank page — and TREC/TAR forms are commonly
  // owner-encrypted. Tell the agent the one-step fix rather than letting a blank
  // document reach a client. (Existing encrypted docs were decrypted separately.)
  if (encrypted) {
    await supabase.storage.from(BUCKET).remove([storage_path]);
    return NextResponse.json({ error: 'This PDF is password-protected / encrypted, so it can’t be prepared for signing (the signer would see a blank page). Open it in Preview → File → Export as PDF with encryption off (or Print → Save as PDF), then import that copy.' }, { status: 400 });
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
  // Imports only — a PDF dropped on E-Sign, or a library form copied into one by
  // the "send a saved form" path above, both of which carry `form_id` null.
  //
  // This used to also list library-form submissions filed against nothing (no deal,
  // listing or contact), on the grounds that they had no home anywhere else. In
  // practice they read as duplicates of documents already signed and cluttered the
  // send queue, so Zack asked for them out. The trade-off is real and deliberate:
  // such a submission is now unreachable in the UI. It is a narrow case — an agent
  // completing a form with no deal and no contact attached — and the fix if it ever
  // matters is to give them a home of their own, not to put them back here.
  let q = supabase.from('crm_form_submissions')
    .select('id, title, form_id, source_path, filled_path, deal_id, listing_id, client_id, created_at, updated_at')
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
