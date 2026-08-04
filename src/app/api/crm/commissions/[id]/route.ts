import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const ALLOWED = new Set([
  'sale_price', 'commission_rate', 'agent_split', 'agent_id',
  'referral_fee', 'referral_to', 'transaction_fee', 'status',
  'close_date', 'paid_date', 'notes', 'deal_type',
]);

/**
 * Loads a commission and enforces access. Returns the row when the caller may see it,
 * otherwise null. Admins/super-admins see everything; agents are limited to their own
 * business_unit. `requireOwner` additionally restricts mutations to the agent that owns
 * the record (agent_id or created_by).
 */
async function loadScoped(
  supabase: ReturnType<typeof adminClient>,
  id: string,
  ctx: { userId: string; role: string | null; businessUnit: string | null },
  requireOwner = false,
) {
  const { data } = await supabase
    .from('crm_commissions')
    .select('id, business_unit, agent_id, created_by')
    .eq('id', id)
    .single();
  if (!data) return null;
  if (isAdminRole(ctx.role)) return data;
  if (data.business_unit !== ctx.businessUnit) return null;
  if (requireOwner && data.agent_id !== ctx.userId && data.created_by !== ctx.userId) return null;
  return data;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();
  if (!(await loadScoped(supabase, id, ctx))) return notFound('Resource not found.');

  const { data, error } = await supabase
    .from('crm_commissions')
    .select(`*, deal:crm_deals(id,client,property,type,stage,value), agent:crm_profiles!agent_id(id,first_name,last_name)`)
    .eq('id', id)
    .single();
  if (error) { console.error("[api] not found error:", error); return NextResponse.json({ error: "Resource not found." }, { status: 404 }); }
  return NextResponse.json({ commission: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();
  if (!(await loadScoped(supabase, id, ctx, true))) return notFound('Resource not found.');

  const body = await req.json();
  const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of Object.keys(body)) {
    if (ALLOWED.has(key)) safe[key] = body[key];
  }

  const { data, error } = await supabase
    .from('crm_commissions')
    .update(safe)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ commission: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();
  if (!(await loadScoped(supabase, id, ctx, true))) return notFound('Resource not found.');

  const { error } = await supabase.from('crm_commissions').delete().eq('id', id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
