import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { extractListingFromMedia } from '@/lib/broker-ingest/extract';

/**
 * Agent-facing flyer reader for "Add Property".
 *
 * Two-step, signed-URL upload so the flyer NEVER goes through the serverless
 * function body (Vercel caps that at 4.5 MB, and real broker flyers routinely
 * exceed it — a large upload returns a non-JSON 413 before the handler runs):
 *
 *   POST → a signed upload URL; the browser PUTs the flyer straight to storage
 *   PUT  → download the flyer from storage, run the SAME Claude-vision extractor
 *          the broker crawl uses, and return the parsed fields + its public URL
 *
 * Mirrors the esign-import / listing-files presign pattern already used in prod.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BUCKET = 'images';
const OK_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — well past any real flyer

const publicUrl = (path: string) =>
  `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()}/storage/v1/object/public/${BUCKET}/${path}`;

// Step 1 — hand the browser a signed URL to upload the flyer directly to storage.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { filename, mime, file_size } = await req.json().catch(() => ({}));
  const m = String(mime || '').toLowerCase();
  const isPdf = m === 'application/pdf';
  if (!isPdf && !OK_IMAGE.has(m)) {
    return NextResponse.json({ error: 'Upload a PDF or an image (PNG, JPG, WEBP, or GIF).' }, { status: 400 });
  }
  if (file_size && Number(file_size) > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is over 25 MB — try a smaller one.' }, { status: 400 });
  }

  const ext = isPdf ? 'pdf' : (m.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const safe = String(filename || `flyer.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `property-flyers/${ctx.userId}/${Date.now()}_${safe}`;

  const { data, error } = await adminClient().storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) {
    console.error('[extract-flyer] presign', error);
    return NextResponse.json({ error: 'Could not start the upload.' }, { status: 500 });
  }
  return NextResponse.json({ uploadUrl: data.signedUrl, storagePath });
}

// Step 2 — read the uploaded flyer out of storage and extract the listing fields.
export async function PUT(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { storage_path, mime } = await req.json().catch(() => ({}));
  if (!storage_path) return NextResponse.json({ error: 'storage_path required' }, { status: 400 });
  // A caller can only process an upload under their own prefix.
  if (!String(storage_path).startsWith(`property-flyers/${ctx.userId}/`)) {
    return NextResponse.json({ error: 'Upload not found.' }, { status: 404 });
  }

  const m = String(mime || '').toLowerCase();
  const isPdf = m === 'application/pdf';
  const isImage = OK_IMAGE.has(m);
  if (!isPdf && !isImage) return NextResponse.json({ error: 'Unsupported file type.' }, { status: 400 });

  const supabase = adminClient();
  const { data: blob } = await supabase.storage.from(BUCKET).download(storage_path);
  if (!blob) return NextResponse.json({ error: 'The upload did not finish — try again.' }, { status: 400 });
  const data = Buffer.from(await blob.arrayBuffer()).toString('base64');

  let extraction;
  try {
    extraction = await extractListingFromMedia([{ kind: isPdf ? 'pdf' : 'image', mimeType: m, data }]);
  } catch (err) {
    console.error('[extract-flyer] extraction failed:', err);
    // Don't leave an orphan blob when we couldn't use it.
    try { await supabase.storage.from(BUCKET).remove([storage_path]); } catch { /* best effort */ }
    return NextResponse.json(
      { error: 'Could not read the flyer automatically — please enter the details manually.' },
      { status: 502 },
    );
  }

  const url = publicUrl(storage_path);
  return NextResponse.json({ extraction, flyerUrl: isImage ? url : null, brochureUrl: isPdf ? url : null });
}
