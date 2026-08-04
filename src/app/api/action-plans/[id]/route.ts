import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmAdmin, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_action_plans')
    .select(`*, steps:crm_action_plan_steps(*)`)
    .eq('id', id)
    .single();

  if (error) { console.error("[api] not found error:", error); return NextResponse.json({ error: "Resource not found." }, { status: 404 }); }

  // Sort steps by step_order in JS (embedded ordering not supported in select string)
  if (data?.steps) {
    data.steps = (data.steps as { step_order: number }[]).sort((a, b) => a.step_order - b.step_order);
  }

  return NextResponse.json({ plan: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const body = await req.json();
  // created_by is intentionally NOT destructured — ownership cannot be reassigned via PATCH.
  const { name, description, trigger_type, trigger_value, status, completion_campaign_id } = body;

  const supabase = adminClient();

  // Enforce workspace isolation.
  const { data: existing } = await supabase.from('crm_action_plans').select('business_unit').eq('id', id).single();
  if (!existing) return notFound();
  if (!isAdminRole(ctx.role) && existing.business_unit !== ctx.businessUnit) return notFound();
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

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ plan: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Admin-only — action plan deletion affects all enrolled contacts
  const admin = await getCrmAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  const { id } = await params;
  const supabase = adminClient();
  const { error } = await supabase.from('crm_action_plans').delete().eq('id', id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
