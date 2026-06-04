import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const ALLOWED = new Set([
  'sale_price', 'commission_rate', 'agent_split', 'agent_id',
  'referral_fee', 'referral_to', 'transaction_fee', 'status',
  'close_date', 'paid_date', 'notes', 'deal_type',
]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_commissions')
    .select(`*, deal:crm_deals(id,client,property,type,stage,value), agent:crm_profiles!agent_id(id,first_name,last_name)`)
    .eq('id', id)
    .single();
  if (error) { console.error("[api] not found error:", error); return NextResponse.json({ error: "Resource not found." }, { status: 404 }); }
  return NextResponse.json({ commission: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  const { id } = await params;
  const body = await req.json();

  const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of Object.keys(body)) {
    if (ALLOWED.has(key)) safe[key] = body[key];
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_commissions')
    .update(safe)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ commission: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();
  const { error } = await supabase.from('crm_commissions').delete().eq('id', id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
