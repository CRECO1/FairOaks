/**
 * GET /api/mls/debug-cities
 * Temporary diagnostic — returns raw City + SubdivisionName values from SABOR
 * so we can see exactly what strings to filter against.
 * Delete this route once the city filter is confirmed working.
 */
import { NextResponse } from 'next/server';
import { searchProperties } from '@/lib/sabor-reso';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await searchProperties({
    select: 'ListingId,City,SubdivisionName,PostalCode',
    top: 200,
    orderby: 'City asc',
  });

  const cities = [...new Set(result.value.map(p => p.City ?? '(null)'))].sort();
  const sample = result.value.slice(0, 50).map(p => ({
    id: p.ListingId,
    city: p.City,
    subdivision: p.SubdivisionName,
    zip: p.PostalCode,
  }));

  return NextResponse.json({ uniqueCities: cities, sample });
}
