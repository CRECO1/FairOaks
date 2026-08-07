import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const BUCKET = 'deal-docs';

// Files that could be executed or rendered as HTML/scripts are blocked
const BLOCKED_MIME_PREFIXES = ['text/html', 'application/x-', 'application/javascript'];
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp',
  'zip', 'eml', 'msg',
]);
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// ── GET: list docs for a deal (with signed download URLs) ─────────────────────
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const dealId = req.nextUrl.searchParams.get('dealId');
  if (!dealId) return NextResponse.json({ error: 'dealId required' }, { status: 400 });

  // crm_deal_docs has no business_unit — access comes from the parent deal. Without this
  // any authenticated user could list another workspace's docs *and* get signed URLs.
  if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');

  const supabase = adminClient();
  const { data: docs, error } = await supabase
    .from('crm_deal_docs')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  // Generate a signed URL for each doc (1-hour expiry)
  const withUrls = await Promise.all(
    (docs ?? []).map(async (doc) => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, 3600);
      return { ...doc, url: data?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ docs: withUrls });
}

// ── POST: upload a doc ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const dealId = formData.get('dealId') as string | null;
  // NOTE: `uploadedBy` is deliberately NOT read from the form — it is the authenticated
  // caller, otherwise the uploader (and the delete-your-own-docs rule) is spoofable.

  if (!file || !dealId) {
    return NextResponse.json({ error: 'file and dealId required' }, { status: 400 });
  }

  if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');

  // File size check
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File must be 25 MB or smaller' }, { status: 400 });
  }

  // Extension allowlist
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: `File type .${ext} is not allowed` }, { status: 400 });
  }

  // MIME type block — reject executable/HTML types even if extension looks fine
  const mimeType = file.type || 'application/octet-stream';
  if (BLOCKED_MIME_PREFIXES.some(p => mimeType.startsWith(p))) {
    return NextResponse.json({ error: 'File MIME type is not permitted' }, { status: 400 });
  }

  const supabase = adminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${dealId}/${Date.now()}_${safeName}`;

  // Upload to Supabase Storage
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Save metadata to DB
  const { data: doc, error: dbError } = await supabase
    .from('crm_deal_docs')
    .insert([{
      deal_id: dealId,
      name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      file_type: file.type || ext,
      uploaded_by: ctx.userId,
    }])
    .select()
    .single();

  if (dbError) {
    // Clean up uploaded file if DB insert fails
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ doc });
}

// ── DELETE: remove a doc ──────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { docId } = await req.json();
  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 });

  const supabase = adminClient();

  // Fetch doc — include deal_id + uploaded_by for the workspace and ownership checks
  const { data: doc } = await supabase
    .from('crm_deal_docs')
    .select('deal_id, storage_path, uploaded_by')
    .eq('id', docId)
    .single();

  if (!doc) return notFound('Document not found');

  // Workspace first, so a cross-tenant probe can't distinguish 403 from 404
  if (!(await assertOwnsResource('crm_deals', doc.deal_id, ctx))) return notFound('Document not found');

  // Then: only the uploader OR an admin may delete
  if (doc.uploaded_by !== ctx.userId && !isAdminRole(ctx.role)) {
    return NextResponse.json({ error: 'Forbidden — you can only delete your own documents' }, { status: 403 });
  }

  if (doc.storage_path) {
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  }

  await supabase.from('crm_deal_docs').delete().eq('id', docId);

  return NextResponse.json({ success: true });
}
