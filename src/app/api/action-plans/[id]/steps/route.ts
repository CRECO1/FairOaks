import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

const VALID_TYPES = ['email', 'sms', 'task', 'note'] as const;

type StepInput = {
  step_order?: number;
  type: string;
  delay_days?: number;
  subject?: string;
  body: string;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { id } = await params;
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_action_plan_steps')
    .select('*')
    .eq('plan_id', id)
    .order('step_order', { ascending: true });

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ steps: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { id } = await params;
  const body = await req.json();
  const { step_order, type, delay_days, subject, body: stepBody } = body;

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    );
  }
  if (!stepBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_action_plan_steps')
    .insert([{
      plan_id: id,
      step_order: step_order ?? 0,
      type,
      delay_days: delay_days ?? 0,
      subject: subject ?? null,
      body: stepBody,
    }])
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ step: data }, { status: 201 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { id } = await params;
  const body = await req.json();
  const { steps } = body;

  if (!Array.isArray(steps)) {
    return NextResponse.json({ error: 'steps must be an array' }, { status: 400 });
  }
  if (steps.length > 100) {
    return NextResponse.json({ error: 'Action plans may not have more than 100 steps' }, { status: 400 });
  }

  const supabase = adminClient();

  // Delete existing steps for this plan
  const { error: deleteError } = await supabase
    .from('crm_action_plan_steps')
    .delete()
    .eq('plan_id', id);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  if (steps.length === 0) {
    return NextResponse.json({ steps: [] });
  }

  const rows = (steps as StepInput[]).map((s) => ({
    plan_id: id,
    step_order: s.step_order ?? 0,
    type: s.type,
    delay_days: s.delay_days ?? 0,
    subject: s.subject ?? null,
    body: s.body,
  }));

  const { data, error } = await supabase
    .from('crm_action_plan_steps')
    .insert(rows)
    .select();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  // Return steps sorted by step_order
  const sorted = (data ?? []).sort((a, b) => (a.step_order as number) - (b.step_order as number));
  return NextResponse.json({ steps: sorted });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const stepId = searchParams.get('stepId');

  if (!stepId) {
    return NextResponse.json({ error: 'stepId query param is required' }, { status: 400 });
  }

  const supabase = adminClient();
  const { error } = await supabase
    .from('crm_action_plan_steps')
    .delete()
    .eq('id', stepId)
    .eq('plan_id', id);

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
