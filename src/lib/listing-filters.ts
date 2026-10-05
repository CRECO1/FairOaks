/**
 * Listing filters that site links pass to /listings as query params, beyond ?city=.
 *
 *   ?community=<slug>          a subdivision (neighborhood pages)
 *   ?district=<slug>           a school district (school pages)
 *   ?type=new-construction     homes built this year or last
 *   ?price=luxury              $750K+ (the luxury-homes page's own threshold)
 *   ?minPrice= / ?maxPrice=    price bands (homes-for-sale band pages)
 *   ?status=active             active only
 *
 * Shared by the listings page (labels, reading the URL) and /api/listings (the
 * SABOR OData filters), so a link and the filter it produces can't drift apart.
 *
 * SABOR quirks these definitions work around (confirmed against the live API):
 *  - contains() is case-sensitive and tolower() is "not implemented", so a
 *    subdivision is matched in each casing agents actually type it in.
 *  - SAB_SchoolDistrict is an enum (SchlDist_Lkp_1), filtered with eq.
 *  - There is no new-construction flag; BuilderName is filled on nearly every
 *    listing, so YearBuilt is the only honest signal.
 */

/** "the dominion" → contains() for THE DOMINION, The Dominion, the dominion. */
function subdivisionContains(term: string): string {
  const title = term.replace(/\b\w/g, c => c.toUpperCase());
  const variants = [...new Set([term.toUpperCase(), title, term])];
  return `(${variants.map(v => `contains(SubdivisionName,'${v}')`).join(' or ')})`;
}

const cityEq = (enumVal: string) => `City eq ODataService.City_Lkp_1'${enumVal}'`;

export interface CommunityFilter {
  label: string;
  /** OData filter. Null when the MLS has no subdivision by this name (see fallbackCity). */
  filter: string | null;
  /** Shown instead, with a note saying so, when filter is null. */
  fallbackCity?: string;
}

export const COMMUNITIES: Record<string, CommunityFilter> = {
  'the-dominion':     { label: 'The Dominion',      filter: subdivisionContains('the dominion') },
  'cordillera-ranch': { label: 'Cordillera Ranch',  filter: subdivisionContains('cordillera') },
  'herff-ranch':      { label: 'Herff Ranch',       filter: subdivisionContains('herff ranch') },
  'sonoma-verde':     { label: 'Sonoma Verde',      filter: subdivisionContains('sonoma verde') },
  'johnson-ranch':    { label: 'Johnson Ranch',     filter: `${subdivisionContains('johnson ranch')} and ${cityEq('BULVERDE')}` },
  // MLS spells it "STONE CREEK"; San Antonio has an unrelated Stone Creek, so keep to FOR/Boerne.
  'stone-creek-ranch': {
    label: 'Stone Creek Ranch',
    filter: `(SubdivisionName eq 'STONE CREEK' or SubdivisionName eq 'Stone Creek' or ${subdivisionContains('stone creek ranch')}) and (${cityEq('FAIROAKSRA')} or ${cityEq('BOERNE')})`,
  },
  // No MLS subdivision carries this name (checked 2026-10-05), so show the city it sits in.
  'the-preserve-fair-oaks': { label: 'The Preserve at Fair Oaks', filter: null, fallbackCity: 'Fair Oaks Ranch' },
};

export const DISTRICTS: Record<string, { label: string; enumVal: string }> = {
  'boerne-isd':    { label: 'Boerne ISD',    enumVal: 'BOERNE' },
  'northside-isd': { label: 'Northside ISD', enumVal: 'NORTHSIDE' },
  'comal-isd':     { label: 'Comal ISD',     enumVal: 'COMAL' },
};

export function districtFilter(slug: string): string | null {
  const d = DISTRICTS[slug];
  return d ? `SAB_SchoolDistrict eq ODataService.SchlDist_Lkp_1'${d.enumVal}'` : null;
}

/** New construction = built this calendar year or last (Central time). */
export function newConstructionMinYear(now = new Date()): number {
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(now));
  return year - 1;
}

export const LUXURY_MIN_PRICE = 750_000;
