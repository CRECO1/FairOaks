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

// ── Road names for an aerial window ──────────────────────────────────────────
// USGS imagery carries no street names, so the flyer names the roads itself: the
// named ways inside the very window osmStaticMap rendered (same centre/zoom/size,
// so they line up), fetched from OpenStreetMap via Overpass and placed along each
// road's longest visible run. Positions are image pixels from the top-left, `angle`
// is the PDF rotation (degrees, anticlockwise) that lays the text along the road,
// already flipped so it never reads upside down. The renderer maps them onto
// wherever it drew the image. Any failure → [] and the map simply has no names.
export interface MapLabel { text: string; x: number; y: number; angle: number; rank: number }

function unproject(x: number, y: number, z: number): LatLng {
  const n = TILE * Math.pow(2, z);
  return { lon: (x / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI };
}

// Which roads deserve a name: everything down to tertiary, plus the residential
// streets the property actually sits on (the ones passing close to the pin).
const ROAD_RANK: Record<string, number> = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, residential: 5, unclassified: 5 };
const ABBR: Array<[RegExp, string]> = [
  [/\bNortheast\b/g, 'NE'], [/\bNorthwest\b/g, 'NW'], [/\bSoutheast\b/g, 'SE'], [/\bSouthwest\b/g, 'SW'],
  [/\bNorth\b/g, 'N'], [/\bSouth\b/g, 'S'], [/\bEast\b/g, 'E'], [/\bWest\b/g, 'W'],
  [/\bStreet\b/g, 'St'], [/\bAvenue\b/g, 'Ave'], [/\bRoad\b/g, 'Rd'], [/\bDrive\b/g, 'Dr'], [/\bBoulevard\b/g, 'Blvd'],
  [/\bPlace\b/g, 'Pl'], [/\bLane\b/g, 'Ln'], [/\bCourt\b/g, 'Ct'], [/\bCircle\b/g, 'Cir'], [/\bParkway\b/g, 'Pkwy'],
  [/\bFreeway\b/g, 'Fwy'], [/\bHighway\b/g, 'Hwy'], [/\bExpressway\b/g, 'Expy'], [/\bTerrace\b/g, 'Ter'], [/\bTrail\b/g, 'Trl'],
];
const abbr = (name: string) => ABBR.reduce((t, [re, to]) => t.replace(re, to), name).replace(/\s+/g, ' ').trim();
// "I 10" → "I-10"; "US 87" stays; only the first of "I 10;US 87".
const refLabel = (ref: string) => ref.split(';')[0].trim().replace(/^I\s+(\d)/i, 'I-$1');

type Pt = { x: number; y: number };
// Liang–Barsky: the part of segment a→b inside the window, or null.
function clipSeg(a: Pt, b: Pt, W: number, H: number): [Pt, Pt] | null {
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x], [dx, W - a.x], [-dy, a.y], [dy, H - a.y]] as Array<[number, number]>) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}
const segLen = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
function ptSegDist(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}
// Point at arc length `s` along a polyline, and the local direction there (taken over
// a ±20px span so a kink in the centreline doesn't tilt the whole label).
function alongRun(pts: Pt[], s: number): { p: Pt; dir: Pt } {
  const at = (d: number): Pt => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = segLen(pts[i - 1], pts[i]);
      if (acc + L >= d || i === pts.length - 1) { const t = L ? Math.max(0, Math.min(1, (d - acc) / L)) : 0; return { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) }; }
      acc += L;
    }
    return pts[pts.length - 1];
  };
  const p = at(s), a = at(Math.max(0, s - 20)), b = at(s + 20);
  return { p, dir: { x: b.x - a.x, y: b.y - a.y } };
}

type NamedRoad = { tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> };
const ROAD_CLASSES = 'motorway|trunk|primary|secondary|tertiary|residential|unclassified';

// Named roads in a bbox. Overpass is the right tool, but overpass-api.de answers
// some networks with a flat 406 and the mirrors are slow, so after a short try the
// OSM API's own map call takes over — a bbox this small (~1.5 km) is a few thousand
// elements, well inside what that endpoint is meant to serve. Both are reduced to the
// same shape: tags + ordered lat/lon geometry.
async function fetchNamedRoads(b: { south: number; west: number; north: number; east: number }): Promise<NamedRoad[]> {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:8];way["highway"~"^(${ROAD_CLASSES})$"]["name"](${bbox});out geom;`;
  for (const ep of ['https://overpass-api.de/api/interpreter']) {
    try {
      const r = await fetch(ep, {
        method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const j = await r.json() as { elements?: NamedRoad[] };
      if (j.elements) return j.elements.filter(e => e.geometry?.length);
    } catch { /* next source */ }
  }
  try {
    const r = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${b.west},${b.south},${b.east},${b.north}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return [];
    const j = await r.json() as { elements?: Array<{ type: string; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string> }> };
    const nodes = new Map<number, { lat: number; lon: number }>();
    for (const e of j.elements ?? []) if (e.type === 'node' && e.lat != null && e.lon != null) nodes.set(e.id, { lat: e.lat, lon: e.lon });
    const cls = new RegExp(`^(${ROAD_CLASSES})$`);
    return (j.elements ?? [])
      .filter(e => e.type === 'way' && e.tags?.name && cls.test(e.tags.highway ?? ''))
      .map(e => ({ tags: e.tags, geometry: (e.nodes ?? []).map(id => nodes.get(id)).filter((n): n is { lat: number; lon: number } => !!n) }))
      .filter(e => e.geometry.length >= 2);
  } catch { return []; }
}

type RunLike = { text: string; rank: number; pts: Pt[]; len: number; dist: number; at: number };
function measure(text: string, rank: number, pts: Pt[], centre?: Pt): RunLike {
  let len = 0, dist = Infinity, at = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = segLen(pts[i - 1], pts[i]);
    if (centre) {
      const d = ptSegDist(centre, pts[i - 1], pts[i]);
      if (d < dist) {
        dist = d;
        const l2 = L * L, t = l2 ? Math.max(0, Math.min(1, ((centre.x - pts[i - 1].x) * (pts[i].x - pts[i - 1].x) + (centre.y - pts[i - 1].y) * (pts[i].y - pts[i - 1].y)) / l2)) : 0;
        at = len + t * L;
      }
    }
    len += L;
  }
  return { text, rank, pts, len, dist, at };
}
// OSM splits a street into a way per block, so "West French Place" arrives as a dozen
// short pieces. Chain the pieces of each name that meet end to end back into one
// polyline, so a street is measured (and labelled) as the street, not as its
// shortest fragment.
function joinRuns(runs: RunLike[], centre: Pt): RunLike[] {
  const byName = new Map<string, RunLike[]>();
  for (const r of runs) { const arr = byName.get(r.text) ?? []; arr.push(r); byName.set(r.text, arr); }
  const out: RunLike[] = [];
  const touch = (a: Pt, b: Pt) => segLen(a, b) < 8;   // pieces meet at an intersection node, or a few px either side of one
  for (const group of byName.values()) {
    const chains = group.map(r => r.pts.slice());
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < chains.length; i++) for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        const a = chains[i], b = chains[j];
        let joined: Pt[] | null = null;
        if (touch(a[a.length - 1], b[0])) joined = a.concat(b.slice(1));
        else if (touch(b[b.length - 1], a[0])) joined = b.concat(a.slice(1));
        else if (touch(a[a.length - 1], b[b.length - 1])) joined = a.concat(b.slice(0, -1).reverse());
        else if (touch(a[0], b[0])) joined = a.slice().reverse().concat(b.slice(1));
        if (joined) { chains[i] = joined; chains.splice(j, 1); merged = true; break outer; }
      }
    }
    for (const c of chains) out.push(measure(group[0].text, group[0].rank, c, centre));
  }
  return out;
}

export async function roadLabels(opts: { lat: number; lon: number; zoom: number; width: number; height: number; source?: MapSource }): Promise<MapLabel[]> {
  const { lat, lon, width: W, height: H, source = 'satellite' } = opts;
  const z = Math.min(opts.zoom, SOURCES[source].maxZoom);
  try {
    const c = project(lat, lon, z);
    const left = c.x - W / 2, top = c.y - H / 2;
    const nw = unproject(left, top, z), se = unproject(left + W, top + H, z);
    const elements = await fetchNamedRoads({ south: se.lat, west: nw.lon, north: nw.lat, east: se.lon });

    // Visible runs per road name. A road that leaves the window and comes back is two runs.
    type Run = { text: string; rank: number; pts: Pt[]; len: number; dist: number; at: number };   // at = arc length of the closest approach to the pin
    const centre: Pt = { x: W / 2, y: H / 2 };
    const runs: Run[] = [];
    for (const el of elements) {
      const t = el.tags ?? {}; const rank = ROAD_RANK[t.highway ?? ''];
      if (rank === undefined || !t.name || !el.geometry || el.geometry.length < 2) continue;
      const name = abbr(t.name);
      const text = rank <= 1 && t.ref ? `${refLabel(t.ref)} · ${name}` : name;
      const pts = el.geometry.map(g => { const p = project(g.lat, g.lon, z); return { x: p.x - left, y: p.y - top }; });
      let cur: Pt[] = [];
      const flush = () => { if (cur.length >= 2) runs.push(measure(text, rank, cur, centre)); cur = []; };
      for (let i = 1; i < pts.length; i++) {
        const seg = clipSeg(pts[i - 1], pts[i], W, H);
        if (!seg) { flush(); continue; }
        const [a, b] = seg;
        const last = cur[cur.length - 1];
        if (!last || segLen(last, a) > 0.5) { flush(); cur = [a, b]; } else cur.push(b);
      }
      flush();
    }

    // One run per road. A road tagged two ways (freeway + frontage, or under two
    // classes) keeps the higher-ranked spelling — that's the one carrying the route
    // number. Roads passing the pin keep their *nearest* run, everything else its
    // longest. Then the roads the property actually sits on go first (the nearest
    // four, whatever their class — they're the point of the exercise), and the rest
    // follow by class and length.
    const NEAR = 120;
    const plain = (t: string) => t.replace(/^.*\u00b7\s*/, '');
    const best = new Map<string, Run>();
    for (const run of joinRuns(runs, centre)) {
      const key = plain(run.text), b = best.get(key);
      const near = run.dist <= NEAR, bNear = !!b && b.dist <= NEAR;
      const better = !b || run.rank < b.rank || (run.rank === b.rank && (
        (near && !bNear) || (near && bNear && run.dist < b.dist) || (!near && !bNear && run.len > b.len)));
      if (better) best.set(key, run);
    }
    const all = [...best.values()].filter(r => r.len >= 50);
    const nearest = all.filter(r => r.dist <= NEAR).sort((a, b) => a.dist - b.dist).slice(0, 4);
    const rest = all.filter(r => !nearest.includes(r) && ((r.rank <= 4 && r.len >= 60) || r.dist <= NEAR))
      .sort((a, b) => Number(a.dist > NEAR) - Number(b.dist > NEAR) || a.rank - b.rank || b.len - a.len);   // the rest of the property's streets, then by class
    const chosen = [...nearest, ...rest];

    // Place each label along its run — midpoint first, then either side — skipping
    // any spot that would sit on another label, the SITE pin, or the credit strip.
    const charW = 6.5, lineH = 13;                                  // label footprint, image px (generous: the renderer sizes text by page width, not image width)
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [
      { x0: centre.x - 20, y0: centre.y - 50, x1: centre.x + 20, y1: centre.y + 6 },   // pin
      { x0: 0, y0: H - 16, x1: W, y1: H },                                              // attribution
    ];
    const out: MapLabel[] = [];
    for (const run of chosen) {
      const tw = run.text.length * charW;
      if (tw > run.len * 0.9) continue;                                // name longer than the visible road
      let hit: MapLabel | null = null;
      // A road that passes the property is named right beside it (either side of the
      // pin, then a little further out); any other road at its midpoint, then off-centre.
      const spots = run.dist <= NEAR
        ? [run.at + 60, run.at - 60, run.at + 110, run.at - 110, run.len * 0.5, run.len * 0.35, run.len * 0.65]
        : [0.5, 0.35, 0.65, 0.2, 0.8].map(f => run.len * f);
      for (const sAt of spots) {
        if (sAt < 0 || sAt > run.len) continue;
        const { p, dir } = alongRun(run.pts, sAt);
        if (!dir.x && !dir.y) continue;
        const th = Math.atan2(dir.y, dir.x);                           // image space (y down)
        let angle = (-th * 180) / Math.PI;                             // PDF space (y up)
        if (angle > 90) angle -= 180; else if (angle <= -90) angle += 180;
        const cos = Math.abs(Math.cos(th)), sin = Math.abs(Math.sin(th));
        const hw = (tw * cos + lineH * sin) / 2, hh = (tw * sin + lineH * cos) / 2;
        const box = { x0: p.x - hw, y0: p.y - hh, x1: p.x + hw, y1: p.y + hh };
        if (box.x0 < 4 || box.y0 < 4 || box.x1 > W - 4 || box.y1 > H - 4) continue;
        if (placed.some(o => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0)) continue;
        placed.push(box); hit = { text: run.text, x: p.x, y: p.y, angle, rank: run.rank }; break;
      }
      if (!hit) continue;
      out.push(hit);
      if (out.length >= 11) break;
    }
    return out;
  } catch { return []; }
}
