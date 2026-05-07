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

const STATUS_FILTER = statusFilter(['ACTIVE', 'ACTIVE_UNDER_CONTRACT']);

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

// Areas that are SubdivisionName values, not cities — use contains(SubdivisionName,...)
const SUBDIVISION_SEARCH: Record<string, string> = {
  'DOMINION':        'dominion',
  'CORDILLERA RANCH': 'cordillera ranch',
};

function buildCityFilter(city: string): string | null {
  const c = city.toUpperCase();
  const enumVal = CITY_ENUM[c];
  if (enumVal) {
    return `City eq ODataService.City_Lkp_1'${enumVal}'`;
  }
  const subdivLower = SUBDIVISION_SEARCH[c];
  if (subdivLower) {
    return `contains(tolower(SubdivisionName),'${subdivLower}')`;
  }
  // Fallback: try SubdivisionName for unknown areas
  const safe = c.replace(/'/g, "''");
  return `contains(tolower(SubdivisionName),'${safe.toLowerCase()}')`;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const city     = sp.get('city') ?? '';
  const minPrice = sp.get('minPrice') ? Number(sp.get('minPrice')) : null;
  const maxPrice = sp.get('maxPrice') ? Number(sp.get('maxPrice')) : null;
  const minBeds  = sp.get('minBeds')  ? Number(sp.get('minBeds'))  : null;
  const search   = sp.get('search')   ?? '';
  const page     = Math.max(1, Number(sp.get('page')  ?? '1'));
  const limit    = Math.min(48, Math.max(1, Number(sp.get('limit') ?? '24')));
  const skip     = (page - 1) * limit;

  try {
    const filters: string[] = [STATUS_FILTER];

    if (city && city !== 'All Areas') {
      const cityFilter = buildCityFilter(city);
      if (cityFilter) filters.push(cityFilter);
    }

    if (minPrice !== null && Number.isFinite(minPrice)) filters.push(`ListPrice ge ${minPrice}`);
    if (maxPrice !== null && Number.isFinite(maxPrice)) filters.push(`ListPrice le ${maxPrice}`);
    if (minBeds  !== null && Number.isFinite(minBeds) && minBeds > 0) filters.push(`BedroomsTotal ge ${minBeds}`);
    if (search) {
      const q = search.replace(/'/g, "''");
      filters.push(`(contains(SubdivisionName,'${q}') or contains(StreetName,'${q}') or contains(ListingId,'${q}'))`);
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
