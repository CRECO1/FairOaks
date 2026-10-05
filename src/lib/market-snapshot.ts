/**
 * The /market-reports figures, computed from the live SABOR MLS feed — the same feed
 * /listings searches. Nothing here is typed in: every number is derived from the
 * listings returned at render time, and the page carries the time it was computed.
 *
 * WHAT THE FEED CAN AND CANNOT SAY
 * The IDX feed exposes only listings that are on the market (Active) or under
 * contract (Active Under Contract / Pending). A sold listing drops out of it — it is
 * never returned as CLOSED (see fetchAllActiveListingKeys in sabor-reso.ts), and
 * there is no close-price or days-on-market field. So sold-side metrics — median
 * sale price, homes sold, sale-to-list ratio, days on market to sale — cannot be
 * produced here and are deliberately absent. What remains is a snapshot of the
 * market as it stands: supply, asking prices, price reductions, time listed, and how
 * much of the market is already under contract.
 *
 * Residential only (PropertyType RE): land, farm/ranch, commercial and lease
 * listings would distort asking-price medians.
 */
import { searchPropertiesAll, statusFilter } from '@/lib/sabor-reso';
import { COMMUNITIES } from '@/lib/listing-filters';

export interface MarketArea {
  key: string;
  label: string;
  /** /listings link for this area. */
  href: string;
  filter: string;
}

const cityEq = (enumVal: string) => `City eq ODataService.City_Lkp_1'${enumVal}'`;

/** The areas the page reports on. The first is the headline market. */
export const MARKET_AREAS: MarketArea[] = [
  { key: 'fair-oaks-ranch',  label: 'Fair Oaks Ranch',  href: '/listings?city=Fair+Oaks+Ranch',          filter: cityEq('FAIROAKSRA') },
  { key: 'boerne',           label: 'Boerne',           href: '/listings?city=Boerne',                   filter: cityEq('BOERNE') },
  { key: 'cordillera-ranch', label: 'Cordillera Ranch', href: '/listings?community=cordillera-ranch',    filter: COMMUNITIES['cordillera-ranch'].filter! },
  { key: 'the-dominion',     label: 'The Dominion',     href: '/listings?community=the-dominion',        filter: COMMUNITIES['the-dominion'].filter! },
  { key: 'helotes',          label: 'Helotes',          href: '/listings?city=Helotes',                  filter: cityEq('HELOTES') },
  { key: 'bulverde',         label: 'Bulverde',         href: '/listings?city=Bulverde',                 filter: cityEq('BULVERDE') },
];

const RESIDENTIAL = `PropertyType eq ODataService.PropType_DD'RE'`;
const ACTIVE = statusFilter(['ACTIVE']);
const UNDER_CONTRACT = statusFilter(['ACTIVE_UNDER_CONTRACT', 'PENDING']);
const SELECT = 'ListingId,StandardStatus,ListPrice,OriginalListPrice,LivingArea,OnMarketDate';

/** Medians on fewer listings than this are not shown — too few to describe a market. */
export const MIN_SAMPLE = 5;

export interface AreaStats {
  area: MarketArea;
  forSale: number;
  underContract: number;
  /** under contract ÷ (for sale + under contract) */
  underContractShare: number | null;
  medianAskingPrice: number | null;
  medianPricePerSqft: number | null;
  /** Median days the homes now for sale have been listed (OnMarketDate → as-of date). */
  medianDaysListed: number | null;
  /** Share of homes for sale whose asking price is below their original list price. */
  priceCutShare: number | null;
  priceCutCount: number;
  /** Median size of those reductions, as a share of the original list price. */
  medianPriceCut: number | null;
  /** For sale or under contract, first listed in the last 30 days. */
  newLast30Days: number;
}

export interface MarketSnapshot {
  asOf: Date;
  areas: AreaStats[];
}

function median(values: number[]): number | null {
  const v = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length < MIN_SAMPLE) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const DAY = 86_400_000;

async function areaStats(area: MarketArea, asOf: Date, revalidate: number): Promise<AreaStats> {
  const [active, pending] = await Promise.all([
    searchPropertiesAll({ filter: `${ACTIVE} and ${RESIDENTIAL} and ${area.filter}`, select: SELECT, revalidate }),
    searchPropertiesAll({ filter: `${UNDER_CONTRACT} and ${RESIDENTIAL} and ${area.filter}`, select: SELECT, revalidate }),
  ]);

  const cuts = active.filter(p => p.OriginalListPrice && p.ListPrice && p.ListPrice < p.OriginalListPrice);
  const listedDays = (p: { OnMarketDate?: string }) =>
    p.OnMarketDate ? Math.max(0, Math.floor((asOf.getTime() - Date.parse(`${p.OnMarketDate}T12:00:00Z`)) / DAY)) : NaN;
  const total = active.length + pending.length;
  const daysListed = median(active.map(listedDays));

  return {
    area,
    forSale: active.length,
    underContract: pending.length,
    underContractShare: total >= MIN_SAMPLE ? pending.length / total : null,
    medianAskingPrice: median(active.map(p => p.ListPrice)),
    medianPricePerSqft: median(active.filter(p => p.LivingArea && p.LivingArea > 0).map(p => p.ListPrice / p.LivingArea!)),
    medianDaysListed: daysListed === null ? null : Math.round(daysListed),
    priceCutShare: active.length >= MIN_SAMPLE ? cuts.length / active.length : null,
    priceCutCount: cuts.length,
    medianPriceCut: median(cuts.map(p => (p.OriginalListPrice! - p.ListPrice) / p.OriginalListPrice!)),
    newLast30Days: [...active, ...pending].filter(p => listedDays(p) <= 30).length,
  };
}

/** Null when the feed can't be reached — the page then shows no figures at all. */
export async function getMarketSnapshot(revalidate: number): Promise<MarketSnapshot | null> {
  const asOf = new Date();
  try {
    const areas = await Promise.all(MARKET_AREAS.map(a => areaStats(a, asOf, revalidate)));
    // A feed that answers with nothing for the headline market is a failed fetch, not a market.
    if (areas[0].forSale + areas[0].underContract === 0) return null;
    return { asOf, areas };
  } catch (err) {
    console.error('[market-snapshot] SABOR fetch failed', err);
    return null;
  }
}

// ─── The story: a headline and lead built only from the figures above ─────────────

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;
/** Price-cut sizes are small; whole percents would turn 4.8% into 5%. */
const pct1 = (r: number) => `${(r * 100).toFixed(1)}%`;

export interface MarketStory {
  /** Narrative, no figures: what the current numbers mean. */
  headline: string;
  /** One narrative sentence under the headline, still without figures. */
  dek: string;
  /** The figures behind the headline, in prose. */
  body: string;
  points: string[];
}

/** Meteorological season in Central time — the framing word for "this fall". */
export function seasonOf(d: Date): 'winter' | 'spring' | 'summer' | 'fall' {
  const m = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'numeric' }).format(d));
  return m <= 2 || m === 12 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'fall';
}

/**
 * The story for the headline market. The headline and dek are narrative and carry
 * no figures; the body states the figures they rest on. Thresholds pick which
 * reading of the CURRENT numbers leads — the feed has no history, so nothing here
 * claims a direction ("gaining", "rising", "tightening"), only how things stand.
 */
export function marketStory(s: MarketSnapshot): MarketStory {
  const [home, ...rest] = s.areas;
  const name = home.area.label;
  const season = seasonOf(s.asOf);

  let headline: string;
  let dek: string;
  if (home.priceCutShare !== null && home.priceCutShare > 0.5) {
    headline = `${name} buyers have room to negotiate this ${season}`;
    dek = `More than half of the homes for sale in ${name} are now asking less than when they first listed — good news for buyers, and a reminder for sellers that pricing it right from day one matters.`;
  } else if (home.priceCutShare !== null && home.priceCutShare >= 0.35) {
    headline = `Price is the conversation in ${name} this ${season}`;
    dek = `A large share of ${name} listings have trimmed their asking price since they first listed, so buyers have room to negotiate and carefully priced homes stand out.`;
  } else if (home.underContractShare !== null && home.underContractShare >= 0.3) {
    headline = `${name} homes are finding buyers this ${season}`;
    dek = `A healthy share of the ${name} market is already under contract, so well-priced homes are drawing offers and buyers who find the right one should be ready to act.`;
  } else if (home.medianDaysListed !== null && home.medianDaysListed >= 90) {
    headline = `${name} buyers can take their time this ${season}`;
    dek = `The typical home for sale in ${name} has been on the market for several months, so buyers can compare their options without being rushed.`;
  } else {
    headline = `Where the ${name} market stands this ${season}`;
    dek = `A clear look at what's for sale in ${name} right now, what sellers are asking, and how much is already under contract.`;
  }

  const lead: string[] = [];
  lead.push(
    `${home.forSale} homes are for sale in ${name}` +
    (home.medianAskingPrice !== null ? ` at a median asking price of ${usd(home.medianAskingPrice)}` : '') +
    (home.medianPricePerSqft !== null ? ` (${usd(home.medianPricePerSqft)} per square foot)` : '') + ', ' +
    `and ${home.underContract} more ${home.underContract === 1 ? 'is' : 'are'} under contract` +
    (home.underContractShare !== null ? ` — ${pct(home.underContractShare)} of the homes on the market.` : '.'),
  );
  if (home.priceCutShare !== null) {
    lead.push(
      `${home.priceCutCount} of the ${home.forSale} homes for sale (${pct(home.priceCutShare)}) are now asking less than their original list price` +
      (home.medianPriceCut !== null ? `, by a median of ${pct1(home.medianPriceCut)}.` : '.'),
    );
  }
  if (home.medianDaysListed !== null) {
    lead.push(`The median home for sale has been listed for ${home.medianDaysListed} days.`);
  }

  const points: string[] = [];
  const ranked = [home, ...rest].filter(a => a.underContractShare !== null);
  if (ranked.length > 1) {
    const top = ranked.reduce((a, b) => (b.underContractShare! > a.underContractShare! ? b : a));
    points.push(`Of the ${s.areas.length} areas tracked here, ${top.area.label} has the largest share of its market under contract: ${pct(top.underContractShare!)}.`);
  }
  const priced = [home, ...rest].filter(a => a.medianPricePerSqft !== null);
  if (priced.length > 1) {
    const hi = priced.reduce((a, b) => (b.medianPricePerSqft! > a.medianPricePerSqft! ? b : a));
    const lo = priced.reduce((a, b) => (b.medianPricePerSqft! < a.medianPricePerSqft! ? b : a));
    points.push(`Median asking price per square foot runs from ${usd(lo.medianPricePerSqft!)} in ${lo.area.label} to ${usd(hi.medianPricePerSqft!)} in ${hi.area.label}.`);
  }
  // Headline market only: the areas overlap (Cordillera Ranch listings are filed under
  // Boerne), so a total across them would double-count.
  points.push(`${home.newLast30Days} ${name} ${home.newLast30Days === 1 ? 'home' : 'homes'} came on the market in the last 30 days.`);

  return { headline, dek, body: lead.join(' '), points };
}
