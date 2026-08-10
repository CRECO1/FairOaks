import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

// Contacts linked to a property folder (crm_listing_contacts). This table has no
// business_unit of its own, so access is derived from the parent listing and honors
// the Restricted-folder flag via assertCanAccessListing().

const CLIENT_COLS = 'id, first_name, last_name, business_name, email, phone, cell_phone, type';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id');
  if (!listingId) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_listing_contacts')
    .select(`id, role, created_at, client_id, crm_clients(${CLIENT_COLS})`)
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true });
  if (error) { console.error('[listing-contacts] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ contacts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { listing_id, client_id, role } = await req.json().catch(() => ({}));
  if (!listing_id || !client_id) return NextResponse.json({ error: 'listing_id and client_id required' }, { status: 400 });
  if (!(await assertCanAccessListing(listing_id, ctx))) return notFound('Listing not found');
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_listing_contacts')
    .upsert({ listing_id, client_id, role: role || null, created_by: ctx.userId }, { onConflict: 'listing_id,client_id,role' })
    .select(`id, role, created_at, client_id, crm_clients(${CLIENT_COLS})`)
    .single();
  if (error) { console.error('[listing-contacts] POST', error); return NextResponse.json({ error: 'Could not add contact' }, { status: 500 }); }
  return NextResponse.json({ contact: data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = adminClient();
  const { data: row } = await supabase.from('crm_listing_contacts').select('listing_id').eq('id', id).maybeSingle();
  if (!row) return notFound('Contact link not found');
  if (!(await assertCanAccessListing(row.listing_id as string, ctx))) return notFound('Contact link not found');
  const { error } = await supabase.from('crm_listing_contacts').delete().eq('id', id);
  if (error) { console.error('[listing-contacts] DELETE', error); return NextResponse.json({ error: 'Could not remove' }, { status: 500 }); }
  return NextResponse.json({ deleted: true });
}
