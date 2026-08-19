import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

// Vendors + building info for a property folder (crm_listing_vendors). Two flavours in
// one table via `category`: 'vendor' (service / vendor / contact / phone) and
// 'building_info' (label / notes — dumpster code, watering day, shut-off valves…).
// Access derives from the parent listing, like the other listing-scoped routes.

const EDITABLE = ['category', 'label', 'vendor', 'contact', 'phone', 'notes', 'sort_order'] as const;

function clean(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === '' || v === null || v === undefined) { out[k] = null; continue; }
    if (k === 'sort_order') { const n = Number(v); out[k] = Number.isFinite(n) ? n : null; continue; }
    if (k === 'category') { out[k] = v === 'building_info' ? 'building_info' : 'vendor'; continue; }
    out[k] = String(v);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id');
  if (!listingId) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_listing_vendors').select('*')
    .eq('listing_id', listingId)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('label', { ascending: true });
  if (error) { console.error('[listing-vendors] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const listingId = body.listing_id as string | undefined;
  if (!listingId) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_listing_vendors')
    .insert({ ...clean(body), listing_id: listingId, business_unit: ctx.businessUnit ?? 'commercial', created_by: ctx.userId })
    .select().single();
  if (error) { console.error('[listing-vendors] POST', error); return NextResponse.json({ error: 'Could not add the row' }, { status: 500 }); }
  return NextResponse.json({ row: data });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = adminClient();
  const { data: cur } = await supabase.from('crm_listing_vendors').select('listing_id').eq('id', id).maybeSingle();
  if (!cur?.listing_id) return notFound('Row not found');
  if (!(await assertCanAccessListing(cur.listing_id, ctx))) return notFound('Row not found');
  const { data, error } = await supabase.from('crm_listing_vendors')
    .update({ ...clean(body), updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) { console.error('[listing-vendors] PATCH', error); return NextResponse.json({ error: 'Could not save the change' }, { status: 500 }); }
  return NextResponse.json({ row: data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = adminClient();
  const { data: cur } = await supabase.from('crm_listing_vendors').select('listing_id').eq('id', id).maybeSingle();
  if (!cur?.listing_id) return notFound('Row not found');
  if (!(await assertCanAccessListing(cur.listing_id, ctx))) return notFound('Row not found');
  const { error } = await supabase.from('crm_listing_vendors').delete().eq('id', id);
  if (error) { console.error('[listing-vendors] DELETE', error); return NextResponse.json({ error: 'Could not remove the row' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
