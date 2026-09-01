import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanSeeRentRoll } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

// Rent roll = one editable row per suite on a property folder (crm_property_tenants).
// It merges what used to live across three spreadsheet tabs — the rent roll, the suite
// directory and the mailbox/key log — since they're all keyed by suite. Access derives
// from the parent listing (honors the Restricted flag) like the other listing routes.

// Columns an agent may write. Everything else (ids, timestamps) is server-owned.
const EDITABLE = ['tenant_name', 'suite', 'building', 'size_sf', 'lease_type', 'lease_start', 'lease_expiration',
  'monthly_rent', 'annual_rent', 'rent_psf', 'pct_share', 'mailbox_box', 'keys', 'email', 'phone', 'contact_name', 'mail_only',
  'contact_id', 'renewal_status', 'notes', 'sort_order'] as const;
const NUMERIC = new Set(['size_sf', 'monthly_rent', 'annual_rent', 'rent_psf', 'pct_share', 'keys', 'sort_order']);
const DATE = new Set(['lease_start', 'lease_expiration']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The suite's Contact is a real CRM contact, joined live so a change on the contact
// record shows here — contact_name stays as the fallback for people not in the CRM.
const SELECT = '*, crm_clients:contact_id (id, first_name, last_name, business_name, email, phone, cell_phone)';

function clean(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === '' || v === null || v === undefined) { out[k] = null; continue; }
    if (k === 'contact_id') { const id = String(v).trim(); out[k] = UUID.test(id) ? id : null; continue; }
    if (NUMERIC.has(k)) { const n = Number(v); out[k] = Number.isFinite(n) ? n : null; continue; }
    if (DATE.has(k)) { const s = String(v).trim(); out[k] = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; continue; }
    out[k] = String(v);
  }
  return out;
}

// Keep the Floor Plans view (office_suites) in step with the rent roll: when a suite's
// tenant / size / expiration changes here, mirror it onto the matching drawn suite so a
// tenant move is a single edit. Only updates suites the floor plan already draws.
async function syncFloorPlan(db: SupabaseClient, unit: string, suite?: string | null, row?: Record<string, unknown>) {
  const num = String(suite ?? '').trim();
  if (!num || !row) return;
  const name = String(row.tenant_name ?? '').trim();
  const vacant = !name || /^vacant$/i.test(name);
  const patch: Record<string, unknown> = {
    tenant_name: vacant ? '' : name,
    status: vacant ? 'vacant' : 'occupied',
    updated_at: new Date().toISOString(),
  };
  if (row.size_sf !== undefined) patch.sq_ft = row.size_sf === null ? null : Math.round(Number(row.size_sf));
  if (row.lease_expiration !== undefined) patch.lease_expiration = row.lease_expiration;
  try {
    await db.from('office_suites').update(patch).eq('business_unit', unit).eq('suite_number', num);
  } catch (e) { console.error('[rent-roll] floor-plan sync', e); }
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id');
  if (!listingId) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanSeeRentRoll(listingId, ctx))) return notFound('Listing not found');
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_property_tenants')
    .select(SELECT)
    .eq('listing_id', listingId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('suite', { ascending: true });
  if (error) { console.error('[rent-roll] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ rows: data ?? [] });
}

// Create a suite row.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const listingId = body.listing_id as string | undefined;
  if (!listingId) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanSeeRentRoll(listingId, ctx))) return notFound('Listing not found');
  const supabase = adminClient();
  const row = clean(body);
  const { data, error } = await supabase.from('crm_property_tenants')
    .insert({ ...row, listing_id: listingId, business_unit: ctx.businessUnit ?? 'commercial', created_by: ctx.userId })
    .select(SELECT).single();
  if (error) { console.error('[rent-roll] POST', error); return NextResponse.json({ error: 'Could not add the suite' }, { status: 500 }); }
  await syncFloorPlan(supabase, data.business_unit, data.suite, row);
  return NextResponse.json({ row: data });
}

// Update one suite row.
export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = adminClient();
  const { data: cur } = await supabase.from('crm_property_tenants').select('listing_id, business_unit, suite').eq('id', id).maybeSingle();
  if (!cur?.listing_id) return notFound('Suite not found');
  if (!(await assertCanSeeRentRoll(cur.listing_id, ctx))) return notFound('Suite not found');
  const row = clean(body);
  const { data, error } = await supabase.from('crm_property_tenants')
    .update({ ...row, updated_at: new Date().toISOString() }).eq('id', id).select(SELECT).single();
  if (error) { console.error('[rent-roll] PATCH', error); return NextResponse.json({ error: 'Could not save the change' }, { status: 500 }); }
  // Sync against the suite as it now stands (a renamed suite moves the mirror with it).
  await syncFloorPlan(supabase, data.business_unit, data.suite ?? cur.suite, { ...row, tenant_name: data.tenant_name, size_sf: data.size_sf, lease_expiration: data.lease_expiration });
  return NextResponse.json({ row: data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = adminClient();
  const { data: cur } = await supabase.from('crm_property_tenants').select('listing_id').eq('id', id).maybeSingle();
  if (!cur?.listing_id) return notFound('Suite not found');
  if (!(await assertCanSeeRentRoll(cur.listing_id, ctx))) return notFound('Suite not found');
  const { error } = await supabase.from('crm_property_tenants').delete().eq('id', id);
  if (error) { console.error('[rent-roll] DELETE', error); return NextResponse.json({ error: 'Could not remove the suite' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
