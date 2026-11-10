import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, hiddenDealIds, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { findIdenticalFile } from '@/lib/dup-files';
import { adminClient } from '@/lib/supabase-admin';
import { onDeal } from '@/lib/deal-access';

// Files on a CONTACT's card: anything uploaded straight onto the person, plus every file on the Docs tab of
// their deals (a lease filed against the deal is still that person's lease). Stored in the same private
// `deal-docs` bucket as deal files, under `client-<contact id>/`, so its type and size limits apply unchanged.
// The browser PUTs the file straight to storage (Vercel caps a posted body at 4.5 MB); this route only records it.

const BUCKET = 'deal-docs';
const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv',
};
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 3600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

type Ctx = NonNullable<Awaited<ReturnType<typeof getCrmContext>>>;

async function sign(path: string): Promise<string | null> {
  const { data, error } = await adminClient().storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) { console.error('[api/crm/client-docs] createSignedUrl failed for', path, error); return null; }
  return data.signedUrl;
}

// ── GET ?clientId=…  → the contact's files (own + their deals'), each with a signed link
//    GET ?docId=…&source=client|deal → a fresh signed link at click time (list-time links expire in an hour)
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const supabase = adminClient();

  const docId = req.nextUrl.searchParams.get('docId');
  if (docId) {
    if (!UUID_RE.test(docId)) return NextResponse.json({ error: 'invalid docId' }, { status: 400 });
    const fromDeal = req.nextUrl.searchParams.get('source') === 'deal';
    if (fromDeal) {
      const { data: doc } = await supabase.from('crm_deal_docs').select('deal_id, storage_path').eq('id', docId).maybeSingle();
      const deal = doc ? (await supabase.from('crm_deals').select('agent_id, assigned_agent_ids').eq('id', doc.deal_id).maybeSingle()).data : null;
      if (!doc || !deal || !onDeal(ctx, deal) || !(await assertOwnsResource('crm_deals', doc.deal_id, ctx))) return notFound('Document not found');
      const url = await sign(doc.storage_path);
      return url ? NextResponse.json({ url }) : NextResponse.json({ error: 'Could not generate a download link.' }, { status: 500 });
    }
    const { data: doc } = await supabase.from('crm_client_docs').select('client_id, storage_path').eq('id', docId).maybeSingle();
    if (!doc || !(await assertOwnsResource('crm_clients', doc.client_id, ctx))) return notFound('Document not found');
    const url = await sign(doc.storage_path);
    return url ? NextResponse.json({ url }) : NextResponse.json({ error: 'Could not generate a download link.' }, { status: 500 });
  }

  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  if (!UUID_RE.test(clientId)) return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_clients', clientId, ctx))) return notFound('Contact not found');

  const own = await supabase.from('crm_client_docs').select('id, name, file_size, file_type, uploaded_by, created_at, storage_path')
    .eq('client_id', clientId).order('created_at', { ascending: false });
  if (own.error) { console.error('[api/crm/client-docs] list:', own.error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }

  // Their deals' files — private (restricted) deals the caller may not see stay out, like everywhere else.
  let dq = supabase.from('crm_deals').select('id, listing_id, agent_id, assigned_agent_ids, crm_listings(address)').eq('client_id', clientId);
  if (!isAdminRole(ctx.role)) dq = dq.eq('business_unit', ctx.businessUnit);
  const hidden = new Set(await hiddenDealIds(ctx));
  const { data: dealRows } = await dq;
  const deals = (dealRows ?? []).filter(d => !hidden.has(d.id as string) && onDeal(ctx, d as { agent_id?: string | null; assigned_agent_ids?: string[] | null }));
  const dealLabel = new Map(deals.map(d => {
    const l = d.crm_listings as unknown as { address?: string } | { address?: string }[] | null;
    const address = Array.isArray(l) ? l[0]?.address : l?.address;
    return [d.id as string, address ? `Deal · ${address}` : 'Deal'] as const;
  }));
  const dealDocs = deals.length
    ? ((await supabase.from('crm_deal_docs').select('id, deal_id, name, file_size, file_type, uploaded_by, created_at, storage_path')
        .in('deal_id', deals.map(d => d.id as string)).order('created_at', { ascending: false })).data ?? [])
    : [];

  const files = await Promise.all([
    ...(own.data ?? []).map(async d => ({ id: d.id as string, source: 'client' as const, name: d.name as string, size: d.file_size as number | null, type: d.file_type as string | null,
      uploaded_by: d.uploaded_by as string | null, created_at: d.created_at as string, from: null as string | null, url: await sign(d.storage_path as string) })),
    ...dealDocs.map(async d => ({ id: d.id as string, source: 'deal' as const, name: d.name as string, size: d.file_size as number | null, type: d.file_type as string | null,
      uploaded_by: d.uploaded_by as string | null, created_at: d.created_at as string, from: dealLabel.get(d.deal_id as string) ?? 'Deal', url: await sign(d.storage_path as string) })),
  ]);
  files.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return NextResponse.json({ files });
}

// ── POST { action: 'presign', clientId, filename, file_size } → a signed upload URL
//    POST { action: 'confirm', clientId, storagePath, filename } → records the file on the contact
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (body.action === 'presign') return presign(body, ctx);
  if (body.action === 'confirm') return confirm(body, ctx);
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

async function presign(body: Record<string, unknown>, ctx: Ctx) {
  const clientId = typeof body.clientId === 'string' ? body.clientId : '';
  const filename = typeof body.filename === 'string' ? body.filename : '';
  if (!UUID_RE.test(clientId) || !filename) return NextResponse.json({ error: 'clientId and filename required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_clients', clientId, ctx))) return notFound('Contact not found');
  if (Number(body.file_size) > MAX_FILE_SIZE) return NextResponse.json({ error: 'File must be 25 MB or smaller' }, { status: 400 });
  const contentType = CONTENT_TYPES[extOf(filename)];
  if (!contentType) {
    const ext = extOf(filename);
    const hint = ext === 'heic' || ext === 'heif' ? ' Share the photo as a JPG, or set Camera → Formats to Most Compatible.' : '';
    return NextResponse.json({ error: `.${ext || '?'} files can't be attached here — use PDF, Word, Excel, CSV, JPG, PNG or WebP.${hint}` }, { status: 400 });
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  const storagePath = `client-${clientId}/${Date.now()}_${safeName}`;
  const { data, error } = await adminClient().storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) {
    console.error('[api/crm/client-docs] presign:', error);
    return NextResponse.json({ error: 'Could not start the upload — try again' }, { status: 500 });
  }
  return NextResponse.json({ uploadUrl: data.signedUrl, storagePath, contentType });
}

async function confirm(body: Record<string, unknown>, ctx: Ctx) {
  const clientId = typeof body.clientId === 'string' ? body.clientId : '';
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
  const filename = typeof body.filename === 'string' ? body.filename.slice(0, 255) : '';
  if (!UUID_RE.test(clientId) || !storagePath || !filename) return NextResponse.json({ error: 'clientId, storagePath and filename required' }, { status: 400 });
  if (!CONTENT_TYPES[extOf(filename)]) return NextResponse.json({ error: `.${extOf(filename) || '?'} files can't be attached here — use PDF, Word, Excel, CSV, JPG, PNG or WebP.` }, { status: 400 });   // confirm comes back from the browser: re-check the type
  if (!(await assertOwnsResource('crm_clients', clientId, ctx))) return notFound('Contact not found');

  // The path comes back from the browser: it must be a file directly inside THIS contact's folder.
  const folder = `client-${clientId}/`;
  const objectName = storagePath.startsWith(folder) ? storagePath.slice(folder.length) : '';
  if (!objectName || objectName.includes('/') || objectName.includes('..')) return NextResponse.json({ error: 'storagePath does not belong to this contact' }, { status: 400 });

  const supabase = adminClient();
  const { data: existing } = await supabase.from('crm_client_docs').select('*').eq('storage_path', storagePath).maybeSingle();
  if (existing) return NextResponse.json({ doc: existing });   // a retried confirm

  // Size and type come from what actually landed in storage, not from the request.
  const { data: listed, error: listError } = await supabase.storage.from(BUCKET).list(`client-${clientId}`, { search: objectName, limit: 5 });
  const obj = listed?.find(o => o.name === objectName);
  if (listError || !obj) return NextResponse.json({ error: 'The file didn’t reach storage — try the upload again' }, { status: 400 });
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  const size = meta.size ?? null;
  const fileType = meta.mimetype || CONTENT_TYPES[extOf(filename)] || 'application/octet-stream';

  // The same file twice on one contact is never what anyone wants: keep the existing row, drop the new object.
  if (size) {
    const { data: same } = await supabase.from('crm_client_docs').select('*').eq('client_id', clientId).eq('file_size', size).neq('storage_path', storagePath).limit(6);
    const dup = same?.length ? await findIdenticalFile(supabase, BUCKET, storagePath, same) : null;
    if (dup) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ duplicate: true, doc: dup });
    }
  }
  const { data: doc, error } = await supabase.from('crm_client_docs')
    .insert([{ client_id: clientId, name: filename, storage_path: storagePath, file_size: size, file_type: fileType, uploaded_by: ctx.userId }])
    .select().single();
  if (error) {
    console.error('[api/crm/client-docs] insert:', error);
    await supabase.storage.from(BUCKET).remove([storagePath]);   // don't leave an orphaned object behind
    return NextResponse.json({ error: 'Could not save the file to the contact' }, { status: 500 });
  }
  return NextResponse.json({ doc });
}

// ── DELETE { docId } — the uploader or an admin; files that live on a deal are removed from the deal's Docs tab
export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { docId } = await req.json().catch(() => ({}));
  if (typeof docId !== 'string' || !UUID_RE.test(docId)) return NextResponse.json({ error: 'docId required' }, { status: 400 });
  const supabase = adminClient();
  const { data: doc } = await supabase.from('crm_client_docs').select('client_id, storage_path, uploaded_by').eq('id', docId).maybeSingle();
  if (!doc || !(await assertOwnsResource('crm_clients', doc.client_id, ctx))) return notFound('Document not found');
  if (doc.uploaded_by !== ctx.userId && !isAdminRole(ctx.role)) return NextResponse.json({ error: 'Forbidden — you can only delete your own files' }, { status: 403 });
  if (doc.storage_path) await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  await supabase.from('crm_client_docs').delete().eq('id', docId);
  return NextResponse.json({ success: true });
}
