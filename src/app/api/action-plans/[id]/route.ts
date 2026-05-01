import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_action_plans')
    .select(`*, steps:crm_action_plan_steps(*)`)
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // Sort steps by step_order in JS (embedded ordering not supported in select string)
  if (data?.steps) {
    data.steps = (data.steps as any[]).sort((a, b) => a.step_order - b.step_order);
  }

  return NextResponse.json({ plan: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, description, trigger_type, trigger_value, status, completion_campaign_id } = body;

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_action_plans')
    .update({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(trigger_type !== undefined && { trigger_type }),
      ...(trigger_value !== undefined && { trigger_value }),
      ...(status !== undefined && { status }),
      ...(completion_campaign_id !== undefined && { completion_campaign_id: completion_campaign_id || null }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ plan: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = adminClient();
  const { error } = await supabase.from('crm_action_plans').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
