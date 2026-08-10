import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Promote a deal's property into a Property Workspace folder (crm_listings) and link
// the deal to it (crm_deals.listing_id). Idempotent: if the deal is already linked to
// a folder, that folder is returned instead of creating a duplicate.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { deal_id } = await req.json().catch(() => ({}));
  if (!deal_id) return NextResponse.json({ error: 'deal_id required' }, { status: 400 });

  const deal = await assertOwnsResource('crm_deals', deal_id, ctx, {
    ownerColumns: ['listing_id', 'property', 'type', 'agent_id', 'client'],
  });
  if (!deal) return notFound('Deal not found');

  const supabase = adminClient();

  // Already promoted → return the existing folder.
  if (deal.listing_id) {
    const { data: existing } = await supabase.from('crm_listings').select('*').eq('id', deal.listing_id).maybeSingle();
    if (existing) return NextResponse.json({ listing: existing, created: false });
  }

  // Purchase/sale deals → 'sold'; lease deals → 'leased' (drives the Deal Properties section).
  const status = /purchase|buyer|sale|seller/i.test(String(deal.type ?? '')) ? 'sold' : 'leased';
  const { data: listing, error } = await supabase.from('crm_listings').insert({
    name: (deal.property as string) || (deal.client as string) || 'Deal Property',
    status,
    type: 'Retail',
    business_unit: ctx.businessUnit ?? 'commercial',
    listing_agent_id: (deal.agent_id as string) || ctx.userId,
    created_by: ctx.userId,
  }).select().single();
  if (error || !listing) { console.error('[from-deal] insert', error); return NextResponse.json({ error: 'Could not create folder' }, { status: 500 }); }

  await supabase.from('crm_deals').update({ listing_id: listing.id }).eq('id', deal_id);
  return NextResponse.json({ listing, created: true });
}
