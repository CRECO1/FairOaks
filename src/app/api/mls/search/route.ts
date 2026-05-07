/**
 * GET /api/mls/search
 *
 * Live RESO proxy — passes search params directly to SABOR's API.
 * Used for real-time IDX search on the public listings page.
 *
 * Query params:
 *   city         — filter by City
 *   minPrice     — filter by ListPrice >=
 *   maxPrice     — filter by ListPrice <=
 *   minBeds      — filter by BedsTotal >=
 *   status       — Active (default) | Pending | Closed
 *   propertyType — e.g. Residential, Commercial
 *   search       — keyword search in SubdivisionName or address fields
 *   top          — page size (default 50, max 200)
 *   skip         — pagination offset
 *   orderby      — e.g. ListPrice+desc (default: ModificationTimestamp+desc)
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchProperties, statusFilter } from '@/lib/sabor-reso';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const city         = sp.get('city');
    const minPriceRaw  = sp.get('minPrice');
    const maxPriceRaw  = sp.get('maxPrice');
    const minBedsRaw   = sp.get('minBeds');
    const status       = sp.get('status') ?? 'Active';
    const propertyType = sp.get('propertyType');
    const search       = sp.get('search');
    const top          = Math.min(Math.max(parseInt(sp.get('top') ?? '50', 10) || 50, 1), 200);
    const skip         = Math.max(parseInt(sp.get('skip') ?? '0', 10) || 0, 0);

    // Validate orderby against an allowlist to prevent OData injection
    const ALLOWED_ORDER_COLS = new Set([
      'ListPrice', 'ModificationTimestamp', 'OnMarketDate', 'BedroomsTotal',
      'BathroomsFull', 'LivingArea', 'YearBuilt',
    ]);
    const orderbyRaw = sp.get('orderby')?.replace('+', ' ') ?? 'ModificationTimestamp desc';
    const orderbyCol = orderbyRaw.split(' ')[0];
    const orderbyDir = orderbyRaw.split(' ')[1]?.toLowerCase() === 'asc' ? 'asc' : 'desc';
    const orderby = ALLOWED_ORDER_COLS.has(orderbyCol)
      ? `${orderbyCol} ${orderbyDir}`
      : 'ModificationTimestamp desc';

    // Validate numeric inputs — must be non-negative integers
    const minPrice = minPriceRaw !== null ? parseInt(minPriceRaw, 10) : null;
    const maxPrice = maxPriceRaw !== null ? parseInt(maxPriceRaw, 10) : null;
    const minBeds  = minBedsRaw  !== null ? parseInt(minBedsRaw, 10)  : null;
    if (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) {
      return NextResponse.json({ error: 'minPrice must be a non-negative integer' }, { status: 400 });
    }
    if (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) {
      return NextResponse.json({ error: 'maxPrice must be a non-negative integer' }, { status: 400 });
    }
    if (minBeds !== null && (!Number.isFinite(minBeds) || minBeds < 0)) {
      return NextResponse.json({ error: 'minBeds must be a non-negative integer' }, { status: 400 });
    }

    // Build OData $filter
    const filters: string[] = [];

    // Status — use OData enum syntax (SABOR StandardStatus is an enum type)
    const statusMap: Record<string, string> = {
      active: 'ACTIVE', pending: 'ACTIVE_UNDER_CONTRACT', sold: 'CLOSED', closed: 'CLOSED',
    };
    const resoStatus = statusMap[status.toLowerCase()];
    if (!resoStatus) {
      return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
    }
    filters.push(statusFilter([resoStatus]));

    // City is an enum in SABOR — use contains() on StreetName or SubdivisionName instead
    if (city && city !== 'All Areas') {
      // Store city names in title case but SABOR returns them upper-case
      filters.push(`contains(SubdivisionName,'${city.replace(/'/g, "''")}') or contains(PostalCode,'${city.replace(/'/g, "''")}')`);
    }
    if (minPrice !== null) filters.push(`ListPrice ge ${minPrice}`);
    if (maxPrice !== null) filters.push(`ListPrice le ${maxPrice}`);
    if (minBeds !== null)  filters.push(`BedroomsTotal ge ${minBeds}`);
    if (propertyType) filters.push(`PropertyType eq '${propertyType.replace(/'/g, "''")}'`);
    if (search) {
      const q = search.replace(/'/g, "''");
      filters.push(
        `(contains(SubdivisionName,'${q}') or contains(StreetName,'${q}') or contains(City,'${q}'))`
      );
    }

    // If env restricts to a specific agent/office, enforce it on live search too
    if (process.env.SABOR_AGENT_EMAIL) {
      filters.push(`ListAgentEmail eq '${process.env.SABOR_AGENT_EMAIL}'`);
    } else if (process.env.SABOR_OFFICE_KEY) {
      filters.push(`ListOfficeKey eq '${process.env.SABOR_OFFICE_KEY}'`);
    }

    const filter = filters.join(' and ');

    const result = await searchProperties({
      filter,
      top,
      skip,
      orderby,
      count: true,
      // Include inline media (primary photo only via $expand if supported)
      select: [
        'ListingKey', 'ListingId', 'StandardStatus', 'ListPrice',
        'StreetNumber', 'StreetDirPrefix', 'StreetName', 'StreetSuffix', 'UnitNumber',
        'City', 'StateOrProvince', 'PostalCode', 'SubdivisionName',
        'BedsTotal', 'BathroomsTotalInteger', 'LivingArea', 'LotSizeAcres',
        'YearBuilt', 'GarageSpaces', 'PropertyType', 'PropertySubType',
        'AssociationFee', 'MediaCount', 'ModificationTimestamp', 'OnMarketDate',
        'ListAgentFullName', 'ListOfficeName',
      ].join(','),
    });

    return NextResponse.json({
      total: result['@odata.count'] ?? result.value.length,
      count: result.value.length,
      listings: result.value,
      hasMore: !!result['@odata.nextLink'],
    });
  } catch (err: any) {
    console.error('[MLS search] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
