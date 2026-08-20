import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { extractListingFromMedia } from '@/lib/broker-ingest/extract';

/**
 * POST /api/crm/property-db/extract-flyer
 *
 * Agent-facing: accepts an uploaded property flyer (image or PDF) as multipart
 * form-data (field name "file"), runs it through the same Claude-vision extractor
 * the broker-ingest pipeline uses, and returns the parsed fields so the Add-Property
 * form can pre-fill itself. Also stores the flyer in the public images bucket so it
 * can be attached to the property card (images → flyer thumbnail, PDF → brochure).
 *
 * The extraction itself is never persisted here — the agent reviews/edits the
 * fields and the separate POST /api/crm/property-db call does the insert.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const OK_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB upload cap

/** Store the flyer in the public "images" bucket; returns its public URL (or null). */
async function storeFlyer(buf: Buffer, mime: string): Promise<string | null> {
  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const ext = mime === 'application/pdf' ? 'pdf' : (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const hash = createHash('md5').update(buf).digest('hex').slice(0, 20);
    const path = `property-flyers/${hash}.${ext}`;
    const res = await fetch(`${url}/storage/v1/object/images/${path}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': mime, 'x-upsert': 'true' },
      body: new Uint8Array(buf),
    });
    if (!res.ok && res.status !== 409) {
      console.error('[extract-flyer] storage upload failed:', res.status);
      return null;
    }
    return `${url}/storage/v1/object/public/images/${path}`;
  } catch (err) {
    console.error('[extract-flyer] storage upload error:', err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
  } catch {
    /* fallthrough to the missing-file error below */
  }
  if (!file) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large (max 12 MB).' }, { status: 400 });
  }

  const mime = (file.type || '').toLowerCase();
  const isPdf = mime === 'application/pdf';
  const isImage = OK_IMAGE.has(mime);
  if (!isPdf && !isImage) {
    return NextResponse.json(
      { error: 'Upload a PDF or an image (PNG, JPG, WEBP, or GIF).' },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const data = buf.toString('base64');

  let extraction;
  try {
    extraction = await extractListingFromMedia([{ kind: isPdf ? 'pdf' : 'image', mimeType: mime, data }]);
  } catch (err) {
    console.error('[extract-flyer] extraction failed:', err);
    return NextResponse.json(
      { error: 'Could not read the flyer automatically — please enter the details manually.' },
      { status: 502 },
    );
  }

  // Best-effort: keep the flyer as the property's photo/brochure. Never fail the
  // request over a storage hiccup — extraction is the valuable part.
  const publicUrl = await storeFlyer(buf, mime);

  return NextResponse.json({
    extraction,
    flyerUrl: isImage ? publicUrl : null,
    brochureUrl: isPdf ? publicUrl : null,
  });
}
