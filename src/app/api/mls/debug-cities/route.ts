/**
 * GET /api/mls/debug-cities
 * Temporary diagnostic — returns raw City + SubdivisionName values from SABOR
 * so we can see exactly what strings to filter against.
 * Delete this route once the city filter is confirmed working.
 */
import { NextResponse } from 'next/server';
import { searchProperties } from '@/lib/sabor-reso';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('coords') === '1') {
    // Test whether SABOR returns Latitude/Longitude fields
    const r = await searchProperties({ select: 'ListingId,Latitude,Longitude,StreetNumber,StreetName,City', top: 3 });
    return Response.json(r.value);
  }
  // Query by zip codes for each target area so we see the exact City values SABOR uses
  const areas = [
    { label: 'Fair Oaks Ranch (78015)', zip: '78015' },
    { label: 'Boerne (78006)',          zip: '78006' },
    { label: 'Helotes (78023)',         zip: '78023' },
    { label: 'The Dominion (78257)',    zip: '78257' },
  ];

  const results: Record<string, { cityValues: string[]; subdivisions: string[] }> = {};

  for (const area of areas) {
    try {
      const r = await searchProperties({
        filter: `PostalCode eq '${area.zip}'`,
        select: 'ListingId,City,SubdivisionName,PostalCode',
        top: 20,
      });
      results[area.label] = {
        cityValues:   [...new Set(r.value.map(p => p.City ?? '(null)'))],
        subdivisions: [...new Set(r.value.map(p => p.SubdivisionName ?? '(null)'))].slice(0, 10),
      };
    } catch (e: any) {
      results[area.label] = { cityValues: [`ERROR: ${e?.message}`], subdivisions: [] };
    }
  }

  // Also test whether contains(City,...) actually works
  let containsTest: any = {};
  try {
    const t = await searchProperties({
      filter: `contains(City,'FAIROAKSRANCH')`,
      select: 'ListingId,City,PostalCode',
      top: 5,
    });
    containsTest = { count: t.value.length, sample: t.value.map(p => ({ city: p.City, zip: p.PostalCode })) };
  } catch (e: any) {
    containsTest = { error: e?.message };
  }

  return NextResponse.json({ byZip: results, containsTest_FAIROAKSRANCH: containsTest });
}
