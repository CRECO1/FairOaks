// ─────────────────────────────────────────────────────────────────────────────
// What the voice bot knows about our listings.
//
// Commercial (CRECO): the live `listings` table behind crecotx.com, read with the
// site's public key (the same rows the website shows anyone). Turned into a
// compact fact sheet the bot can answer from — and ONLY from. Anything not on the
// sheet is "an agent will confirm".
//
// ALSO the CRM's own property table (`crm_listings`, commercial workspace): CRECO's
// development, pre-leasing, land and off-website inventory (Elkhorn Point, the back
// lot, 8000 Fair Oaks Pkwy…) is NOT all on the public site, and a caller who asks
// about one of our properties must never be told it isn't ours. Add a property in
// the CRM and the bot knows it within ~5 minutes. Spoken-only extras the CRM has no
// field for (who to ask for) live in PROPERTY_NOTES below.
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
  if (unit === 'residential') return true; // the MLS feed lives in our own database
  const s = SITE[unit];
  return !!(s?.url && s?.key);
}

// ── Residential: the SABOR MLS feed in our own `listings` table ───────────────
// ~10k active homes — far too many for a prompt, so the bot gets a small sheet of
// OUR OWN listings plus a lookup tool for everything else on the MLS.
import { adminClient } from '@/lib/supabase-admin';

export interface HomeListing {
  title: string; slug: string; status: string; price: number | null; address: string; city: string; state: string | null; zip: string | null;
  bedrooms: number | null; bathrooms: number | null; sqft: number | null; lot_size_acres: number | null; year_built: number | null;
  property_type: string | null; subdivision_name: string | null; mls_number: string | null; hoa_fee: number | null; hoa_frequency: string | null;
  list_agent_name: string | null; list_office_name: string | null; description: string | null; listing_date: string | null; standard_status: string | null;
}
const HOME_COLS = 'title, slug, status, price, address, city, state, zip, bedrooms, bathrooms, sqft, lot_size_acres, year_built, property_type, subdivision_name, mls_number, hoa_fee, hoa_frequency, list_agent_name, list_office_name, description, listing_date, standard_status';
const OUR_OFFICES = ['%fair oaks realty%', '%arrows property%'];
const RES_ORIGIN = 'https://www.fairoaksrealtygroup.com';

const usd = (n: number | null | undefined) => n == null ? null : `$${Math.round(Number(n)).toLocaleString('en-US')}`;
const homeType: Record<string, string> = { sfd: 'Single-family home', sfdet: 'Single-family home', sfr: 'Single-family home', res: 'Home', condo: 'Condo', townhome: 'Townhome', townhouse: 'Townhome', land: 'Lot / land', lot: 'Lot / land', multifamily: 'Multifamily', farm: 'Farm / ranch', ranch: 'Farm / ranch' };

export function describeHome(h: HomeListing, opts: { ours?: boolean } = {}): string {
  const bits: string[] = [];
  if (h.price) bits.push(usd(h.price)!);
  if (h.bedrooms) bits.push(`${h.bedrooms} bed`);
  if (h.bathrooms) bits.push(`${h.bathrooms} bath`);
  if (h.sqft) bits.push(`${Number(h.sqft).toLocaleString('en-US')} SF`);
  if (h.lot_size_acres) bits.push(`${h.lot_size_acres} acre lot`);
  if (h.year_built) bits.push(`built ${h.year_built}`);
  if (h.hoa_fee) bits.push(`HOA ${usd(h.hoa_fee)}${h.hoa_frequency ? `/${h.hoa_frequency}` : ''}`);
  const status = (h.standard_status || h.status || '').toUpperCase().replace(/_/g, ' ');
  const type = homeType[(h.property_type || '').toLowerCase()] || h.property_type || 'Home';
  const where = [h.address, h.city, h.state, h.zip].filter(Boolean).join(', ') + (h.subdivision_name ? ` (${h.subdivision_name})` : '');
  const desc = (h.description || '').replace(/\s+/g, ' ').trim();
  const lines = [
    `• ${where}${h.mls_number ? ` — MLS# ${h.mls_number}` : ''}`,
    `  ${type}: ${bits.join('; ')}${status ? ` — ${status}` : ''}${opts.ours ? ' — OUR LISTING' : h.list_office_name ? ` — listed by ${h.list_office_name}${h.list_agent_name ? ` (${h.list_agent_name})` : ''}` : ''}`,
  ];
  if (desc) lines.push(`  Notes: ${desc.length > 300 ? desc.slice(0, 300) + '…' : desc}`);
  lines.push(`  Web page: ${RES_ORIGIN}/listings/${h.slug}`);
  return lines.join('\n');
}

let resCache: { at: number; homes: HomeListing[] } | null = null;
/** Our own residential listings (Fair Oaks Realty Group + Arrows Property Management) — the small sheet. */
export async function fetchOurHomes(): Promise<HomeListing[]> {
  if (resCache && Date.now() - resCache.at < TTL_MS) return resCache.homes;
  try {
    const db = adminClient();
    const { data } = await db.from('listings').select(HOME_COLS).in('status', ['active', 'pending'])
      .or(OUR_OFFICES.map(o => `list_office_name.ilike.${o}`).join(',')).order('listing_date', { ascending: false }).limit(40);
    resCache = { at: Date.now(), homes: (data ?? []) as HomeListing[] };
    return resCache.homes;
  } catch (e) { console.warn('[listing-knowledge] our homes', e); return resCache?.homes ?? []; }
}

export interface HomeSearch { mls_number?: string; address?: string; city?: string; zip?: string; subdivision?: string; min_beds?: number; max_price?: number; min_price?: number; property_type?: string }
/** Look up homes on the MLS feed for the bot's tool. Returns up to 5 matches. */
export async function searchHomes(q: HomeSearch): Promise<HomeListing[]> {
  const db = adminClient();
  let query = db.from('listings').select(HOME_COLS).in('status', ['active', 'pending']);
  const like = (v: string) => `%${v.replace(/[%,()*]/g, ' ').trim()}%`;
  if (q.mls_number) query = query.eq('mls_number', q.mls_number.replace(/\D/g, ''));
  else {
    if (q.address) query = query.ilike('address', like(q.address));
    if (q.city) query = query.ilike('city', like(q.city));
    if (q.zip) query = query.eq('zip', q.zip.replace(/\D/g, '').slice(0, 5));
    if (q.subdivision) query = query.ilike('subdivision_name', like(q.subdivision));
    if (q.min_beds) query = query.gte('bedrooms', q.min_beds);
    if (q.max_price) query = query.lte('price', q.max_price);
    if (q.min_price) query = query.gte('price', q.min_price);
    if (q.property_type) query = query.ilike('property_type', like(q.property_type));
  }
  const { data, error } = await query.order('listing_date', { ascending: false }).limit(5);
  if (error) { console.warn('[listing-knowledge] search', error); return []; }
  return (data ?? []) as HomeListing[];
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

// ── The CRM's own commercial inventory (crm_listings) ─────────────────────────
interface CrmProperty {
  name: string; address: string | null; city: string | null; state: string | null; zip: string | null; type: string | null; status: string | null;
  asking_price: number | null; sq_ft: number | null; lot_size: string | null; zoning: string | null; year_built: number | null;
  description: string | null; highlights: string | null;
}
const CRM_COLS = 'name, address, city, state, zip, type, status, asking_price, sq_ft, lot_size, zoning, year_built, description, highlights';

/**
 * Spoken-only extras the CRM has no field for. Keyed by a pattern on the property name;
 * add a line here when a property needs "who to ask for" or a caller-facing caveat.
 * Everything else about a property comes from its CRM record automatically.
 */
const PROPERTY_NOTES: { match: RegExp; note: string }[] = [
  { match: /elkhorn point/i, note: 'Elkhorn Point is CRECO\'s own commercial development at 8923 Dietz Elkhorn Rd in Fair Oaks Ranch (elkhornpoint.com): two ±10,000 SF retail buildings now pre-leasing, plus a ±2 acre back lot offered for sale, ground lease or build-to-suit. The brokers are Zachary Stovall and Brian Blanco, (210) 817-3443 — give that number only if the caller asks for it; otherwise take their details and an agent will call.' },
];

let crmCache: { at: number; unit: string; rows: CrmProperty[] } | null = null;
/** CRECO's inventory straight from the CRM. Restricted folders stay private. */
export async function fetchCrmProperties(unit: string): Promise<CrmProperty[]> {
  if (crmCache && crmCache.unit === unit && Date.now() - crmCache.at < TTL_MS) return crmCache.rows;
  try {
    const { data, error } = await adminClient().from('crm_listings').select(CRM_COLS)
      .eq('business_unit', unit).eq('is_restricted', false).order('created_at', { ascending: false }).limit(80);
    if (error) throw error;
    crmCache = { at: Date.now(), unit, rows: (data ?? []) as CrmProperty[] };
    return crmCache.rows;
  } catch (e) { console.warn('[listing-knowledge] crm properties', e); return crmCache?.unit === unit ? crmCache.rows : []; }
}

/** "8923 Dietz Elkhorn Rd" ≈ "8923 DIETZ ELKHORN ROAD": street number + first street word. */
const addrKey = (a: string | null | undefined) => {
  const m = String(a ?? '').toLowerCase().match(/(\d+)\s+(?:[nsew]\.?\s+)?([a-z]+)/);
  return m ? `${m[1]} ${m[2]}` : '';
};
const isLive = (s: string | null) => !s || /^(active|pending|under[ _-]?contract)$/i.test(s);

function describeCrm(p: CrmProperty): string {
  const live = isLive(p.status);
  const where = [p.address, p.city, p.state].filter(Boolean).join(', ');
  const bits: string[] = [];
  if (p.sq_ft) bits.push(`${Number(p.sq_ft).toLocaleString('en-US')} SF`);
  if (p.lot_size) bits.push(`${/acre|ac\b/i.test(p.lot_size) ? p.lot_size : `${p.lot_size} acres`} of land`);
  if (p.zoning) bits.push(`zoned ${p.zoning}`);
  if (p.year_built) bits.push(`built ${p.year_built}`);
  // asking_price holds a sale price OR a per-SF lease rate depending on the property, so a small
  // number is never read out as dollars; the agent confirms.
  if (p.asking_price) bits.push(p.asking_price >= 1000 ? `asking ${money(p.asking_price)}` : 'pricing: an agent will confirm');
  const status = !live ? ` — ${String(p.status).toUpperCase()} (no longer available; offer an agent to discuss other space)` : String(p.status).toLowerCase() === 'pending' ? ' — PENDING' : '';
  const lines = [`• ${p.name}${where ? ` — ${where}` : ''}`, `  ${p.type || 'Commercial property'}${bits.length ? `: ${bits.join('; ')}` : ''}${status}`];
  if (live) {
    const desc = (p.description || '').replace(/\s+/g, ' ').trim();
    if (desc) lines.push(`  Notes: ${desc.length > 520 ? desc.slice(0, 520) + '…' : desc}`);
    const hl = (p.highlights || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 8);
    if (hl.length) lines.push(`  Highlights: ${hl.join('; ')}`);
  }
  const extra = PROPERTY_NOTES.filter(n => n.match.test(p.name)).map(n => n.note);
  for (const n of new Set(extra)) lines.push(`  Agent note: ${n}`);
  return lines.join('\n');
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
  if (unit === 'residential') {
    const homes = await fetchOurHomes();
    if (!homes.length) return { text: 'OUR OWN LISTINGS: none active right now. Use the lookup_listings tool to answer questions about any home on the MLS.', count: 0 };
    return {
      text: `OUR OWN LISTINGS (${homes.length}) — homes Fair Oaks Realty Group is marketing. For ANY other home a caller asks about (an address they drove past, an MLS number, "3 beds under 400 in Boerne"), use the lookup_listings tool; we can show any home on the MLS.\n\n${homes.map(h => describeHome(h, { ours: true })).join('\n\n')}`,
      count: homes.length,
    };
  }
  const [web, crm] = await Promise.all([fetchListings(unit), fetchCrmProperties(unit)]);
  if (!web.length && !crm.length) return { text: '', count: 0 };
  const origin = SITE[unit]?.origin ?? '';
  // A property on both lists is described once, from the website row (it carries lease basis etc.).
  // Same street number + street word AND a shared name stem, so two products at one address
  // (Elkhorn Point's retail vs its back lot) are never mistaken for each other.
  const stem = (t: string) => t.toLowerCase().split(/\s+[—-]\s+/)[0].replace(/[^a-z0-9]/g, '').slice(0, 10);
  const onWeb = (p: CrmProperty) => { const k = addrKey(p.address); return !!k && web.some(l => addrKey(l.address) === k && (stem(l.title) === stem(p.name) || stem(l.title).startsWith(stem(p.name).slice(0, 6)))); };
  const crmOnly = crm.filter(p => !onWeb(p));
  // Website rows that are also CRM properties still need the CRM's notes (who to ask for).
  const webText = web.map(l => {
    const extra = crm.filter(p => addrKey(p.address) === addrKey(l.address)).flatMap(p => PROPERTY_NOTES.filter(n => n.match.test(p.name)).map(n => n.note));
    return describe(l, origin) + [...new Set(extra)].map(n => `\n  Agent note: ${n}`).join('');
  });
  const live = crmOnly.filter(p => isLive(p.status)), closed = crmOnly.filter(p => !isLive(p.status));
  const parts: string[] = [];
  if (webText.length) parts.push(`CURRENT LISTINGS ON OUR WEBSITE (${web.length}):\n\n${webText.join('\n\n')}`);
  if (live.length) parts.push(`OTHER CRECO PROPERTIES IN OUR CRM — development, pre-leasing and land inventory (${live.length}):\n\n${live.map(describeCrm).join('\n\n')}`);
  if (closed.length) parts.push(`CRECO PROPERTIES NO LONGER AVAILABLE (${closed.length}) — still ours, so never say they are not; say it has leased/sold and offer an agent to discuss other space:\n\n${closed.map(describeCrm).join('\n\n')}`);
  const text = `CRECO PROPERTY INVENTORY. Everything below is OUR property or listing — if a caller names any of these (by name, address or nickname), acknowledge that it is CRECO's, never say it isn't ours. These are the only property facts you may state. Prices, sizes and features come from here verbatim; if a caller asks something not listed for a property (e.g. parking count, HVAC, availability date, lease terms, whether an offer is in), say an agent will confirm and take their details.\n\n${parts.join('\n\n')}`;
  return { text, count: web.length + live.length };
}
