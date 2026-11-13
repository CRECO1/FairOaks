import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * Serves the property's STORED flyer (crm_listings.flyer_path) and nothing else.
 *
 * The CRM no longer builds flyers. It used to regenerate one whenever a listing changed or on "Update flyer", which
 * could replace a curated PDF an agent had made. A flyer now only changes when a person puts a different file there.
 * No stored flyer = 404, never a freshly built one.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertCanAccessListing(id, ctx))) return notFound('Listing not found');

  const supabase = adminClient();
  const { data: L } = await supabase.from('crm_listings').select('name, address, flyer_path, flyer_generated_at').eq('id', id).single();
  if (!L) return notFound('Listing not found');
  if (!L.flyer_path) return notFound('No flyer on file for this property');

  // Revalidate on every open; an unchanged flyer comes back as a 304 with no body.
  const etag = `"flyer-${L.flyer_path}-${L.flyer_generated_at ?? ''}"`;
  const baseHeaders: Record<string, string> = { ETag: etag, 'Cache-Control': 'private, no-cache', ...(L.flyer_generated_at ? { 'X-Flyer-Generated-At': L.flyer_generated_at } : {}) };
  if (req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers: baseHeaders });

  const { data: blob } = await supabase.storage.from('listing-files').download(L.flyer_path);
  if (!blob) return notFound('The stored flyer file is missing');

  const fileName = (L.name || L.address || 'listing').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 50) || 'flyer';
  // `?download=1` saves to disk; otherwise it opens in the browser's PDF viewer.
  const asAttachment = req.nextUrl.searchParams.get('download') === '1';
  return new NextResponse(Buffer.from(await blob.arrayBuffer()), {
    headers: { ...baseHeaders, 'Content-Type': 'application/pdf', 'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename="${fileName}-flyer.pdf"` },
  });
}
