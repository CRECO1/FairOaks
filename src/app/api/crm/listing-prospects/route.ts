import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanSeeRentRoll } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { listingProspects } from '@/lib/listing-prospects';

// Email Prospects for a property (Rent Roll tab) — see lib/listing-prospects.ts.
// Access mirrors the Rent Roll tab it sits in.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id');
  if (!listingId) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanSeeRentRoll(listingId, ctx))) return notFound('Listing not found');
  return NextResponse.json(await listingProspects(adminClient(), listingId));
}
