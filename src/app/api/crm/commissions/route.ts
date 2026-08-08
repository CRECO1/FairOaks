import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { searchParams } = req.nextUrl;
  const businessUnit = searchParams.get('business_unit') ?? 'commercial';
  const agentId      = searchParams.get('agent_id');
  const status       = searchParams.get('status');
  const year         = searchParams.get('year');

  const dealId = searchParams.get('deal_id');

  const supabase = adminClient();
  let q = supabase
    .from('crm_commissions')
    .select(`*, deal:crm_deals(id,client,property,type,stage,value), agent:crm_profiles!agent_id(id,first_name,last_name)`)
    .eq('business_unit', businessUnit)
    .order('close_date', { ascending: false, nullsFirst: false });

  if (dealId)  q = q.eq('deal_id', dealId);
  if (agentId) q = q.eq('agent_id', agentId);
  if (status)  q = q.eq('status', status);
  if (year)    q = q.gte('close_date', `${year}-01-01`).lte('close_date', `${year}-12-31`);

  const { data, error } = await q;
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ commissions: data ?? [] });
}

export async function POST(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const body = await req.json();
  const {
    deal_id, agent_id, business_unit, sale_price, deal_type,
    commission_rate, agent_split, referral_fee, referral_to,
    transaction_fee, status, close_date, paid_date, notes,
  } = body;

  if (!deal_id) return NextResponse.json({ error: 'deal_id required' }, { status: 400 });
  if (!sale_price || isNaN(Number(sale_price))) return NextResponse.json({ error: 'valid sale_price required' }, { status: 400 });

  const sp    = Number(sale_price);
  const rate  = Number(commission_rate ?? 3);
  const split = Number(agent_split ?? 70);
  const ref   = Number(referral_fee ?? 0);
  const txFee = Number(transaction_fee ?? 0);
  // gross_commission, agent_net, brokerage_net are generated columns — DB computes them automatically

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_commissions')
    .upsert({
      deal_id,
      agent_id:        agent_id    ?? null,
      business_unit:   business_unit ?? 'commercial',
      sale_price:      sp,
      deal_type:       deal_type   ?? null,
      commission_rate: rate,
      agent_split:     split,
      referral_fee:    ref,
      referral_to:     referral_to  ?? null,
      transaction_fee: txFee,
      status:          status       ?? 'pending',
      close_date:      close_date   ?? null,
      paid_date:       paid_date    ?? null,
      notes:           notes        ?? null,
      created_by:      caller.id,
    }, { onConflict: 'deal_id', ignoreDuplicates: false })
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ commission: data });
}

