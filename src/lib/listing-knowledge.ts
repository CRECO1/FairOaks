// ─────────────────────────────────────────────────────────────────────────────
// What the voice bot knows about our listings.
//
// Commercial (CRECO): the live `listings` table behind crecotx.com, read with the
// site's public key (the same rows the website shows anyone). Turned into a
// compact fact sheet the bot can answer from — and ONLY from. Anything not on the
// sheet is "an agent will confirm".
//
// Cached in memory for a few minutes so a call's five or six turns don't hit the
// database five or six times, and the whole block is prompt-cached by Claude.
// ─────────────────────────────────────────────────────────────────────────────

export interface WebListing {
  title: string; slug: string; address: string; city: string; state?: string; zip?: string | null; submarket?: string | null;
  property_type: string; transaction_type: string; sale_price?: number | null; lease_rate?: number | null; lease_rate_basis?: string | null;
  sqft?: number | null; available_sqft?: number | null; lot_size?: number | null; zoning?: string | null; year_built?: number | null;
  clear_height?: number | null; dock_doors?: number | null; grade_doors?: number | null;
  headline?: string | null; description?: string | null; features?: string[] | null; status: string; listing_date?: string | null;
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; unit: string; listings: WebListing[] } | null = null;

const SITE: Record<string, { origin: string; url?: string; key?: string }> = {
  commercial: { origin: 'https://www.crecotx.com', url: process.env.CRECO_SUPABASE_URL, key: process.env.CRECO_SUPABASE_ANON_KEY },
};

export function listingSourceConfigured(unit: string): boolean {
  const s = SITE[unit];
  return !!(s?.url && s?.key);
}

export async function fetchListings(unit: string): Promise<WebListing[]> {
  const s = SITE[unit];
  if (!s?.url || !s?.key) return [];
  if (cache && cache.unit === unit && Date.now() - cache.at < TTL_MS) return cache.listings;
  const cols = 'title,slug,address,city,state,zip,submarket,property_type,transaction_type,sale_price,lease_rate,lease_rate_basis,sqft,available_sqft,lot_size,zoning,year_built,clear_height,dock_doors,grade_doors,headline,description,features,status,listing_date';
  try {
    const r = await fetch(`${s.url.replace(/\/$/, '')}/rest/v1/listings?select=${cols}&status=in.(active,pending)&order=listing_date.desc.nullslast&limit=60`, {
      headers: { apikey: s.key, Authorization: `Bearer ${s.key}` }, cache: 'no-store',
    });
    if (!r.ok) { console.warn('[listing-knowledge] fetch', r.status); return cache?.listings ?? []; }
    const rows = (await r.json()) as WebListing[];
    cache = { at: Date.now(), unit, listings: rows };
    return rows;
  } catch (e) { console.warn('[listing-knowledge]', e); return cache?.listings ?? []; }
}

const money = (n: number) => n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n % 1 ? n.toFixed(2) : n}`;
const typeWord: Record<string, string> = { warehouse: 'Warehouse/industrial', industrial: 'Industrial', office: 'Office', retail: 'Retail', flex: 'Flex', land: 'Land', multifamily: 'Multifamily', 'mixed-use': 'Mixed-use' };

function describe(l: WebListing, origin: string): string {
  const type = typeWord[l.property_type] || l.property_type.replace(/-/g, ' ');
  const txn = l.transaction_type === 'both' ? 'for lease or sale' : l.transaction_type === 'sale' ? 'for sale' : 'for lease';
  const bits: string[] = [];
  if (l.sqft) bits.push(`${l.sqft.toLocaleString('en-US')} SF${l.available_sqft && l.available_sqft !== l.sqft ? ` (${l.available_sqft.toLocaleString('en-US')} SF available)` : ''}`);
  if (l.lease_rate) bits.push(`lease rate ${money(l.lease_rate)}${l.lease_rate_basis ? ` ${l.lease_rate_basis}` : '/SF/yr'}`);
  if (l.sale_price) bits.push(`asking ${money(l.sale_price)}`);
  if (l.lot_size) bits.push(`${l.lot_size} acre lot`);
  if (l.zoning) bits.push(`zoned ${l.zoning}`);
  if (l.year_built) bits.push(`built ${l.year_built}`);
  if (l.clear_height) bits.push(`${l.clear_height}' clear height`);
  if (l.dock_doors) bits.push(`${l.dock_doors} dock door${l.dock_doors === 1 ? '' : 's'}`);
  if (l.grade_doors) bits.push(`${l.grade_doors} grade-level door${l.grade_doors === 1 ? '' : 's'}`);
  const where = [l.address, l.city, l.state].filter(Boolean).join(', ') + (l.submarket ? ` (${l.submarket})` : '');
  const desc = (l.description || '').replace(/\s+/g, ' ').trim();
  const lines = [
    `• ${l.title}${l.title !== l.address ? ` — ${where}` : ` — ${[l.city, l.state].filter(Boolean).join(', ')}${l.submarket ? ` (${l.submarket})` : ''}`}`,
    `  ${type} ${txn}${bits.length ? `: ${bits.join('; ')}` : ''}${l.status === 'pending' ? ' — PENDING (under contract / in negotiation)' : ''}`,
  ];
  if (l.headline) lines.push(`  Headline: ${l.headline}`);
  if (l.features?.length) lines.push(`  Features: ${l.features.slice(0, 12).join('; ')}`);
  if (desc) lines.push(`  Notes: ${desc.length > 420 ? desc.slice(0, 420) + '…' : desc}`);
  lines.push(`  Web page: ${origin}/listings/${l.slug}`);
  return lines.join('\n');
}

/** The fact sheet that goes into the bot's system prompt. Empty string when nothing is configured. */
export async function listingFactSheet(unit: string): Promise<{ text: string; count: number }> {
  const listings = await fetchListings(unit);
  if (!listings.length) return { text: '', count: 0 };
  const origin = SITE[unit]?.origin ?? '';
  const text = `CURRENT LISTINGS ON OUR WEBSITE (${listings.length}). These are the only property facts you may state. Prices, sizes and features come from here verbatim; if a caller asks something not listed for a property (e.g. parking count, HVAC, availability date, lease terms, whether an offer is in), say an agent will confirm and take their details.\n\n${listings.map(l => describe(l, origin)).join('\n\n')}`;
  return { text, count: listings.length };
}
