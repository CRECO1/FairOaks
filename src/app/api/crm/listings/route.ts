import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const unit = req.nextUrl.searchParams.get('business_unit') ?? 'commercial';
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_listings')
    .select('*')
    .eq('business_unit', unit)
    .order('created_at', { ascending: false });
  if (error) { console.error('[api] db error:', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  // Restricted folders are visible only to admins, the owner, and assigned teammates.
  const admin = isAdminRole(ctx.role);
  const visible = (data ?? []).filter((l: Record<string, unknown>) =>
    admin || !l.is_restricted || l.listing_agent_id === ctx.userId
    || (Array.isArray(l.assigned_agent_ids) && (l.assigned_agent_ids as string[]).includes(ctx.userId)));
  return NextResponse.json({ listings: visible });
}

export async function POST(req: NextRequest) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const body = await req.json();
  const { name, address, city, state, zip, type, status, asking_price, sq_ft, lot_size, year_built, description, notes, highlights, zoning, elevator, grade_level_doors, dock_high_doors, flyer_type, co_agent_id, listing_agent_id, assigned_agent_ids, is_restricted, business_unit } = body;
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_listings').insert({
    name, address: address || null, city: city || null, state: state || 'TX', zip: zip || null,
    type: type || 'Retail', status: status || 'active',
    asking_price: asking_price || null, sq_ft: sq_ft || null,
    lot_size: lot_size || null, year_built: year_built || null,
    description: description || null, notes: notes || null, highlights: highlights || null,
    flyer_type: flyer_type || null, co_agent_id: co_agent_id || null,
    zoning: zoning || null,
    // Tri-state: unanswered stays null rather than defaulting to "No".
    elevator: elevator ?? null, grade_level_doors: grade_level_doors ?? null, dock_high_doors: dock_high_doors ?? null,
    // Owner defaults to the creator so sharing has a natural owner from day one.
    listing_agent_id: listing_agent_id || caller.id,
    assigned_agent_ids: Array.isArray(assigned_agent_ids) ? assigned_agent_ids : [],
    is_restricted: !!is_restricted,
    business_unit: business_unit ?? 'commercial',
    created_by: caller.id,
  }).select().single();
  if (error) { console.error('[api] db error:', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  return NextResponse.json({ listing: data });
}
