import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const supabase = adminClient();

  let query = supabase
    .from('crm_action_plans')
    .select(`*, steps:crm_action_plan_steps(count), enrollment_count:crm_action_plan_enrollments(count)`)
    .order('created_at', { ascending: false })
    .limit(500);
  if (isAdminRole(ctx.role)) {
    const unit = new URL(req.url).searchParams.get('unit');
    if (unit) query = query.eq('business_unit', unit);
  } else {
    query = query.eq('business_unit', ctx.businessUnit);
  }

  const { data, error } = await query;

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  const plans = (data ?? []).map((p: any) => ({
    ...p,
    step_count: p.steps?.[0]?.count ?? 0,
    enrollment_count: p.enrollment_count?.[0]?.count ?? 0,
    steps: undefined,
  }));

  // Attach email open-tracking stats (sent + opened + open rate) per plan.
  const planIds = plans.map((p: any) => p.id);
  if (planIds.length) {
    const { data: sends } = await supabase
      .from('crm_action_plan_sends')
      .select('plan_id, opened_at')
      .in('plan_id', planIds)
      .limit(10000);
    const stat: Record<string, { sent: number; opened: number }> = {};
    for (const s of (sends ?? []) as { plan_id: string; opened_at: string | null }[]) {
      const st = (stat[s.plan_id] ??= { sent: 0, opened: 0 });
      st.sent++;
      if (s.opened_at) st.opened++;
    }
    for (const p of plans as any[]) {
      const st = stat[p.id];
      p.send_count = st?.sent ?? 0;
      p.open_count = st?.opened ?? 0;
      p.open_rate = st && st.sent > 0 ? Math.round((st.opened / st.sent) * 100) : null;
    }
  }

  return NextResponse.json({ plans });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json();
  const { name, description, trigger_type, trigger_value, status, completion_campaign_id, business_unit, from_name, from_email, audience } = body;

  if (!name || !trigger_type) {
    return NextResponse.json({ error: 'name and trigger_type are required' }, { status: 400 });
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_action_plans')
    .insert([{
      name,
      description: description ?? null,
      trigger_type,
      trigger_value: trigger_value ?? null,
      status: status ?? 'active',
      created_by: ctx.userId,
      completion_campaign_id: completion_campaign_id || null,
      // Optional per-plan sender override (e.g. send as a specific broker). Only honored
      // at send time when the address is on the unit's verified domain — see resolveActionPlanFrom.
      from_name: from_name || null,
      from_email: from_email || null,
      audience: audience || null, // optional client-type target for stage_change plans

      business_unit: isAdminRole(ctx.role) ? (business_unit ?? ctx.businessUnit ?? 'residential') : (ctx.businessUnit ?? 'residential'),
    }])
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ plan: data }, { status: 201 });
}
