/**
 * Matchmaker engine — pure functions (no React, no network), so the Matchmaker tab, the daily job and the Copilot all rank
 * properties the same way. A tenant's search is a NeedCriteria; the candidates are Property DB rows (crm_prospective_properties).
 *
 * Two kinds of "no":
 *  - DROPPED when a fact we have clearly rules the property out: already leased/sold, the wrong kind of deal, the wrong asset type,
 *    too small / too big, over budget, outside the areas asked for.
 *  - KEPT, scored lower and flagged with a caveat, when a fact is simply missing. The Property DB is sparse (about three rows in four
 *    have no rate, many have no size, most were added months ago), and an agent would rather ask a listing broker than never hear
 *    about a space — but an email to a client must never claim what the listing does not say.
 */

export type DealType = '' | 'lease' | 'sale';

export interface NeedCriteria {
  dealType: DealType;
  assetTypes: string[];
  sizeMin: number | null;
  sizeMax: number | null;
  /** Lease budget, $/SF/yr. */
  rateMax: number | null;
  priceMin: number | null;
  /** Sale budget, $. */
  priceMax: number | null;
  /** Submarkets, cities or ZIP codes. */
  areas: string[];
  /** Target occupancy, YYYY-MM-DD. */
  moveInBy: string | null;
  /** Free text, e.g. "drive-thru, 24' clear, corner". */
  mustHaves: string;
}

export const EMPTY_NEED: NeedCriteria = { dealType: '', assetTypes: [], sizeMin: null, sizeMax: null, rateMax: null, priceMin: null, priceMax: null, areas: [], moveInBy: null, mustHaves: '' };

/** The crm_clients columns that hold a tenant's search. */
export interface NeedRow {
  asset_types?: string[] | null;
  req_size_min?: number | null; req_size_max?: number | null;
  req_price_min?: number | null; req_price_max?: number | null;
  req_submarkets?: string[] | null;
  req_deal_type?: string | null; req_rate_max?: number | null; req_move_in_by?: string | null; req_must_haves?: string | null;
}

export function criteriaFromRow(r: NeedRow): NeedCriteria {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return {
    dealType: r.req_deal_type === 'lease' || r.req_deal_type === 'sale' ? r.req_deal_type : '',
    assetTypes: (r.asset_types ?? []).filter(Boolean),
    sizeMin: n(r.req_size_min), sizeMax: n(r.req_size_max),
    rateMax: n(r.req_rate_max),
    priceMin: n(r.req_price_min), priceMax: n(r.req_price_max),
    areas: (r.req_submarkets ?? []).filter(Boolean),
    moveInBy: r.req_move_in_by || null,
    mustHaves: (r.req_must_haves ?? '').trim(),
  };
}

/** True when the search says anything at all (an empty search matches everything, which is never what anyone wants to see). */
export function hasCriteria(c: NeedCriteria): boolean {
  return !!(c.dealType || c.assetTypes.length || c.sizeMin || c.sizeMax || c.rateMax || c.priceMin || c.priceMax || c.areas.length || c.moveInBy || c.mustHaves.trim());
}

export interface MatchProperty {
  id: string;
  name?: string | null; address?: string | null; suite?: string | null; city?: string | null; state?: string | null; zip?: string | null; county?: string | null; submarket?: string | null;
  asset_type?: string | null; property_subtype?: string | null;
  size_sf?: number | null; available_sf?: number | null; divisible?: boolean | null;
  listing_type?: string | null; transaction_status?: string | null;
  sale_price?: number | null; asking_rate?: string | number | null; lease_rate_min?: number | null; lease_rate_max?: number | null; lease_type?: string | null; opex_psf?: number | null;
  description?: string | null; highlights?: string[] | null; features?: string[] | null; zoning?: string | null; notes?: string | null;
  clear_height_ft?: number | null; dock_doors?: number | null;
  available_date?: string | null; date_listed?: string | null; created_at?: string | null; last_verified_at?: string | null;
  source?: string | null; listing_url?: string | null; flyer_url?: string | null; brochure_url?: string | null; photos?: string[] | null;
  listing_company?: string | null; listing_agent_name?: string | null; listing_agent_phone?: string | null;
}

/** The Property DB columns the engine reads — one place, so every caller selects the same list. */
export const MATCH_COLUMNS = 'id,name,address,suite,city,state,zip,county,submarket,asset_type,property_subtype,size_sf,available_sf,divisible,listing_type,transaction_status,sale_price,asking_rate,lease_rate_min,lease_rate_max,lease_type,opex_psf,description,highlights,features,zoning,notes,clear_height_ft,dock_doors,available_date,date_listed,created_at,last_verified_at,source,listing_url,flyer_url,brochure_url,photos,listing_company,listing_agent_name,listing_agent_phone';

export type Fit = 'strong' | 'good' | 'possible';
export interface MatchResult { property: MatchProperty; score: number; fit: Fit; reasons: string[]; caveats: string[] }

export const FIT_LABEL: Record<Fit, string> = { strong: 'Strong fit', good: 'Good fit', possible: 'Worth a look' };
/** Scores at or above this are good enough to put in an automatic email; the tab shows everything. */
export const EMAIL_MIN_SCORE = 58;

// ─── rates ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ParsedRate {
  perSfYr: number | null; perSfYrMax: number | null; salePrice: number | null; unpriced: boolean;
  /** Quoted as a monthly dollar total ("$1,000 /MO"), which says nothing about $/SF. */
  monthlyTotal: boolean;
  /** The text says per month, so the numeric rate columns extracted from it cannot be trusted. */
  saysMonthly: boolean;
}

/**
 * The Property DB's asking_rate is free text from broker emails: "$22 SF/YR", "$18 - $24 SF/YR", "$2 SF/MO", "$1,250,000",
 * "For Sale $450,000", "Undisclosed", "Unpriced". Reads it into a $/SF/yr rate, a sale price, or "no price given".
 */
export function parseRate(v: string | number | null | undefined): ParsedRate {
  const none: ParsedRate = { perSfYr: null, perSfYrMax: null, salePrice: null, unpriced: false, monthlyTotal: false, saysMonthly: false };
  if (v == null || v === '') return none;
  if (typeof v === 'number') return v >= 0.5 && v <= 150 ? { ...none, perSfYr: v, perSfYrMax: v } : v >= 20000 ? { ...none, salePrice: v } : none;
  const s = String(v).trim();
  if (!s) return none;
  if (/undisclosed|unpriced|negotiable|call for|contact|tbd|market rate|upon request/i.test(s) && !/\d/.test(s)) return { ...none, unpriced: true };
  const nums = [...s.matchAll(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)/g)].map(m => Number(m[1].replace(/,/g, ''))).filter(Number.isFinite);
  if (!nums.length) return /undisclosed|unpriced|negotiable/i.test(s) ? { ...none, unpriced: true } : none;
  const hasSf = /\bsf\b|\/\s*sf|psf|per\s*s(?:q|f)/i.test(s);
  const monthly = /\/\s*mo|\bmo\b|per\s*month|monthly/i.test(s);
  const yearly = /\/\s*yr|\/\s*year|per\s*year|annual/i.test(s);
  if (monthly && !hasSf) return { ...none, monthlyTotal: true, saysMonthly: true };   // "$1,000 /MO", "$2,000/AC/month": dollars a month, not $/SF
  if (hasSf || yearly) {
    const f = monthly ? 12 : 1;
    const per = nums.map(n => n * f).filter(n => n >= 0.5 && n <= 150);
    if (!per.length) return { ...none, saysMonthly: monthly };
    return { ...none, perSfYr: Math.min(...per), perSfYrMax: Math.max(...per), saysMonthly: monthly };
  }
  const big = nums.filter(n => n >= 20000);
  if (big.length) return { ...none, salePrice: Math.max(...big) };
  // a bare small figure ("$22") is a $/SF/yr rate; anything in between is ambiguous and ignored
  const small = nums.filter(n => n >= 0.5 && n <= 150);
  if (small.length === nums.length) return { ...none, perSfYr: Math.min(...small), perSfYrMax: Math.max(...small) };
  return none;
}

interface Pricing { lease: { low: number | null; high: number | null }; sale: number | null; unpriced: boolean; monthlyTotal: boolean }
function pricingOf(p: MatchProperty): Pricing {
  const parsed = parseRate(p.asking_rate);
  const col = (v: number | null | undefined) => (typeof v === 'number' && v >= 0.5 && v <= 150 ? v : null);   // a $/SF/yr column holding 2100 is a monthly total, not a rate
  // When the listing's own text says "per month", the extracted rate columns hold the monthly figure (1, 308, 2100…), so the text wins.
  const low = parsed.saysMonthly ? parsed.perSfYr : (col(p.lease_rate_min) ?? parsed.perSfYr);
  const high = parsed.saysMonthly ? parsed.perSfYrMax : (col(p.lease_rate_max) ?? parsed.perSfYrMax ?? low);
  const sale = typeof p.sale_price === 'number' && p.sale_price > 0 ? p.sale_price : parsed.salePrice;
  return { lease: { low, high }, sale, unpriced: parsed.unpriced, monthlyTotal: parsed.monthlyTotal };
}

/** Is it for lease, for sale, both — or can't we tell? */
function dealKinds(p: MatchProperty, pr: Pricing): { lease: boolean | null; sale: boolean | null } {
  const t = (p.listing_type ?? '').toLowerCase();
  if (t) {
    const both = t.includes('both');
    return { lease: both || t.includes('lease'), sale: both || t.includes('sale') };
  }
  const lease = pr.lease.low != null ? true : null;
  const sale = pr.sale != null ? true : null;
  if (lease && !sale) return { lease: true, sale: false };
  if (sale && !lease) return { lease: false, sale: true };
  return { lease, sale };
}

// ─── text helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s/&.-]/g, ' ').replace(/\s+/g, ' ').trim();
const num = (n: number) => n.toLocaleString('en-US');
const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2).replace(/0+$/, '').replace(/\.$/, '')}M` : `$${num(Math.round(n))}`);
const rate = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** Words an agent types for a must-have, and the other ways listings say it. */
const SYNONYMS: Array<[RegExp, string[]]> = [
  [/drive[\s-]?thr(?:u|ough)/, ['drive-thru', 'drive thru', 'drive-through', 'drive through', 'drivethru']],
  [/dock/, ['dock', 'loading dock', 'dock door', 'dock-high']],
  [/clear\s*height|ceiling/, ['clear height', 'clear ht', "' clear", 'ceiling']],
  [/corner/, ['corner', 'hard corner', 'end cap', 'endcap']],
  [/end\s?cap/, ['end cap', 'endcap', 'end-cap']],
  [/medical|dental|clinic/, ['medical', 'dental', 'clinic', 'build-out', 'buildout', 'exam room']],
  [/restaurant|kitchen|grease/, ['restaurant', 'grease trap', 'hood', 'kitchen', 'second generation']],
  [/patio/, ['patio', 'outdoor seating']],
  [/yard|ios|outdoor storage|fenced/, ['yard', 'fenced', 'outdoor storage', 'ios']],
  [/power|3[\s-]?phase|amp/, ['3-phase', 'three phase', '3 phase', 'amp', 'power']],
  [/sprinkler/, ['sprinkler', 'esfr']],
  [/signage|monument|pylon/, ['signage', 'monument', 'pylon']],
  [/parking/, ['parking']],
  [/turn[\s-]?key|move[\s-]?in ready|plug/, ['turnkey', 'turn-key', 'move-in ready', 'plug and play', 'plug-and-play']],
  [/\bcrane/, ['crane']],
  [/rail/, ['rail']],
];

function mustHaveTokens(text: string): string[] {
  return text.split(/[,;\n]+/).map(t => t.trim()).filter(t => t.length >= 3).slice(0, 12);
}

function propertyText(p: MatchProperty): string {
  return norm([p.name, p.property_subtype, p.description, p.notes, p.zoning, ...(p.highlights ?? []), ...(p.features ?? []),
    p.clear_height_ft ? `${p.clear_height_ft}' clear height` : '', p.dock_doors ? `${p.dock_doors} dock doors dock` : ''].filter(Boolean).join(' | '));
}

function tokenHit(token: string, hay: string): boolean {
  const t = norm(token);
  if (!t) return false;
  if (hay.includes(t)) return true;
  for (const [re, words] of SYNONYMS) if (re.test(t) && words.some(w => hay.includes(norm(w)))) return true;
  return false;
}

// ─── the match ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ADJACENT: Record<string, string[]> = {
  Industrial: ['Flex'], Flex: ['Industrial', 'Office'], Office: ['Flex', 'Medical'], Medical: ['Office'], Retail: ['Mixed-Use'], 'Mixed-Use': ['Retail', 'Office'],
};
const DAY = 86_400_000;

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
}
function ageWords(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** The size a tenant could actually take: the available space when known, else the building. */
export const spaceOf = (p: MatchProperty): number | null => {
  const n = p.available_sf ?? p.size_sf;
  return typeof n === 'number' && n > 0 ? n : null;
};

function areaMatch(c: NeedCriteria, p: MatchProperty): 'exact' | 'city' | null {
  if (!c.areas.length) return 'exact';
  const wanted = c.areas.map(norm).filter(Boolean);
  const sub = norm(p.submarket), city = norm(p.city), county = norm(p.county), zip = norm(p.zip).slice(0, 5);
  for (const w of wanted) {
    if (/^\d{5}$/.test(w)) { if (zip === w) return 'exact'; continue; }
    if (sub && (sub === w || sub.includes(w) || (w.length > 4 && w.includes(sub)))) return 'exact';
  }
  for (const w of wanted) if ((city && (city === w || city.includes(w))) || (county && county === w)) return 'city';
  return null;
}

export interface MatchOptions { now?: Date; limit?: number }

/** Ranks `props` against one search. Highest score first; dropped properties are not returned. */
export function matchProperties(c: NeedCriteria, props: MatchProperty[], opts: MatchOptions = {}): MatchResult[] {
  if (!hasCriteria(c)) return [];
  const now = (opts.now ?? new Date()).getTime();
  const tokens = mustHaveTokens(c.mustHaves);
  const wantTypes = c.assetTypes.map(t => t.toLowerCase());
  const best = new Map<string, MatchResult>();

  for (const p of props) {
    const status = (p.transaction_status ?? '').trim().toLowerCase();
    if (status && status !== 'available') continue;                           // leased, sold, under contract, off-market

    const reasons: string[] = [], caveats: string[] = [];
    let score = 40;
    const pr = pricingOf(p);

    // lease or sale
    const kinds = dealKinds(p, pr);
    const want: DealType = c.dealType || (c.rateMax && !c.priceMax && !c.priceMin ? 'lease' : (c.priceMax || c.priceMin) && !c.rateMax ? 'sale' : '');
    if (want === 'lease') { if (kinds.lease === false) continue; if (kinds.lease == null) { score -= 3; caveats.push('Not stated whether it is for lease'); } }
    if (want === 'sale') { if (kinds.sale === false) continue; if (kinds.sale == null) { score -= 3; caveats.push('Not stated whether it is for sale'); } }

    // asset type
    if (wantTypes.length) {
      const at = p.asset_type ?? '';
      if (!at) { score -= 5; caveats.push('Property type not listed'); }
      else if (!wantTypes.includes(at.toLowerCase())) {
        const near = (ADJACENT[at] ?? []).some(a => wantTypes.includes(a.toLowerCase()));
        if (!near) continue;
        score -= 8; caveats.push(`Listed as ${at.toLowerCase()} space`);
      }
    }

    // size
    const space = spaceOf(p);
    if (c.sizeMin || c.sizeMax) {
      if (space == null) { score -= 6; caveats.push('Size not listed'); }
      else {
        const lo = c.sizeMin, hi = c.sizeMax;
        const inside = (lo == null || space >= lo) && (hi == null || space <= hi);
        if (inside) {
          score += 18;
          reasons.push(`${num(space)} SF ${p.available_sf ? 'available' : 'building'} — ${lo && hi ? `inside the ${num(lo)}–${num(hi)} SF range` : lo ? `at least ${num(lo)} SF` : `within the ${num(hi!)} SF limit`}`);
        } else if (lo != null && space < lo) {
          if (space >= lo * 0.9) { score += 6; caveats.push(`${num(space)} SF — a little under the ${num(lo)} SF minimum`); } else continue;
        } else if (hi != null && space > hi) {
          // "divisible" is the listing's claim, and a 360,000 SF warehouse is not going to be cut down to 5,000: only believe it up to a few times the ask
          if (p.divisible === true && p.available_sf && space <= hi * 4) { score += 6; reasons.push(`${num(space)} SF, divisible — may be split to the size needed`); }
          else if (space <= hi * 1.15) { score += 6; caveats.push(`${num(space)} SF — a little over the ${num(hi)} SF maximum`); }
          else continue;
        }
      }
    }

    // budget
    if (want === 'lease' || (want === '' && c.rateMax)) {
      if (c.rateMax) {
        const low = pr.lease.low;
        if (low == null) { score -= 3; caveats.push(pr.unpriced ? 'Rate is undisclosed' : pr.monthlyTotal ? 'Rent quoted per month, not per SF' : 'Rate not listed'); }
        else {
          if (low > c.rateMax * 1.10) continue;                                            // clearly over budget
          const shown = pr.lease.high != null && pr.lease.high !== low ? `${rate(low)}–${rate(pr.lease.high)}` : rate(low);
          const ll = `${shown}/SF/yr${p.lease_type ? ` ${p.lease_type}` : ''}`;
          if (low <= c.rateMax * 0.85) { score += 14; reasons.push(`${ll} — well under the ${rate(c.rateMax)} budget`); }
          else if (low <= c.rateMax) { score += 10; reasons.push(`${ll} — within the ${rate(c.rateMax)} budget`); }
          else { score += 3; caveats.push(`${ll} — slightly over the ${rate(c.rateMax)} budget`); }
        }
      }
    }
    if (want === 'sale' || (want === '' && (c.priceMax || c.priceMin))) {
      if (c.priceMax || c.priceMin) {
        const price = pr.sale;
        if (price == null) { score -= 3; caveats.push(pr.unpriced ? 'Price is undisclosed' : 'Price not listed'); }
        else {
          if (c.priceMax && price > c.priceMax * 1.10) continue;
          if (c.priceMin && price < c.priceMin * 0.9) continue;
          if (!c.priceMax || price <= c.priceMax) { score += 10; reasons.push(`${money(price)} — within the ${c.priceMax ? `${money(c.priceMax)} budget` : 'price range'}`); }
          else { score += 3; caveats.push(`${money(price)} — slightly over the ${money(c.priceMax)} budget`); }
        }
      }
    }

    // where
    if (c.areas.length) {
      const a = areaMatch(c, p);
      if (!a) continue;
      if (a === 'exact') { score += 10; reasons.push(`In ${p.submarket || p.city || `ZIP ${p.zip}`} — a target area`); }
      else { score += 6; reasons.push(`In ${p.city || p.county} — a target area`); }
    }

    // must-haves
    if (tokens.length) {
      const hay = propertyText(p);
      const hits = tokens.filter(t => tokenHit(t, hay));
      const misses = tokens.filter(t => !hits.includes(t));
      score += Math.min(16, hits.length * 4);
      for (const h of hits.slice(0, 3)) reasons.push(`Mentions ${h.toLowerCase()}`);
      // with a description or feature list to read, say what we couldn't find in it; with none, say the features aren't listed
      if (misses.length) caveats.push(p.description || p.notes || p.highlights?.length || p.features?.length ? `Couldn’t confirm: ${misses.slice(0, 3).join(', ')}` : 'Features not listed');
    }

    // when
    if (p.available_date) {
      const avail = Date.parse(p.available_date);
      if (Number.isFinite(avail)) {
        if (avail <= now + 14 * DAY) { score += 2; reasons.push('Available now'); }
        else if (c.moveInBy) {
          const want = Date.parse(c.moveInBy);
          if (Number.isFinite(want) && avail > want + 45 * DAY) { score -= 4; caveats.push(`Available ${new Date(avail).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}, after the target date`); }
        }
      }
    }

    // how fresh
    const added = daysSince(p.date_listed ?? p.created_at, now);
    const verified = daysSince(p.last_verified_at, now);
    const age = verified != null && (added == null || verified < added) ? verified : added;
    if (age != null) {
      if (age <= 30) { score += 8; reasons.push(`${verified != null && verified <= 30 ? 'Checked' : 'Listed'} ${ageWords(age)}`); }
      else if (age <= 60) score += 4;
      else if (age > 120) score -= 4;
      if (age > 60) caveats.push(`${verified != null && verified === age ? 'Last checked' : 'Added'} ${ageWords(age)} — confirm it’s still available`);
    } else caveats.push('Availability not confirmed');
    if (!status && age != null && age <= 60) score -= 2;

    // how easy to act on
    if ((p.photos?.length ?? 0) > 0 || p.flyer_url || p.brochure_url) score += 3;
    if (p.listing_url) score += 2;
    if (p.listing_agent_name && p.listing_agent_phone) score += 2;

    score = Math.max(0, Math.min(100, Math.round(score)));
    const fit: Fit = score >= 75 ? 'strong' : score >= EMAIL_MIN_SCORE ? 'good' : 'possible';
    const result: MatchResult = { property: p, score, fit, reasons, caveats };

    // the same suite often appears twice (a broker email and a marketplace digest): keep the better one
    const key = [norm(p.address), norm(p.suite), norm(p.city)].join('|');
    const keyed = norm(p.address) ? key : `id:${p.id}`;
    const prev = best.get(keyed);
    if (!prev || result.score > prev.score) best.set(keyed, result);
  }

  const out = [...best.values()].sort((a, b) => b.score - a.score || (Date.parse(b.property.created_at ?? '') || 0) - (Date.parse(a.property.created_at ?? '') || 0) || a.property.id.localeCompare(b.property.id));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

// ─── words for the people reading it ─────────────────────────────────────────────────────────────────────────────────────────

/** "Lease · Office, Medical · 3,000–5,000 SF · up to $26/SF/yr · Boerne · by Mar 2027" */
export function describeCriteria(c: NeedCriteria): string {
  const parts: string[] = [];
  if (c.dealType) parts.push(c.dealType === 'lease' ? 'Lease' : 'Buy');
  if (c.assetTypes.length) parts.push(c.assetTypes.join(', '));
  if (c.sizeMin && c.sizeMax) parts.push(`${num(c.sizeMin)}–${num(c.sizeMax)} SF`);
  else if (c.sizeMin) parts.push(`${num(c.sizeMin)}+ SF`);
  else if (c.sizeMax) parts.push(`up to ${num(c.sizeMax)} SF`);
  if (c.rateMax) parts.push(`up to ${rate(c.rateMax)}/SF/yr`);
  if (c.priceMin && c.priceMax) parts.push(`${money(c.priceMin)}–${money(c.priceMax)}`);
  else if (c.priceMax) parts.push(`up to ${money(c.priceMax)}`);
  else if (c.priceMin) parts.push(`from ${money(c.priceMin)}`);
  if (c.areas.length) parts.push(c.areas.slice(0, 4).join(', ') + (c.areas.length > 4 ? ` +${c.areas.length - 4}` : ''));
  if (c.moveInBy) { const d = Date.parse(c.moveInBy); if (Number.isFinite(d)) parts.push(`by ${new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`); }
  if (c.mustHaves.trim()) parts.push(`needs: ${c.mustHaves.trim().replace(/\s+/g, ' ').slice(0, 80)}`);
  return parts.join(' · ');
}

/** The ending that turns a name into a possessive: "Maria" → "’s", "Package Cues" → "’". */
export function possessiveSuffix(name: string): string { return /s$/i.test(name.trim()) ? '’' : '’s'; }
export function possessive(name: string): string { return `${name.trim()}${possessiveSuffix(name)}`; }

/** Which marketplace or channel a Property DB row came from, for a small label. */
export function sourceLabel(p: Pick<MatchProperty, 'source' | 'listing_url'>): string {
  const s = `${p.source ?? ''} ${p.listing_url ?? ''}`.toLowerCase();
  if (s.includes('crexi')) return 'Crexi';
  if (s.includes('loopnet')) return 'LoopNet';
  if (s.includes('broker_email') || s.includes('agent_call')) return 'Broker';
  if (s.includes('digest')) return 'Marketplace';
  return 'Property DB';
}

/** One line for a property: "Office · 4,200 SF · $22/SF/yr NNN · Boerne / Hill Country". */
export function propertyLine(p: MatchProperty): string {
  const pr = pricingOf(p);
  const space = spaceOf(p);
  const price = pr.lease.low != null ? `${pr.lease.high != null && pr.lease.high !== pr.lease.low ? `${rate(pr.lease.low)}–${rate(pr.lease.high)}` : rate(pr.lease.low)}/SF/yr${p.lease_type ? ` ${p.lease_type}` : ''}`
    : pr.sale != null ? money(pr.sale) : '';
  return [p.asset_type, space ? `${num(space)} SF` : '', price, p.submarket || p.city].filter(Boolean).join(' · ');
}
