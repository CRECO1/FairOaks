import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, assertOwnsResource, unauthorized, forbidden, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const ALLOWED = new Set([
  'sale_price', 'commission_rate', 'agent_split', 'agent_id',
  'referral_fee', 'referral_to', 'transaction_fee', 'status',
  'close_date', 'paid_date', 'notes', 'deal_type',
]);

// Non-admins read/write only commissions where they are the agent or the creator (matches the list
// route, which pins agents to their own rows). Admins bypass both checks. Non-admins may edit only
// `notes`; money, status, agent and date fields are admin-only.
const AGENT_EDITABLE = new Set(['notes']);
const OWNER_COLUMNS = ['agent_id', 'created_by'];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertOwnsResource('crm_commissions', id, ctx, { ownerColumns: OWNER_COLUMNS, requireOwner: true }))) {
    return notFound('Resource not found.');
  }

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
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertOwnsResource('crm_commissions', id, ctx, { ownerColumns: OWNER_COLUMNS, requireOwner: true }))) {
    return notFound('Resource not found.');
  }

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const admin = isAdminRole(ctx.role);
  for (const key of Object.keys(body)) {
    if (!ALLOWED.has(key)) continue;
    if (!admin && !AGENT_EDITABLE.has(key)) return forbidden('Only an admin can change commission amounts, status, agent or dates.');
    safe[key] = body[key];
  }
  if (admin) {
    const num = (k: string, max: number) => k in safe && safe[k] != null && !(Number.isFinite(Number(safe[k])) && Number(safe[k]) >= 0 && Number(safe[k]) <= max);
    if (['sale_price', 'referral_fee', 'transaction_fee'].some(k => num(k, 1e11)) || ['commission_rate', 'agent_split'].some(k => num(k, 100))) {
      return NextResponse.json({ error: 'Amounts must be non-negative numbers (rate and split 0-100).' }, { status: 400 });
    }
    if ('status' in safe && !['pending', 'paid', 'disputed'].includes(safe.status as string)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_commissions')
    .update(safe)
    .eq('id', id)
    .select()
    .single();
  if (error) return dbError('api/crm/commissions/[id]', error);
  return NextResponse.json({ commission: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertOwnsResource('crm_commissions', id, ctx, { ownerColumns: OWNER_COLUMNS, requireOwner: true }))) {
    return notFound('Resource not found.');
  }

  const supabase = adminClient();
  const { error } = await supabase.from('crm_commissions').delete().eq('id', id);
  if (error) return dbError('api/crm/commissions/[id]', error);
  return NextResponse.json({ success: true });
}
