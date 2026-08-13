import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

// Deals (crm_deals) for the property-workspace "Deals" tab: list the deals at a
// listing, create a deal pre-linked to a property, and link/unlink an existing
// deal. Scoped to the caller's business_unit (admins bypass).

const DEAL_COLS =
  'id, client, client_email, client_phone, client_id, type, property, value, stage, agent_id, assigned_agent_ids, listing_id, business_unit, created_at, last_touch';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id');
  const supabase = adminClient();
  let q = supabase.from('crm_deals').select(DEAL_COLS).order('last_touch', { ascending: false });
  if (!isAdminRole(ctx.role)) q = q.eq('business_unit', ctx.businessUnit);
  if (listingId) {
    if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
    q = q.eq('listing_id', listingId);
  }
  const { data, error } = await q;
  if (error) { console.error('[api/deals] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ deals: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({}));
  if (!b.client || !String(b.client).trim()) return NextResponse.json({ error: 'client required' }, { status: 400 });
  const supabase = adminClient();
  if (b.listing_id && !(await assertCanAccessListing(b.listing_id, ctx))) return notFound('Listing not found');
  const unit = isAdminRole(ctx.role) ? (b.business_unit || ctx.businessUnit || 'commercial') : (ctx.businessUnit ?? 'commercial');
  const row = {
    client: String(b.client).trim(),
    client_email: b.client_email || null,
    client_phone: b.client_phone || null,
    client_id: b.client_id || null,
    type: b.type || 'Tenant Lease',
    property: b.property || '',
    value: b.value != null && b.value !== '' ? Number(b.value) : 0,
    stage: b.stage || 'Prospect',
    agent_id: b.agent_id || ctx.userId,
    listing_id: b.listing_id || null,
    business_unit: unit,
    last_touch: new Date().toISOString().slice(0, 10),
  };
  const { data, error } = await supabase.from('crm_deals').insert([row]).select(DEAL_COLS).single();
  if (error) { console.error('[api/deals] POST', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ deal: data });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_deals', id, ctx))) return notFound('Deal not found');
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if ('listing_id' in b) {
    if (b.listing_id && !(await assertCanAccessListing(b.listing_id, ctx))) return notFound('Listing not found');
    patch.listing_id = b.listing_id || null;
  }
  if (typeof b.stage === 'string') patch.stage = b.stage;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  patch.last_touch = new Date().toISOString().slice(0, 10);
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_deals').update(patch).eq('id', id).select(DEAL_COLS).single();
  if (error) { console.error('[api/deals] PATCH', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ deal: data });
}
