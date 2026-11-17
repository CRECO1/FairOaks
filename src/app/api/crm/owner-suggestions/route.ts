import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { ownerCandidates, type OwnerSuggestion } from '@/lib/owner-candidates';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export type { OwnerSuggestion };

/**
 * GET /api/crm/owner-suggestions?listing_id= — who probably owns this property, to link as its Landlord so the weekly owner update has someone to
 * address (see lib/owner-candidates.ts). Suggestions only: nothing is linked until a person taps "Link as Landlord". Empty when a Landlord/Owner is already linked.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id') ?? '';
  if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
  const db = adminClient();
  const { data: l } = await db.from('crm_listings').select('id, address, name, business_unit').eq('id', listingId).maybeSingle();
  if (!l) return notFound('Listing not found');
  const { data: links } = await db.from('crm_listing_contacts').select('role').eq('listing_id', listingId).limit(50);
  if ((links ?? []).some(x => /landlord|owner/i.test(String(x.role ?? '')))) return NextResponse.json({ candidates: [], alreadyLinked: true });
  return NextResponse.json({ candidates: await ownerCandidates(db, ctx, l) });
}
