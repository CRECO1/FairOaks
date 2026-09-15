import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const BUCKET = 'deal-docs';

// What a deal can hold — exactly the `deal-docs` bucket's allowed_mime_types, keyed by
// extension. The content type is derived here rather than trusted from the browser:
// phones often report an empty type, which storage would record as
// application/octet-stream and refuse. Deriving it also means nothing uploaded here
// can be served back as HTML or script.
const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB — the bucket's own limit

const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();
function typeError(name: string) {
  const ext = extOf(name);
  const hint = ext === 'heic' || ext === 'heif' ? ' Share the photo as a JPG, or set Camera → Formats to Most Compatible.' : '';
  return NextResponse.json({ error: `.${ext || '?'} files can't be attached to a deal — use PDF, Word, JPG, PNG or WebP.${hint}` }, { status: 400 });
}

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
// JSON body → the direct-to-storage flow the CRM uses:
//   { action: 'presign', dealId, filename, file_size } → a signed upload URL
//   (the browser PUTs the file straight to storage)
//   { action: 'confirm', dealId, storagePath, filename } → the crm_deal_docs row
// A file posted through this function is capped by Vercel at 4.5 MB — the platform
// rejects it with a 413 before this code runs — so the file itself must never come
// through here. Multipart is still accepted for small files from older clients.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'presign') return presign(body, ctx);
    if (body.action === 'confirm') return confirm(body, ctx);
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const dealId = formData.get('dealId') as string | null;
  // NOTE: `uploadedBy` is deliberately NOT read from the form — it is the authenticated
  // caller, otherwise the uploader (and the delete-your-own-docs rule) is spoofable.

  if (!file || !dealId) {
    return NextResponse.json({ error: 'file and dealId required' }, { status: 400 });
  }

  if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File must be 25 MB or smaller' }, { status: 400 });
  }
  const contentType = CONTENT_TYPES[extOf(file.name)];
  if (!contentType) return typeError(file.name);

  const supabase = adminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${dealId}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, await file.arrayBuffer(), { contentType, upsert: false });

  if (uploadError) {
    console.error('[api/crm/docs] storage upload:', uploadError);
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  return record(ctx.userId, dealId, file.name, storagePath, file.size, contentType);
}

type Ctx = NonNullable<Awaited<ReturnType<typeof getCrmContext>>>;

async function presign(body: Record<string, unknown>, ctx: Ctx) {
  const dealId = typeof body.dealId === 'string' ? body.dealId : '';
  const filename = typeof body.filename === 'string' ? body.filename : '';
  if (!dealId || !filename) return NextResponse.json({ error: 'dealId and filename required' }, { status: 400 });
  // Never hand out an upload URL into a deal outside the caller's workspace.
  if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
  if (Number(body.file_size) > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File must be 25 MB or smaller' }, { status: 400 });
  }
  const contentType = CONTENT_TYPES[extOf(filename)];
  if (!contentType) return typeError(filename);

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  const storagePath = `${dealId}/${Date.now()}_${safeName}`;
  const { data, error } = await adminClient().storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) {
    console.error('[api/crm/docs] presign:', error);
    return NextResponse.json({ error: 'Could not start the upload — try again' }, { status: 500 });
  }
  return NextResponse.json({ uploadUrl: data.signedUrl, storagePath, contentType });
}

async function confirm(body: Record<string, unknown>, ctx: Ctx) {
  const dealId = typeof body.dealId === 'string' ? body.dealId : '';
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
  const filename = typeof body.filename === 'string' ? body.filename.slice(0, 255) : '';
  if (!dealId || !storagePath || !filename) {
    return NextResponse.json({ error: 'dealId, storagePath and filename required' }, { status: 400 });
  }
  if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');

  // The path comes back from the browser, so it has to be a file directly inside this
  // deal's folder — otherwise a caller could attach (and get signed URLs for) another
  // deal's objects.
  const objectName = storagePath.startsWith(`${dealId}/`) ? storagePath.slice(dealId.length + 1) : '';
  if (!objectName || objectName.includes('/') || objectName.includes('..')) {
    return NextResponse.json({ error: 'storagePath does not belong to this deal' }, { status: 400 });
  }

  const supabase = adminClient();
  const { data: existing } = await supabase.from('crm_deal_docs').select('*').eq('storage_path', storagePath).maybeSingle();
  if (existing) return NextResponse.json({ doc: existing });   // a retried confirm

  // Size and type come from what actually landed in storage, not from the request.
  const { data: listed, error: listError } = await supabase.storage.from(BUCKET).list(dealId, { search: objectName, limit: 5 });
  const obj = listed?.find(o => o.name === objectName);
  if (listError || !obj) {
    return NextResponse.json({ error: 'The file didn’t reach storage — try the upload again' }, { status: 400 });
  }
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  return record(ctx.userId, dealId, filename, storagePath, meta.size ?? null,
    meta.mimetype || CONTENT_TYPES[extOf(filename)] || 'application/octet-stream');
}

async function record(userId: string, dealId: string, name: string, storagePath: string, size: number | null, fileType: string) {
  const supabase = adminClient();
  const { data: doc, error: dbError } = await supabase
    .from('crm_deal_docs')
    .insert([{ deal_id: dealId, name, storage_path: storagePath, file_size: size, file_type: fileType, uploaded_by: userId }])
    .select()
    .single();

  if (dbError) {
    console.error('[api/crm/docs] insert:', dbError);
    // Don't leave an orphaned object behind
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: 'Could not save the document to the deal' }, { status: 500 });
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
