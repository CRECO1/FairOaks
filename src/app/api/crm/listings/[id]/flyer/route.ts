import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { buildFlyerBytes } from '@/lib/flyer-build';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertCanAccessListing(id, ctx))) return notFound('Listing not found');

  const supabase = adminClient();
  const { data: L } = await supabase.from('crm_listings').select('*').eq('id', id).single();
  if (!L) return notFound('Listing not found');

  const fileName = (L.name || L.address || 'listing').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 50) || 'flyer';
  // `?download=1` saves to disk; otherwise it opens in the browser's PDF viewer
  // (from which the reader can still save it).
  const asAttachment = req.nextUrl.searchParams.get('download') === '1';
  const serve = (bytes: Uint8Array | Buffer, generatedAt: string | null) => new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename="${fileName}-flyer.pdf"`,
      // The stored copy is the flyer until someone rebuilds it, so let the browser
      // reuse it rather than re-downloading on every open.
      'Cache-Control': 'private, max-age=300',
      ...(generatedAt ? { 'X-Flyer-Generated-At': generatedAt } : {}),
    },
  });

  // A flyer is built once and kept. Rebuilding costs a geocode, every photo, two map
  // tile stitches and the IABS merge — so it only happens when the listing has
  // actually changed since, or the agent explicitly asks for an updated one.
  //
  // The staleness check matters: without it a cached flyer would keep coming back
  // after new photos were added, with no way to tell it's out of date.
  const force = req.nextUrl.searchParams.get('force') === '1';
  if (!force && L.flyer_path && L.flyer_generated_at) {
    const builtAt = new Date(L.flyer_generated_at).getTime();
    // Newest upload on the property — photos, floor plans, anything the flyer draws.
    const { data: newestFile } = await supabase.from('crm_listing_files')
      .select('created_at').eq('listing_id', id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const changedAt = Math.max(
      L.updated_at ? new Date(L.updated_at).getTime() : 0,
      newestFile?.created_at ? new Date(newestFile.created_at).getTime() : 0,
    );
    // A flyer that was uploaded or built by hand (anything not stored as <timestamp>.pdf by this route) is never
    // replaced just because the listing changed — only an explicit ?force=1 rebuilds it. Otherwise opening the flyer
    // after any edit would silently swap a curated flyer for the auto-built one.
    const handBuilt = !/\/flyer\/\d+\.pdf$/.test(L.flyer_path);
    if (changedAt <= builtAt || handBuilt) {
      const { data: cached } = await supabase.storage.from('listing-files').download(L.flyer_path);
      if (cached) return serve(Buffer.from(await cached.arrayBuffer()), L.flyer_generated_at);
      // Path recorded but the blob is gone — fall through and rebuild rather than 404.
      console.warn('[flyer] stored flyer missing, rebuilding:', L.flyer_path);
    }
  }

  const bytes = await buildFlyerBytes(supabase, id, L);

  // Keep it, so the next open is a download rather than a rebuild. A storage failure
  // must not lose the agent the flyer they just waited for — serve it either way.
  // Every build gets its own path: overwriting one fixed path (upsert) left the storage
  // CDN serving the previous bytes — even a prior uploaded brochure — for up to an hour
  // after a rebuild, so the cached-flyer branch above returned a stale PDF.
  const path = `${id}/flyer/${Date.now()}.pdf`;
  const generatedAt = new Date().toISOString();
  const { error: upErr } = await supabase.storage.from('listing-files')
    .upload(path, Buffer.from(bytes), { contentType: 'application/pdf' });
  if (upErr) console.error('[flyer] could not store flyer', upErr);
  else {
    await supabase.from('crm_listings').update({ flyer_path: path, flyer_generated_at: generatedAt }).eq('id', id);
    // Drop the previous generated build only — never an uploaded/custom flyer.
    if (L.flyer_path && L.flyer_path !== path && /\/flyer\/(current|\d+)\.pdf$/.test(L.flyer_path)) {
      await supabase.storage.from('listing-files').remove([L.flyer_path]);
    }
  }

  return serve(bytes, upErr ? null : generatedAt);
}
