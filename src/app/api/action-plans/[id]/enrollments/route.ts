import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
function adminClient() { return createClient(SUPABASE_URL, SERVICE_KEY); }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_action_plan_enrollments')
    .select(`*, client:crm_clients(id, first_name, last_name, email, type)`)
    .eq('plan_id', id)
    .order('started_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enrollments: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { client_ids, agent_id } = body;

  if (!client_ids?.length) {
    return NextResponse.json({ error: 'client_ids is required and must not be empty' }, { status: 400 });
  }
  if (!agent_id) {
    return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
  }

  const supabase = adminClient();
  const now = new Date().toISOString();

  const rows = (client_ids as string[]).map((client_id) => ({
    plan_id: id,
    client_id,
    agent_id,
    active: true,
    current_step: 0,
    next_step_at: now,
  }));

  const { data, error } = await supabase
    .from('crm_action_plan_enrollments')
    .upsert(rows, { onConflict: 'plan_id,client_id', ignoreDuplicates: false })
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enrolled: data?.length ?? 0 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
