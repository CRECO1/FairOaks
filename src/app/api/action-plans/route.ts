import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const supabase = adminClient();
  const unit = new URL(req.url).searchParams.get('unit');

  let query = supabase
    .from('crm_action_plans')
    .select(`*, steps:crm_action_plan_steps(count), enrollment_count:crm_action_plan_enrollments(count)`)
    .order('created_at', { ascending: false })
    .limit(500);
  if (unit) query = query.eq('business_unit', unit);

  const { data, error } = await query;

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  const plans = (data ?? []).map((p: any) => ({
    ...p,
    step_count: p.steps?.[0]?.count ?? 0,
    enrollment_count: p.enrollment_count?.[0]?.count ?? 0,
    steps: undefined,
  }));

  return NextResponse.json({ plans });
}

export async function POST(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const body = await req.json();
  const { name, description, trigger_type, trigger_value, status, created_by, completion_campaign_id, business_unit } = body;

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
      created_by: created_by ?? null,
      completion_campaign_id: completion_campaign_id || null,
      business_unit: business_unit ?? 'residential',
    }])
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ plan: data }, { status: 201 });
}
