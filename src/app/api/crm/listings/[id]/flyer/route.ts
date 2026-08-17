import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { renderFlyer } from '@/lib/flyer-doc';
import { OSWALD_BOLD_B64, CRECO_LOGO_PNG_B64 } from '@/lib/flyer-assets';

export const dynamic = 'force-dynamic';

function money(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? '$' + v.toLocaleString('en-US') : '';
}

// Fetch a Google Static Map as PNG bytes; null if the API is off / key restricted /
// any error, so the flyer degrades to a clean placeholder instead of failing.
async function staticMap(params: Record<string, string>): Promise<Uint8Array | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const qs = new URLSearchParams({ ...params, key }).toString();
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${qs}`);
    if (!r.ok) return null;
    if (!(r.headers.get('content-type') || '').includes('image')) return null;
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

  const loadAgent = async (uid?: string | null) => uid
    ? (await supabase.from('crm_profiles').select('first_name, last_name, email, phone').eq('id', uid).maybeSingle()).data as Record<string, string> | null
    : null;
  const [agent, coAgent] = await Promise.all([loadAgent(L.listing_agent_id), loadAgent(L.co_agent_id)]);

  // Hero (first photo) + floor plan (first floor_plan image).
  const { data: files } = await supabase.from('crm_listing_files').select('storage_path, file_type, category').eq('listing_id', id);
  const pickImage = async (match: (f: { category?: string; file_type?: string }) => boolean) => {
    for (const f of (files ?? []).filter(match)) {
      const ft = (f.file_type || '').toLowerCase();
      const png = ft.includes('png'), jpg = ft.includes('jpeg') || ft.includes('jpg');
      if (!png && !jpg) continue;
      const { data: blob } = await supabase.storage.from('listing-files').download(f.storage_path);
      if (blob) return { bytes: new Uint8Array(await blob.arrayBuffer()), png };
    }
    return null;
  };
  const hero = await pickImage(f => f.category === 'photo' || (f.file_type || '').startsWith('image/'));
  const floorPlan = await pickImage(f => f.category === 'floor_plan');

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
  const web = residential ? 'fairoaksrealtygroup.com' : 'crecotx.com';

  // Static maps (auto if the key has Maps Static API enabled; else null → placeholder).
  const [mapBytes, aerialBytes] = await Promise.all([
    staticMap({ center: address, zoom: '13', size: '272x172', scale: '2', maptype: 'roadmap', markers: `color:0xEE8A00|${address}` }),
    staticMap({ center: address, zoom: '16', size: '576x330', scale: '2', maptype: 'satellite', markers: `color:0xEE8A00|${address}` }),
  ]);

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
    hero, mapBytes, aerialBytes, floorPlan,
    fontBold: new Uint8Array(Buffer.from(OSWALD_BOLD_B64, 'base64')),
    logoPng: new Uint8Array(Buffer.from(CRECO_LOGO_PNG_B64, 'base64')),
  });

  const fname = (L.name || L.address || 'listing').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 50) || 'flyer';
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fname}-flyer.pdf"` },
  });
}
