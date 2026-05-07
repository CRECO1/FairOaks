/**
 * GET /api/listings
 *
 * IDX: serves listings directly from SABOR's RESO Web API — no database sync required.
 * Accepts the same query params as before so /listings page needs no changes.
 *
 * Params: city, minPrice, maxPrice, minBeds, search, page, limit
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  searchProperties,
  getMediaBatch,
  resoPropertyToListing,
  statusFilter,
} from '@/lib/sabor-reso';

export const dynamic = 'force-dynamic';

// Active + pending, same as before
const STATUS_FILTER = statusFilter(['ACTIVE', 'ACTIVE_UNDER_CONTRACT']);

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
    // ── Build OData $filter ────────────────────────────────────────────────
    const filters: string[] = [STATUS_FILTER];

    if (city && city !== 'All Areas') {
      // City comes back all-caps in SABOR — compare uppercase
      const c = city.toUpperCase().replace(/'/g, "''");
      filters.push(`contains(City,'${c}')`);
    }
    if (minPrice !== null && Number.isFinite(minPrice)) filters.push(`ListPrice ge ${minPrice}`);
    if (maxPrice !== null && Number.isFinite(maxPrice)) filters.push(`ListPrice le ${maxPrice}`);
    if (minBeds  !== null && Number.isFinite(minBeds) && minBeds > 0)  filters.push(`BedroomsTotal ge ${minBeds}`);
    if (search) {
      const q = search.replace(/'/g, "''");
      filters.push(`(contains(SubdivisionName,'${q}') or contains(StreetName,'${q}') or contains(City,'${q}') or contains(ListingId,'${q}'))`);
    }

    const filter = filters.join(' and ');

    // ── Fetch one page from SABOR ──────────────────────────────────────────
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

    // ── Batch-fetch media for this page only ───────────────────────────────
    const listingIds = properties.map(p => p.ListingId);
    const mediaMap   = await getMediaBatch(listingIds);

    // ── Convert to our listing format ──────────────────────────────────────
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
