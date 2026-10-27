/**
 * Property DB filtering — pure functions (no React) so the rules are in one place and testable.
 *
 * The page filters ~2,600 rows in the browser. A filter is "off" when it is '' / false, so the empty
 * filter set matches everything. Counts shown next to the type chips are "faceted": they apply every
 * OTHER filter, so a chip tells you how many results you would get if you tapped it.
 */

export type SizeBand = '' | 'lt2' | '2to5' | '5to10' | '10to25' | 'gt25';

export interface PropFilters {
  search: string;
  type: string;
  status: string;
  listing: '' | 'lease' | 'sale';
  source: '' | 'broker' | 'loopnet' | 'crexi';
  size: SizeBand;
  newWeek: boolean;
  hasBroker: boolean;
  hasPhoto: boolean;
  shortlist: boolean;
}

export const EMPTY_FILTERS: PropFilters = {
  search: '', type: '', status: '', listing: '', source: '', size: '',
  newWeek: false, hasBroker: false, hasPhoto: false, shortlist: false,
};

/** Size bands, measured on the AVAILABLE space when known (what a tenant can actually take), else the building. */
export const SIZE_BANDS: { key: Exclude<SizeBand, ''>; label: string; min: number; max: number }[] = [
  { key: 'lt2',    label: 'Under 2,000 SF',   min: 0,      max: 1_999 },
  { key: '2to5',   label: '2,000 – 5,000',    min: 2_000,  max: 4_999 },
  { key: '5to10',  label: '5,000 – 10,000',   min: 5_000,  max: 9_999 },
  { key: '10to25', label: '10,000 – 25,000',  min: 10_000, max: 24_999 },
  { key: 'gt25',   label: '25,000+ SF',       min: 25_000, max: Infinity },
];

/** The fields the filters read. The page's Property type is a superset of this. */
export interface FilterableProperty {
  id: string;
  name?: string; address?: string; suite?: string; city?: string; zip?: string; county?: string; submarket?: string;
  asset_type?: string; property_subtype?: string; vacancy_status?: string; listing_type?: string;
  size_sf?: number | null; available_sf?: number | null;
  asking_rate?: string | number | null; sale_price?: number | null;
  listing_company?: string; listing_agent_name?: string; listing_agent_phone?: string;
  owner_name?: string; source?: string; flyer_url?: string; listing_url?: string;
  created_at?: string;
  contact?: { id?: string; first_name?: string | null; last_name?: string | null; business_name?: string | null; email?: string | null; phone?: string | null; cell_phone?: string | null } | null;
  owner?: { first_name?: string | null; last_name?: string | null; business_name?: string | null } | null;
  [k: string]: unknown;
}

const WEEK_MS = 7 * 86_400_000;

export function sizeOf(p: FilterableProperty): number | null {
  const n = p.available_sf ?? p.size_sf;
  return typeof n === 'number' && n > 0 ? n : null;
}

export function brokerPhone(p: FilterableProperty): string {
  return p.contact?.phone || p.contact?.cell_phone || p.listing_agent_phone || '';
}
export function brokerEmail(p: FilterableProperty): string {
  const e = p.contact?.email || (typeof p.listing_agent_email === 'string' ? p.listing_agent_email : '');
  return e || '';
}
export function hasPhoto(p: FilterableProperty): boolean {
  const photos = p.photos;
  return (Array.isArray(photos) && typeof photos[0] === 'string' && !!photos[0]) || !!p.flyer_url;
}
export function hasBroker(p: FilterableProperty): boolean {
  return !!(p.contact || p.contact_id || brokerPhone(p) || brokerEmail(p));
}

function searchText(p: FilterableProperty): string {
  return [
    p.name, p.address, p.suite, p.city, p.zip, p.county, p.submarket, p.asset_type, p.property_subtype,
    p.listing_company, p.listing_agent_name, p.owner_name, p.parcel_apn,
    p.contact ? `${p.contact.first_name ?? ''} ${p.contact.last_name ?? ''} ${p.contact.business_name ?? ''}` : '',
    p.owner ? `${p.owner.first_name ?? ''} ${p.owner.last_name ?? ''} ${p.owner.business_name ?? ''}` : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Does `p` pass the filters? `skip` leaves one filter out (used for the type-chip counts).
 * Search is word-by-word: "retail boerne" needs both words somewhere on the record, in any order.
 */
export function matchesFilters(
  p: FilterableProperty,
  f: PropFilters,
  ctx: { shortlist: ReadonlySet<string>; now: number },
  skip?: keyof PropFilters,
): boolean {
  if (skip !== 'type' && f.type && p.asset_type !== f.type) return false;
  if (skip !== 'status' && f.status && p.vacancy_status !== f.status) return false;
  if (skip !== 'source' && f.source) {
    const s = (p.source || '').toLowerCase();
    if (f.source === 'loopnet' && !s.includes('loopnet')) return false;
    if (f.source === 'crexi' && !s.includes('crexi')) return false;
    if (f.source === 'broker' && (s.includes('loopnet') || s.includes('crexi'))) return false;
  }
  if (skip !== 'listing' && f.listing) {
    const lt = (p.listing_type || '').toLowerCase();
    if (f.listing === 'lease' && !(lt.includes('lease') || lt.includes('both'))) return false;
    if (f.listing === 'sale' && !(lt.includes('sale') || lt.includes('both'))) return false;
  }
  if (skip !== 'size' && f.size) {
    const band = SIZE_BANDS.find(b => b.key === f.size);
    const n = sizeOf(p);
    if (band && (n == null || n < band.min || n > band.max)) return false;
  }
  if (skip !== 'newWeek' && f.newWeek) {
    const t = p.created_at ? new Date(p.created_at).getTime() : 0;
    if (!t || ctx.now - t > WEEK_MS) return false;
  }
  if (skip !== 'hasBroker' && f.hasBroker && !hasBroker(p)) return false;
  if (skip !== 'hasPhoto' && f.hasPhoto && !hasPhoto(p)) return false;
  if (skip !== 'shortlist' && f.shortlist && !ctx.shortlist.has(p.id)) return false;
  if (skip !== 'search') {
    const words = f.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const hay = searchText(p);
      if (!words.every(w => hay.includes(w))) return false;
    }
  }
  return true;
}

/** How many filters are on (the search box is not counted — it is always visible). */
export function activeFilterCount(f: PropFilters): number {
  return (f.type ? 1 : 0) + (f.status ? 1 : 0) + (f.listing ? 1 : 0) + (f.source ? 1 : 0) + (f.size ? 1 : 0)
    + (f.newWeek ? 1 : 0) + (f.hasBroker ? 1 : 0) + (f.hasPhoto ? 1 : 0) + (f.shortlist ? 1 : 0);
}

/** Filters tucked behind the "Filters" button (everything not already a visible chip). */
export function panelFilterCount(f: PropFilters): number {
  return (f.status ? 1 : 0) + (f.source ? 1 : 0) + (f.size ? 1 : 0) + (f.hasBroker ? 1 : 0) + (f.hasPhoto ? 1 : 0);
}

const SIZES = new Set<string>(['', ...SIZE_BANDS.map(b => b.key)]);
/** Rebuild filters from whatever localStorage returned, ignoring anything unexpected. */
export function parseFilters(raw: unknown): PropFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const b = (v: unknown) => v === true;
  const listing = s(r.listing), source = s(r.source), size = s(r.size);
  return {
    search: s(r.search).slice(0, 200),
    type: s(r.type), status: s(r.status),
    listing: listing === 'lease' || listing === 'sale' ? listing : '',
    source: source === 'broker' || source === 'loopnet' || source === 'crexi' ? source : '',
    size: (SIZES.has(size) ? size : '') as SizeBand,
    newWeek: b(r.newWeek), hasBroker: b(r.hasBroker), hasPhoto: b(r.hasPhoto), shortlist: b(r.shortlist),
  };
}

const STORE_KEY = 'crm:propdb:filters:v1';
export function loadFilters(): PropFilters {
  try { return parseFilters(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch { return EMPTY_FILTERS; }
}
export function saveFilters(f: PropFilters): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(f)); } catch { /* storage blocked: filters just won't be remembered */ }
}

const rateText = (p: FilterableProperty) => {
  if (p.sale_price != null) return `$${Number(p.sale_price).toLocaleString()}`;
  const r = p.asking_rate;
  if (r == null || r === '') return '';
  return typeof r === 'number' ? `$${r}` : String(r);
};

/** Plain-text summary of properties, ready to paste into an email or text to a client. */
export function summarizeProperties(list: FilterableProperty[]): string {
  return list.map(p => {
    const where = [p.address, p.suite].filter(Boolean).join(', ');
    const place = [p.city, 'TX'].filter(Boolean).join(', ');
    const facts = [p.asset_type, sizeOf(p) ? `${sizeOf(p)!.toLocaleString()} SF` : '', rateText(p), p.vacancy_status].filter(Boolean).join(' · ');
    const name = (p.contact ? `${p.contact.first_name ?? ''} ${p.contact.last_name ?? ''}`.trim() : '') || p.listing_agent_name || '';
    const co = p.contact?.business_name || p.listing_company || '';
    const broker = [[name, co].filter(Boolean).join(', '), brokerPhone(p), brokerEmail(p)].filter(Boolean).join(' · ');
    return [
      p.name || where || 'Property',
      [where && p.name ? where : '', place && (p.city ? place : '')].filter(Boolean).join(' · '),
      facts,
      broker ? `Broker: ${broker}` : '',
      p.listing_url ? String(p.listing_url) : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}
