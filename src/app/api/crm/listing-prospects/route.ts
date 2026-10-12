import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, isAdminRole, assertOwnsResource } from '@/lib/crm-auth';
import { assertCanSeeRentRoll } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { listingProspects, campaignProspects } from '@/lib/listing-prospects';

// Email Prospects for a property (Rent Roll tab) — see lib/listing-prospects.ts.
// Access mirrors the Rent Roll tab it sits in.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  // Campaign view (the Call Queue): one campaign, or 'all' = every campaign that sent in the last 90 days.
  const campaignId = req.nextUrl.searchParams.get('campaign_id');
  if (campaignId) {
    const unit = isAdminRole(ctx.role) ? (req.nextUrl.searchParams.get('unit') ?? ctx.businessUnit ?? 'commercial') : (ctx.businessUnit ?? 'commercial');
    if (campaignId !== 'all' && !(await assertOwnsResource('crm_campaigns', campaignId, ctx))) return notFound('Campaign not found');
    return NextResponse.json(await campaignProspects(adminClient(), unit, campaignId));
  }
  const listingId = req.nextUrl.searchParams.get('listing_id');
  if (!listingId) return NextResponse.json({ error: 'listing_id or campaign_id required' }, { status: 400 });
  if (!(await assertCanSeeRentRoll(listingId, ctx))) return notFound('Listing not found');
  return NextResponse.json(await listingProspects(adminClient(), listingId));
}
