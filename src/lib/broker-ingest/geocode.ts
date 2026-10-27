/**
 * Geocode Property DB rows that have an address but no lat/lng yet, so they
 * appear on the Property DB map. Free geocoders, no API key:
 *   1. US Census one-line geocoder (fast, US-only)
 *   2. OpenStreetMap Nominatim (fallback, rate-limited to ~1/sec)
 * Writes crm_prospective_properties.latitude/longitude via the Supabase REST API.
 */

import { buildQueries, cleanAddress, median, plausible } from './geocode-util';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();

function serviceHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function census(q: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`,
    );
    const j = await r.json();
    const m = j?.result?.addressMatches?.[0];
    if (m) return { lat: m.coordinates.y as number, lng: m.coordinates.x as number };
  } catch { /* ignore */ }
  return null;
}

async function nominatim(q: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`,
      { headers: { 'User-Agent': 'FairOaksCRM/1.0 (creco)' } },
    );
    const j = await r.json();
    if (Array.isArray(j) && j[0]) return { lat: +j[0].lat, lng: +j[0].lon };
  } catch { /* ignore */ }
  return null;
}

interface Row { id: string; address: string; city?: string; state?: string; zip?: string; }

/**
 * Geocode up to `limit` un-geocoded, addressed properties. Returns counts.
 *
 * WHY IT ROTATES. This used to take the first `limit` rows in table order every run. Those were the
 * ones brokers gave as cross-streets or names ("FM 1460 & Westinghouse Rd", "Finial Portfolio") that
 * no free geocoder can place, so the SAME rows failed every run and the ~600 ordinary addresses behind
 * them never got a turn. Now each run looks at a different window of the backlog (the window moves on
 * every 4 hours), addresses are cleaned first, and a match is only kept if it is plausible — in Texas
 * and near the city's other properties — so a same-named road in another town is not pinned.
 */
export async function geocodeMissing(limit = 25): Promise<{ geocoded: number; failed: number }> {
  if (!SUPABASE_URL) return { geocoded: 0, failed: 0 };
  const base = `${SUPABASE_URL}/rest/v1/crm_prospective_properties`;
  const where = 'business_unit=eq.commercial&latitude=is.null&address=not.is.null&address=neq.';

  const countRes = await fetch(`${base}?select=id&${where}`, { headers: { ...serviceHeaders(), Prefer: 'count=exact', Range: '0-0' } });
  const total = Number((countRes.headers.get('content-range') || '').split('/')[1]) || 0;
  if (!total) return { geocoded: 0, failed: 0 };
  const slot = Math.floor(Date.now() / (4 * 3_600_000));
  const offset = total > limit ? (slot * limit) % total : 0;

  const res = await fetch(
    `${base}?select=id,address,city,state,zip&${where}&order=created_at.desc&limit=${limit}&offset=${offset}`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) return { geocoded: 0, failed: 0 };
  const rows: Row[] = await res.json();

  // Where each city's already-placed properties sit — the sanity check for a new match.
  const cities = Array.from(new Set(rows.map(r => (r.city || '').trim()).filter(Boolean)));
  const centres = new Map<string, { lat: number; lng: number }>();
  if (cities.length) {
    const list = cities.map(c => `"${c.replace(/"/g, '')}"`).join(',');
    const pr = await fetch(`${base}?select=city,latitude,longitude&city=in.(${encodeURIComponent(list)})&latitude=not.is.null&limit=3000`, { headers: serviceHeaders() });
    if (pr.ok) {
      const pts: { city: string; latitude: number; longitude: number }[] = await pr.json();
      const by = new Map<string, { la: number[]; lo: number[] }>();
      for (const p of pts) {
        const k = (p.city || '').trim().toLowerCase();
        const e = by.get(k) ?? { la: [], lo: [] };
        e.la.push(p.latitude); e.lo.push(p.longitude); by.set(k, e);
      }
      for (const [k, e] of by) if (e.la.length >= 3) centres.set(k, { lat: median(e.la), lng: median(e.lo) });
    }
  }

  let geocoded = 0, failed = 0;
  for (const row of rows) {
    const { census: cq, fallback } = buildQueries(row);
    if (!cleanAddress(row.address)) { failed++; continue; }
    const centre = centres.get((row.city || '').trim().toLowerCase()) ?? null;
    let g = cq ? await census(cq) : null;
    if (g && !plausible(g, centre)) g = null;
    if (!g && fallback) {
      await sleep(1100);
      g = await nominatim(fallback);
      if (g && !plausible(g, centre)) g = null;
    }
    if (g) {
      const up = await fetch(`${base}?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...serviceHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({ latitude: g.lat, longitude: g.lng }),
      });
      if (up.ok) geocoded++; else failed++;
    } else {
      failed++;
    }
    await sleep(150);
  }
  return { geocoded, failed };
}
