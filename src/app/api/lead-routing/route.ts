import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  const unit = req.nextUrl.searchParams.get('unit') ?? 'commercial';
  const supabase = adminClient();
  const { data } = await supabase.from('lead_routing_rules')
    .select('*, agent:crm_profiles!assign_to_agent_id(id,first_name,last_name)')
    .eq('business_unit', unit)
    .order('priority', { ascending: false });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const caller = await getCrmAdmin();
  if (!caller) return unauthorized();
  const body = await req.json();
  const { business_unit, source, property_keyword, assign_to_agent_id, priority } = body;
  if (!assign_to_agent_id) return NextResponse.json({ error: 'assign_to_agent_id required' }, { status: 400 });
  const supabase = adminClient();
  const { data, error } = await supabase.from('lead_routing_rules').insert({ business_unit: business_unit ?? 'commercial', source, property_keyword, assign_to_agent_id, priority: priority ?? 0 }).select().single();
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ rule: data });
}

export async function DELETE(req: NextRequest) {
  const caller = await getCrmAdmin();
  if (!caller) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = adminClient();
  await supabase.from('lead_routing_rules').delete().eq('id', id);
  return NextResponse.json({ deleted: true });
}
