import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { renderFlyer } from '@/lib/flyer-doc';
import { OSWALD_BOLD_B64, CRECO_LOGO_PNG_B64 } from '@/lib/flyer-assets';
import sharp from 'sharp';
import { geocode, osmStaticMap } from '@/lib/static-map';

export const dynamic = 'force-dynamic';

function money(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? '$' + v.toLocaleString('en-US') : '';
}

// Map tiles. The account's public Google key is referrer-restricted (unusable from a
// server) and Maps Static isn't enabled, so we render the map ourselves from OSM
// tiles. If a genuine server-side Google key is ever added, prefer it.
async function googleStaticMap(params: Record<string, string>): Promise<Uint8Array | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${new URLSearchParams({ ...params, key })}`);
    if (!r.ok || !(r.headers.get('content-type') || '').includes('image')) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch { return null; }
}

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
    if (changedAt <= builtAt) {
      const { data: cached } = await supabase.storage.from('listing-files').download(L.flyer_path);
      if (cached) return serve(Buffer.from(await cached.arrayBuffer()), L.flyer_generated_at);
      // Path recorded but the blob is gone — fall through and rebuild rather than 404.
      console.warn('[flyer] stored flyer missing, rebuilding:', L.flyer_path);
    }
  }

  const loadAgent = async (uid?: string | null) => uid
    ? (await supabase.from('crm_profiles').select('first_name, last_name, email, phone').eq('id', uid).maybeSingle()).data as Record<string, string> | null
    : null;
  const [agent, coAgent] = await Promise.all([loadAgent(L.listing_agent_id), loadAgent(L.co_agent_id)]);

  // Photos (oldest-first, so the imported cover leads) + floor plan.
  // Gallery order decides the flyer: photoRows[0] is the hero. sort_order wins, and
  // NULL sorts last so a listing nobody has reordered still leads with its oldest
  // photo exactly as before.
  const { data: files } = await supabase.from('crm_listing_files')
    .select('storage_path, file_type, category, created_at, sort_order').eq('listing_id', id)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  const rows = files ?? [];
  const dl = async (f: { storage_path: string }) => {
    const { data: blob } = await supabase.storage.from('listing-files').download(f.storage_path);
    return blob ? Buffer.from(await blob.arrayBuffer()) : null;
  };
  const isImg = (f: { category?: string; file_type?: string }) => { const ft = (f.file_type || '').toLowerCase(); return f.category === 'photo' || ft.startsWith('image/') || ft.includes('png') || ft.includes('jpeg') || ft.includes('jpg') || ft.includes('webp'); };
  const photoRows = rows.filter(f => (f.category === 'photo' || (f.file_type || '').startsWith('image/')) && isImg(f));

  // Hero → normalize to the hero box aspect (612:372) as JPEG (embeddable + capped size).
  let hero: { bytes: Uint8Array; png: boolean } | null = null;
  if (photoRows[0]) { const b = await dl(photoRows[0]); if (b) { try { const j = await sharp(b).resize(1224, 744, { fit: 'cover', position: 'centre' }).jpeg({ quality: 85 }).toBuffer(); hero = { bytes: new Uint8Array(j), png: false }; } catch { hero = { bytes: new Uint8Array(b), png: (photoRows[0].file_type || '').includes('png') }; } } }

  // Gallery = the next photos, cover-cropped to 4:3 for a clean grid.
  const galleryPhotos: Array<{ bytes: Uint8Array; png: boolean }> = [];
  for (const f of photoRows.slice(1, 7)) {
    const b = await dl(f); if (!b) continue;
    try { const j = await sharp(b).resize(640, 480, { fit: 'cover', position: 'centre' }).jpeg({ quality: 82 }).toBuffer(); galleryPhotos.push({ bytes: new Uint8Array(j), png: false }); } catch { /* skip */ }
  }

  // Floor plan (first floor_plan image, contained as-is).
  let floorPlan: { bytes: Uint8Array; png: boolean } | null = null;
  const fpRow = rows.find(f => f.category === 'floor_plan' && isImg(f));
  if (fpRow) { const b = await dl(fpRow); if (b) floorPlan = { bytes: new Uint8Array(b), png: (fpRow.file_type || '').toLowerCase().includes('png') }; }

  // Lease vs sale + price. asking_price doubles as a $/SF/yr rate (small) or a total.
  // An explicit flyer_type ('lease'|'sale') wins; otherwise infer from magnitude/type.
  const ap = Number(L.asking_price) || 0;
  const isRate = ap > 0 && ap < 1000;
  const inferredSale = !isRate && (ap >= 1000 || L.status === 'sold' || L.type === 'Land');
  const isSale = L.flyer_type === 'sale' ? true : L.flyer_type === 'lease' ? false : inferredSale;
  const badge = isSale ? 'FOR SALE' : 'FOR LEASE';
  const statPrice = ap <= 0 ? 'Call for pricing'
    : isSale ? money(ap)
    : isRate ? `$${ap.toFixed(2)} /SF/YR` : `${money(ap)} /YR`;
  const statSize = L.sq_ft ? `${Number(L.sq_ft).toLocaleString()} SF` : (L.lot_size ? String(L.lot_size) : '—');

  const address = [L.address, L.city, L.state, L.zip].filter(Boolean).join(', ') || L.name || 'Property';
  const residential = L.business_unit === 'residential';
  const unit = residential ? 'residential' : 'commercial';
  const web = residential ? 'fairoaksrealtygroup.com' : 'crecotx.com';

  // Maps. Geocode once per property and cache it on the listing, then render the
  // location + area maps from OSM tiles (falling back to Google only if a server key exists).
  // A pin set by hand on the listing always wins.
  let pt: { lat: number; lon: number } | null =
    (L.latitude != null && L.longitude != null) ? { lat: Number(L.latitude), lon: Number(L.longitude) } : null;
  if (!pt) {
    const g = await geocode(address);
    if (g) {
      pt = { lat: g.lat, lon: g.lon };
      // Only cache an address-level match. A street-level guess still draws a map for
      // this render but isn't saved, so it never masquerades as a confirmed pin.
      if (g.precise) await supabase.from('crm_listings')
        .update({ latitude: g.lat, longitude: g.lon, geocoded_at: new Date().toISOString() }).eq('id', id);
    }
  }
  const [mapBytes, aerialBytes] = await Promise.all([
    googleStaticMap({ center: address, zoom: '13', size: '272x214', scale: '2', maptype: 'roadmap', markers: `color:0xEE8A00|${address}` })
      .then(g => g ?? (pt ? osmStaticMap({ ...pt, zoom: 13, width: 544, height: 428 }) : null)),
    googleStaticMap({ center: address, zoom: '16', size: '576x444', scale: '2', maptype: 'satellite', markers: `color:0xEE8A00|${address}` })
      .then(g => g ?? (pt ? osmStaticMap({ ...pt, zoom: 16, width: 700, height: 540, source: 'satellite' }) : null)),
  ]);

  // IABS (required in TX). The disclosure names the licence holder, so the agent's
  // OWN form wins when there is one — it carries their name, licence number and
  // contact details. Agent files are unit-agnostic for that reason: the licence
  // doesn't change between commercial and residential.
  //
  // Order: listing agent → co-agent → the unit's shared form → the form library.
  let iabsPdf: Uint8Array | null = null;
  const grabIabs = async (path: string) => {
    const { data } = await supabase.storage.from('transaction-forms').download(path);
    return data ? new Uint8Array(await data.arrayBuffer()) : null;
  };
  for (const uid of [L.listing_agent_id, L.co_agent_id]) {
    if (!uid || iabsPdf) continue;
    iabsPdf = await grabIabs(`agents/iabs-${uid}.pdf`);
  }
  if (!iabsPdf) iabsPdf = await grabIabs(`${unit}/iabs-current.pdf`);
  if (!iabsPdf) {
    const { data: tpl } = await supabase.from('crm_forms').select('storage_path')
      .eq('business_unit', unit).ilike('name', '%Brokerage Services%').limit(1).maybeSingle();
    if (tpl?.storage_path) iabsPdf = await grabIabs(tpl.storage_path);
  }

  const nameOf = (a: Record<string, string> | null) => a ? `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() : '';
  const agentNames = [nameOf(agent), nameOf(coAgent)].filter(Boolean);
  const contacts = (coAgent
    ? [agent?.email, coAgent?.email, agent?.phone || coAgent?.phone]
    : [agent?.email, agent?.phone, web]).filter(Boolean) as string[];

  const bytes = await renderFlyer({
    badge, address,
    description: L.description || L.notes || '',
    highlights: String(L.highlights || '').split('\n').map(s => s.trim()).filter(Boolean),
    statPrice, statSize,
    agentNames,
    contacts,
    hero, galleryPhotos, mapBytes, aerialBytes, floorPlan, iabsPdf,
    fontBold: new Uint8Array(Buffer.from(OSWALD_BOLD_B64, 'base64')),
    logoPng: new Uint8Array(Buffer.from(CRECO_LOGO_PNG_B64, 'base64')),
  });

  // Keep it, so the next open is a download rather than a rebuild. A storage failure
  // must not lose the agent the flyer they just waited for — serve it either way.
  const path = `${id}/flyer/current.pdf`;
  const generatedAt = new Date().toISOString();
  const { error: upErr } = await supabase.storage.from('listing-files')
    .upload(path, Buffer.from(bytes), { contentType: 'application/pdf', upsert: true });
  if (upErr) console.error('[flyer] could not store flyer', upErr);
  else await supabase.from('crm_listings').update({ flyer_path: path, flyer_generated_at: generatedAt }).eq('id', id);

  return serve(bytes, upErr ? null : generatedAt);
}
