/**
 * GET /api/listings
 *
 * IDX: serves listings directly from SABOR's RESO Web API — no database sync required.
 * Accepts the same query params as before so /listings page needs no changes.
 *
 * Params: city, minPrice, maxPrice, minBeds, search, page, limit
 *
 * SABOR City field notes (confirmed via debug):
 *  - Type: ODataService.City_Lkp_1 — an enum lookup, NOT a string.
 *  - contains() on City throws 400 "types not compatible". Must use eq with enum syntax.
 *  - Enum member names strip spaces AND truncate at ~10 chars:
 *      "Fair Oaks Ranch" → "FAIROAKSRA", "San Antonio" → "SANANTONIO"
 *  - Dominion / Cordillera Ranch are SubdivisionName values, not City values.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  searchProperties,
  getMediaBatch,
  resoPropertyToListing,
  statusFilter,
} from '@/lib/sabor-reso';

export const dynamic = 'force-dynamic';

const STATUS_FILTER = statusFilter(['ACTIVE', 'ACTIVE_UNDER_CONTRACT', 'PENDING']);

// Confirmed City enum values from SABOR (ODataService.City_Lkp_1 member names)
// Spaces stripped + truncated to ~10 chars by SABOR's MLS system
const CITY_ENUM: Record<string, string> = {
  'FAIR OAKS RANCH': 'FAIROAKSRA',
  'BOERNE':          'BOERNE',
  'SAN ANTONIO':     'SANANTONIO',
  'HELOTES':         'HELOTES',
  'GREY FOREST':     'GREYFOREST',
  'BULVERDE':        'BULVERDE',
  'KERRVILLE':       'KERRVILLE',
  'NEW BRAUNFELS':   'NEWBRAUNFE',  // 10-char truncation
  'FREDERICKSBURG':  'FREDERICKS',  // 10-char truncation
};

// Areas that are SubdivisionName values, not cities.
// Values use partial matches that work across mixed-case SABOR data.
const SUBDIVISION_SEARCH: Record<string, string> = {
  'DOMINION':        'ominion',     // matches 'Dominion', 'THE DOMINION', 'DOMINION HEIGHTS'
  'CORDILLERA RANCH': 'CORDILLERA', // stored all-caps in SABOR
};

function buildCityFilter(city: string): string | null {
  const c = city.toUpperCase();
  const enumVal = CITY_ENUM[c];
  if (enumVal) {
    return `City eq ODataService.City_Lkp_1'${enumVal}'`;
  }
  const subdivMatch = SUBDIVISION_SEARCH[c];
  if (subdivMatch) {
    return `contains(SubdivisionName,'${subdivMatch}')`;
  }
  // Fallback: try SubdivisionName uppercase for unknown areas
  const safe = c.replace(/'/g, "''");
  return `contains(SubdivisionName,'${safe}')`;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const city     = sp.get('city') ?? '';
  const minPrice = sp.get('minPrice') ? Number(sp.get('minPrice')) : null;
  const maxPrice = sp.get('maxPrice') ? Number(sp.get('maxPrice')) : null;
  const minBeds  = sp.get('minBeds')  ? Number(sp.get('minBeds'))  : null;
  const minBaths = sp.get('minBaths') ? Number(sp.get('minBaths')) : null;
  const statusParam = sp.get('status') ?? ''; // 'active' | 'under_contract' | 'coming_soon'
  const search   = sp.get('search')   ?? '';
  const page     = Math.max(1, Number(sp.get('page')  ?? '1'));
  // mapMode=1 fetches a larger batch for the map view (no pagination needed)
  const isMapMode = sp.get('mapMode') === '1';
  const limit    = isMapMode ? 200 : Math.min(48, Math.max(1, Number(sp.get('limit') ?? '24')));
  const skip     = (page - 1) * limit;

  try {
    // Build status filter: honour explicit status param, otherwise default to active+pending
    let activeStatusFilter: string;
    if (statusParam === 'active') {
      activeStatusFilter = statusFilter(['ACTIVE']);
    } else if (statusParam === 'under_contract') {
      activeStatusFilter = statusFilter(['ACTIVE_UNDER_CONTRACT', 'PENDING']);
    } else if (statusParam === 'coming_soon') {
      activeStatusFilter = statusFilter(['COMING_SOON']);
    } else {
      activeStatusFilter = STATUS_FILTER; // default: active + under contract + pending
    }

    const filters: string[] = [activeStatusFilter];

    if (city && city !== 'All Areas') {
      const cityFilter = buildCityFilter(city);
      if (cityFilter) filters.push(cityFilter);
    }

    if (minPrice !== null && Number.isFinite(minPrice)) filters.push(`ListPrice ge ${minPrice}`);
    if (maxPrice !== null && Number.isFinite(maxPrice)) filters.push(`ListPrice le ${maxPrice}`);
    if (minBeds  !== null && Number.isFinite(minBeds) && minBeds > 0) filters.push(`BedroomsTotal ge ${minBeds}`);
    if (minBaths !== null && Number.isFinite(minBaths) && minBaths > 0) filters.push(`BathroomsFull ge ${minBaths}`);
    if (search) {
      const safe = (s: string) => s.replace(/'/g, "''");
      const tokens = search.trim().split(/\s+/);

      // Street suffixes to strip when matching StreetName
      const SUFFIXES = new Set(['dr','drive','st','street','ave','avenue','blvd','boulevard',
        'ln','lane','ct','court','pl','place','rd','road','way','cir','circle',
        'pkwy','parkway','hwy','highway','trl','trail','pass','run','loop','bend','cv','cove']);

      const streetNum = tokens[0].match(/^\d+$/) ? tokens[0] : null;
      const zip       = tokens.find(t => /^\d{5}$/.test(t)) ?? null;
      const nameTokens = tokens.filter(t =>
        t !== streetNum && t !== zip && !SUFFIXES.has(t.toLowerCase().replace(/\.$/, ''))
      );
      const streetName = nameTokens.join(' ');

      if (streetNum) {
        // Looks like an address query — match StreetNumber + StreetName + optional zip
        const parts: string[] = [`StreetNumber eq '${safe(streetNum)}'`];
        if (streetName) parts.push(`contains(StreetName,'${safe(streetName)}')`);
        if (zip)        parts.push(`PostalCode eq '${safe(zip)}'`);
        filters.push(`(${parts.join(' and ')})`);
      } else if (zip && tokens.length === 1) {
        // Zip-only search
        filters.push(`PostalCode eq '${safe(zip)}'`);
      } else {
        // Generic: subdivision, street name, MLS#, or zip mixed in text
        const orParts = [`contains(SubdivisionName,'${safe(search)}')`,
                         `contains(StreetName,'${safe(search)}')`,
                         `contains(ListingId,'${safe(search)}')`];
        if (zip) orParts.push(`PostalCode eq '${safe(zip)}'`);
        filters.push(`(${orParts.join(' or ')})`);
      }
    }

    const filter = filters.join(' and ');

    const result = await searchProperties({
      filter,
      top:     limit,
      skip,
      orderby: 'ModificationTimestamp desc',
      count:   true,
    });

    const properties = result.value;
    const total      = result['@odata.count'] ?? properties.length;
    const totalPages = Math.ceil(total / limit);

    if (properties.length === 0) {
      return NextResponse.json({ listings: [], total, page, totalPages });
    }

    const listingIds = properties.map(p => p.ListingId);
    const mediaMap   = await getMediaBatch(listingIds);

    const listings = properties.map(p => {
      const images = mediaMap.get(p.ListingId) ?? [];
      return resoPropertyToListing(p, images);
    });

    return NextResponse.json({ listings, total, page, totalPages });
  } catch (err: any) {
    console.error('[listings API] SABOR error:', err?.message ?? err);
    return NextResponse.json({ listings: [], total: 0, page, totalPages: 0 }, { status: 500 });
  }
}
