import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const unit = req.nextUrl.searchParams.get('business_unit') ?? 'commercial';
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_listings')
    .select('*')
    .eq('business_unit', unit)
    .order('created_at', { ascending: false });
  if (error) { console.error('[api] db error:', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  return NextResponse.json({ listings: data ?? [] });
}

export async function POST(req: NextRequest) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const body = await req.json();
  const { name, address, city, state, zip, type, status, asking_price, sq_ft, lot_size, year_built, description, notes, listing_agent_id, business_unit } = body;
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_listings').insert({
    name, address: address || null, city: city || null, state: state || 'TX', zip: zip || null,
    type: type || 'Retail', status: status || 'active',
    asking_price: asking_price || null, sq_ft: sq_ft || null,
    lot_size: lot_size || null, year_built: year_built || null,
    description: description || null, notes: notes || null,
    listing_agent_id: listing_agent_id || null,
    business_unit: business_unit ?? 'commercial',
    created_by: caller.id,
  }).select().single();
  if (error) { console.error('[api] db error:', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  return NextResponse.json({ listing: data });
}
