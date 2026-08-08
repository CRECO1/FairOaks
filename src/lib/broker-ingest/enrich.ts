/**
 * Derive County + Submarket for Property DB rows from their city/zip and write
 * them back, so the columns + map filters stay populated without manual entry.
 * Deterministic (no external API) — safe + fast to run every cron, right after
 * geocodeMissing(). New/unknown cities simply stay null until the map is extended.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();

function serviceHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

// TX city → county (primary county for suburbs that straddle county lines).
const CITY_COUNTY: Record<string, string> = {
  'boerne': 'Kendall', 'comfort': 'Kendall', 'fair oaks': 'Bexar', 'fair oaks ranch': 'Bexar',
  'san antonio': 'Bexar', 'castle hills': 'Bexar', 'leon springs': 'Bexar', 'helotes': 'Bexar',
  'converse': 'Bexar', 'universal city': 'Bexar', 'live oak': 'Bexar', 'selma': 'Bexar',
  'bulverde': 'Comal', 'spring branch': 'Comal', 'canyon lake': 'Comal', 'new braunfels': 'Comal',
  'schertz': 'Guadalupe', 'cibolo': 'Guadalupe', 'seguin': 'Guadalupe',
  'kerrville': 'Kerr', 'robstown': 'Nueces', 'lake jackson': 'Brazoria', 'lumberton': 'Hardin',
  'hutto': 'Williamson', 'colleyville': 'Tarrant', 'floresville': 'Wilson', 'pleasanton': 'Atascosa',
};
const ZIP_COUNTY: Record<string, string> = {
  '78006': 'Kendall', '78015': 'Bexar', '78163': 'Comal', '78130': 'Comal', '78132': 'Comal',
  '78154': 'Guadalupe', '78108': 'Guadalupe', '78380': 'Nueces', '78634': 'Williamson', '76034': 'Tarrant',
};
function zipCounty(zip?: string | null): string | null {
  if (!zip) return null;
  const z = String(zip).trim().slice(0, 5);
  if (ZIP_COUNTY[z]) return ZIP_COUNTY[z];
  if (z.startsWith('782')) return 'Bexar'; // San Antonio metro core
  return null;
}
function resolveCounty(city: string, zip?: string | null): string | null {
  return CITY_COUNTY[city] ?? zipCounty(zip);
}

// City → submarket cluster (San Antonio + Bexar enclaves collapse to "San Antonio").
const CITY_SUBMARKET: Record<string, string> = {
  'boerne': 'Boerne / Hill Country', 'comfort': 'Boerne / Hill Country',
  'fair oaks': 'Boerne / Hill Country', 'fair oaks ranch': 'Boerne / Hill Country',
  'bulverde': 'Bulverde / Spring Branch', 'spring branch': 'Bulverde / Spring Branch',
  'canyon lake': 'Canyon Lake / Comal', 'new braunfels': 'New Braunfels',
  'seguin': 'Seguin / Guadalupe', 'kerrville': 'Kerrville', 'helotes': 'Helotes / Far NW',
  'schertz': 'NE Corridor (Schertz–Cibolo–Selma)', 'cibolo': 'NE Corridor (Schertz–Cibolo–Selma)',
  'selma': 'NE Corridor (Schertz–Cibolo–Selma)',
};
function resolveSubmarket(city: string, county: string | null): string | null {
  if (CITY_SUBMARKET[city]) return CITY_SUBMARKET[city];
  if (city === 'san antonio' || county === 'Bexar') return 'San Antonio';
  if (city) return city.replace(/\b\w/g, c => c.toUpperCase()); // Title Case the city as a fallback
  return null;
}

interface Row { id: string; city?: string; zip?: string; county?: string | null; submarket?: string | null; }

/** Fill county/submarket on rows missing either. Returns how many rows were updated. */
export async function enrichMissing(limit = 300): Promise<{ enriched: number }> {
  if (!SUPABASE_URL) return { enriched: 0 };
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_prospective_properties?select=id,city,zip,county,submarket`
    + `&business_unit=eq.commercial&or=(county.is.null,submarket.is.null)&city=not.is.null&limit=${limit}`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) return { enriched: 0 };
  const rows: Row[] = await res.json();

  let enriched = 0;
  for (const row of rows) {
    const city = (row.city ?? '').trim().toLowerCase();
    if (!city) continue;
    const patch: Record<string, string> = {};
    if (!row.county) { const c = resolveCounty(city, row.zip); if (c) patch.county = c; }
    const county = row.county ?? patch.county ?? null;
    if (!row.submarket) { const s = resolveSubmarket(city, county); if (s) patch.submarket = s; }
    if (Object.keys(patch).length === 0) continue;
    const up = await fetch(`${SUPABASE_URL}/rest/v1/crm_prospective_properties?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...serviceHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (up.ok) enriched++;
  }
  return { enriched };
}
