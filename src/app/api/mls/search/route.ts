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
import { searchProperties } from '@/lib/sabor-reso';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const city         = sp.get('city');
    const minPrice     = sp.get('minPrice');
    const maxPrice     = sp.get('maxPrice');
    const minBeds      = sp.get('minBeds');
    const status       = sp.get('status') ?? 'Active';
    const propertyType = sp.get('propertyType');
    const search       = sp.get('search');
    const top          = Math.min(parseInt(sp.get('top') ?? '50', 10), 200);
    const skip         = parseInt(sp.get('skip') ?? '0', 10);
    const orderby      = sp.get('orderby')?.replace('+', ' ') ?? 'ModificationTimestamp desc';

    // Build OData $filter
    const filters: string[] = [];

    // Status — map our values to RESO StandardStatus
    const statusMap: Record<string, string> = {
      active: 'Active', pending: 'Pending', sold: 'Closed', closed: 'Closed',
    };
    const resoStatus = statusMap[status.toLowerCase()] ?? status;
    filters.push(`StandardStatus eq '${resoStatus}'`);

    if (city)         filters.push(`City eq '${city.replace(/'/g, "''")}'`);
    if (minPrice)     filters.push(`ListPrice ge ${minPrice}`);
    if (maxPrice)     filters.push(`ListPrice le ${maxPrice}`);
    if (minBeds)      filters.push(`BedsTotal ge ${minBeds}`);
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
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
