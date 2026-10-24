import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, isAdminRole, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  if (!(await assertOwnsResource('crm_action_plans', id, ctx))) return notFound('Plan not found');
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_action_plan_enrollments')
    .select(`*, client:crm_clients(id, first_name, last_name, email, type)`)
    .eq('plan_id', id)
    .order('started_at', { ascending: false });

  if (error) return dbError('api/action-plans/[id]/enrollments', error);
  return NextResponse.json({ enrollments: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const plan = await assertOwnsResource('crm_action_plans', id, ctx);
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const { client_ids, agent_id: bodyAgentId } = body;
  const isAdmin = isAdminRole(ctx.role);
  // Enrolling starts automated sends in the agent's name: agents enroll as themselves, admins may choose.
  const agent_id = isAdmin ? bodyAgentId : ctx.userId;

  if (!client_ids?.length) {
    return NextResponse.json({ error: 'client_ids is required and must not be empty' }, { status: 400 });
  }
  if (!agent_id) {
    return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
  }
  if (!UUID_RE.test(String(agent_id))) return NextResponse.json({ error: 'agent_id is invalid' }, { status: 400 });

  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!Array.isArray(client_ids) || client_ids.length > 5000 || !client_ids.every((c: unknown) => typeof c === 'string' && UUID_RE.test(c))) {
    return NextResponse.json({ error: 'client_ids must be a list of client ids' }, { status: 400 });
  }
  const ids = Array.from(new Set(client_ids as string[]));

  // Only clients in the plan's workspace can be enrolled (admins: any existing client). Ids that aren't
  // found, and unsubscribed clients, are dropped. Queried in chunks to keep the PostgREST URL short.
  const clients: { id: string; unsubscribed_at: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    let q = supabase.from('crm_clients').select('id, unsubscribed_at').in('id', ids.slice(i, i + 200));
    if (!isAdmin) q = q.eq('business_unit', plan.business_unit as string);
    const { data: found, error: findErr } = await q;
    if (findErr) return dbError('api/action-plans/[id]/enrollments', findErr);
    clients.push(...((found ?? []) as typeof clients));
  }
  const eligible = clients.filter(c => !c.unsubscribed_at).map(c => c.id);

  // Never reset a running or finished enrollment (the old upsert zeroed current_step / re-activated
  // everyone, which re-sent step 1 to people already mid-plan or finished). New clients are inserted;
  // an enrollment that was switched off is reactivated; a COMPLETED one is only restarted by an admin.
  const existing: { client_id: string; active: boolean; completed_at: string | null }[] = [];
  for (let i = 0; i < eligible.length; i += 200) {
    const { data: ex } = await supabase.from('crm_action_plan_enrollments').select('client_id, active, completed_at')
      .eq('plan_id', id).in('client_id', eligible.slice(i, i + 200));
    existing.push(...((ex ?? []) as typeof existing));
  }
  const exMap = new Map(existing.map(e => [e.client_id, e]));
  const rows = eligible
    .filter(cid => { const e = exMap.get(cid); return !e || (!e.active && (isAdmin || !e.completed_at)); })
    .map((client_id) => ({
      plan_id: id,
      client_id,
      agent_id,
      active: true,
      current_step: 0,
      next_step_at: now,
      ...(exMap.has(client_id) && { completed_at: null }),
    }));

  if (!rows.length) return NextResponse.json({ enrolled: 0, skipped: ids.length });
  const { data, error } = await supabase
    .from('crm_action_plan_enrollments')
    .upsert(rows, { onConflict: 'plan_id,client_id', ignoreDuplicates: false })
    .select();

  if (error) return dbError('api/action-plans/[id]/enrollments', error);
  return NextResponse.json({ enrolled: data?.length ?? 0, skipped: ids.length - (data?.length ?? 0) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  if (!(await assertOwnsResource('crm_action_plans', id, ctx))) return notFound('Plan not found');
  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const { client_id } = body;

  if (!client_id) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  }

  const supabase = adminClient();
  const { error } = await supabase
    .from('crm_action_plan_enrollments')
    .update({ active: false })
    .eq('plan_id', id)
    .eq('client_id', client_id);

  if (error) return dbError('api/action-plans/[id]/enrollments', error);
  return NextResponse.json({ success: true });
}
