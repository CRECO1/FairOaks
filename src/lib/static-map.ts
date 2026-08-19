// ─────────────────────────────────────────────────────────────────────────────
// Server-side static maps without a Google key.
//
// The account's Google key is referrer-restricted (so it can't be used from a
// server at all) and Maps Static isn't enabled on the project, which is why the
// flyer's map slots came out empty. This renders the map ourselves: geocode with
// Nominatim, stitch OpenStreetMap raster tiles with sharp, drop a pin, and stamp
// the required attribution. If a server-side Google key is ever provisioned
// (GOOGLE_MAPS_SERVER_KEY) the caller can prefer that instead.
// ─────────────────────────────────────────────────────────────────────────────
import sharp from 'sharp';

const UA = 'CRECO-CRM/1.0 (https://www.crecotx.com; property flyer generator)';
const TILE = 256;

export interface LatLng { lat: number; lon: number }
// `precise` = matched to an actual street address (Census). false = we only found the
// street or locality, which is fine for context but shouldn't be trusted as a pin.
export interface GeocodeResult extends LatLng { precise: boolean }

// Geocoding, best source first. The US Census geocoder is free, keyless and built
// for US street addresses, so it resolves actual buildings; Nominatim is the
// fallback but often only knows the STREET, in which case it returns an arbitrary
// point along it — fine for context, wrong for a pin. Anything that has to be exact
// should be pinned by hand on the listing (crm_listings.latitude/longitude), which
// always wins over both of these.
async function censusGeocode(address: string): Promise<LatLng | null> {
  try {
    const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' +
      new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' });
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const j = await r.json() as { result?: { addressMatches?: Array<{ coordinates: { x: number; y: number } }> } };
    const m = j?.result?.addressMatches?.[0];
    return m ? { lat: m.coordinates.y, lon: m.coordinates.x } : null;
  } catch { return null; }
}

async function nominatimGeocode(address: string): Promise<LatLng | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
    if (!r.ok) return null;
    const j = await r.json() as Array<{ lat: string; lon: string }>;
    if (!j?.length) return null;
    const lat = Number(j[0].lat), lon = Number(j[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch { return null; }
}

export async function geocode(address: string): Promise<GeocodeResult | null> {
  if (!address?.trim()) return null;
  const exact = await censusGeocode(address);
  if (exact) return { ...exact, precise: true };
  const approx = await nominatimGeocode(address);
  return approx ? { ...approx, precise: false } : null;
}

// Parse a pin pasted from Google Maps — "29.7255, -98.6526" (and tolerates parens).
export function parsePin(v: string): LatLng | null {
  const m = String(v || '').match(/(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

// Web-mercator world pixel coordinates at a given zoom.
function project(lat: number, lon: number, z: number) {
  const n = TILE * Math.pow(2, z);
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
}

export type MapSource = 'street' | 'satellite';
// USGS imagery is public domain and covers the US; it tops out around z16 in most
// areas, so callers' satellite zoom is clamped to what the source actually has.
const SOURCES: Record<MapSource, { url: (z: number, x: number, y: number) => string; credit: string; maxZoom: number }> = {
  street: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, credit: '© OpenStreetMap contributors', maxZoom: 19 },
  // ArcGIS tiles are addressed row-then-column, i.e. /{z}/{y}/{x} — not the OSM order.
  satellite: { url: (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`, credit: 'Imagery: USGS National Map', maxZoom: 16 },
};

async function tile(z: number, x: number, y: number, src: MapSource): Promise<Buffer | null> {
  const max = Math.pow(2, z);
  if (y < 0 || y >= max) return null;
  const wrapped = ((x % max) + max) % max;   // wrap the antimeridian
  try {
    const r = await fetch(SOURCES[src].url(z, wrapped, y), { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

// Render a map centred on lat/lon. Returns PNG bytes, or null if tiles wouldn't load.
export async function osmStaticMap(opts: { lat: number; lon: number; zoom: number; width: number; height: number; marker?: boolean; source?: MapSource }): Promise<Uint8Array | null> {
  const { lat, lon, width: W, height: H, marker = true, source = 'street' } = opts;
  const z = Math.min(opts.zoom, SOURCES[source].maxZoom);
  try {
    const c = project(lat, lon, z);
    const left = c.x - W / 2, top = c.y - H / 2;
    const x0 = Math.floor(left / TILE), y0 = Math.floor(top / TILE);
    const x1 = Math.floor((left + W - 1) / TILE), y1 = Math.floor((top + H - 1) / TILE);
    const cols = x1 - x0 + 1, rows = y1 - y0 + 1;
    if (cols * rows > 40) return null;                    // guard against silly sizes

    const tiles = await Promise.all(
      Array.from({ length: cols * rows }, (_, i) => tile(z, x0 + (i % cols), y0 + Math.floor(i / cols), source)),
    );
    if (!tiles.some(Boolean)) return null;                // nothing loaded — caller falls back

    const canvasW = cols * TILE, canvasH = rows * TILE;
    const composites = tiles.flatMap((buf, i) => buf
      ? [{ input: buf, left: (i % cols) * TILE, top: Math.floor(i / cols) * TILE }]
      : []);
    let img = sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: '#e8e6e1' } })
      .composite(composites).png();

    // crop the requested window out of the tile grid
    const offX = Math.round(left - x0 * TILE), offY = Math.round(top - y0 * TILE);
    img = sharp(await img.toBuffer()).extract({
      left: Math.max(0, Math.min(offX, canvasW - W)), top: Math.max(0, Math.min(offY, canvasH - H)),
      width: Math.min(W, canvasW), height: Math.min(H, canvasH),
    });

    // pin + attribution (OSM requires the credit)
    const pinH = 46, cx = Math.round(W / 2), cy = Math.round(H / 2);
    const overlay = Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
      (marker
        ? `<g transform="translate(${cx - 17},${cy - pinH})">
             <path d="M17 46 C17 46 34 24 34 17 A17 17 0 1 0 0 17 C0 24 17 46 17 46 Z" fill="#EE8A00" stroke="#fff" stroke-width="2.5"/>
             <text x="17" y="23" font-family="Helvetica,Arial,sans-serif" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle">SITE</text>
           </g>`
        : '') +
      `<rect x="0" y="${H - 15}" width="${W}" height="15" fill="#ffffff" opacity="0.8"/>
       <text x="${W - 5}" y="${H - 4}" font-family="Helvetica,Arial,sans-serif" font-size="9" fill="#4b5563" text-anchor="end">${SOURCES[source].credit}</text>
     </svg>`);
    return new Uint8Array(await img.composite([{ input: overlay, left: 0, top: 0 }]).png().toBuffer());
  } catch { return null; }
}
