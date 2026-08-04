import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const VALID_UNITS = ['residential', 'commercial'] as const;
type BusinessUnit = typeof VALID_UNITS[number];
function toUnit(val: string | null, fallback: BusinessUnit = 'commercial'): BusinessUnit {
  return VALID_UNITS.includes(val as BusinessUnit) ? (val as BusinessUnit) : fallback;
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const requested = toUnit(req.nextUrl.searchParams.get('unit'));
  // Agents are confined to their own workspace; only admins may read another unit.
  const unit = isAdminRole(ctx.role) ? requested : (toUnit(ctx.businessUnit));
  const status = req.nextUrl.searchParams.get('status') ?? 'open';
  const assignedTo = req.nextUrl.searchParams.get('assigned_to');
  const supabase = adminClient();
  let q = supabase.from('crm_tasks')
    .select(`*, client:crm_clients(id,first_name,last_name,email), assignee:crm_profiles!assigned_to(id,first_name,last_name)`)
    .eq('business_unit', unit)
    .order('due_date', { ascending: true, nullsFirst: false });
  if (status !== 'all') q = q.eq('status', status);
  if (assignedTo) q = q.eq('assigned_to', assignedTo);
  const { data, error } = await q;
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json();
  const { title, description, due_date, assigned_to, client_id, deal_id, priority, business_unit } = body;
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  // Non-admins can only create tasks in their own workspace.
  const unit = isAdminRole(ctx.role) ? toUnit(business_unit ?? null) : toUnit(ctx.businessUnit);
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_tasks').insert({
    title, description, due_date: due_date || null, assigned_to: assigned_to || null,
    client_id: client_id || null, deal_id: deal_id || null,
    priority: priority ?? 'normal', business_unit: unit,
    created_by: ctx.userId,
  }).select().single();
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ task: data });
}
