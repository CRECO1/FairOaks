/**
 * GET /api/listings/exists?id=<ListingId> — does SABOR still carry this listing?
 *
 * Called by middleware for every /listings/<slug> request to decide between
 * rendering the page and answering 410 Gone for an expired / sold / withdrawn
 * listing (the IDX feed drops those entirely). Uses the same lookup as
 * listings/[slug]/page.tsx — any status the feed returns counts as "exists".
 *
 * Only a definitive answer is CDN-cached (30 min), so the check costs one SABOR
 * call per listing per half hour, not one per page view. A SABOR failure returns
 * 503 uncached, and middleware falls through to the normal page — an outage must
 * never turn live listings into 410s.
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchProperties } from '@/lib/sabor-reso';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^\d{5,12}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  try {
    const result = await searchProperties({
      filter: `ListingId eq '${id}'`,
      select: 'ListingId',
      top: 1,
    });
    return NextResponse.json(
      { id, exists: result.value.length > 0 },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=1800, stale-while-revalidate=600' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Listing lookup unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
