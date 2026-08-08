/**
 * Geocode Property DB rows that have an address but no lat/lng yet, so they
 * appear on the Property DB map. Free geocoders, no API key:
 *   1. US Census one-line geocoder (fast, US-only)
 *   2. OpenStreetMap Nominatim (fallback, rate-limited to ~1/sec)
 * Writes crm_prospective_properties.latitude/longitude via the Supabase REST API.
 */

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

/** Geocode up to `limit` un-geocoded, addressed properties. Returns counts. */
export async function geocodeMissing(limit = 25): Promise<{ geocoded: number; failed: number }> {
  if (!SUPABASE_URL) return { geocoded: 0, failed: 0 };
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_prospective_properties?select=id,address,city,state,zip`
    + `&business_unit=eq.commercial&latitude=is.null&address=not.is.null&limit=${limit}`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) return { geocoded: 0, failed: 0 };
  const rows: Row[] = await res.json();

  let geocoded = 0, failed = 0;
  for (const row of rows) {
    const q = [row.address, row.city, row.state || 'TX', row.zip].filter(Boolean).join(', ');
    let g = await census(q);
    if (!g) { await sleep(1100); g = await nominatim(q); }
    if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
      const up = await fetch(`${SUPABASE_URL}/rest/v1/crm_prospective_properties?id=eq.${row.id}`, {
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
