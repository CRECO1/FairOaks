import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmAdmin, unauthorized, forbidden, notFound, isAdminRole } from '@/lib/crm-auth';
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

  if (error || !data) { console.error("[api] not found error:", error); return NextResponse.json({ error: "Resource not found." }, { status: 404 }); }
  if (!isAdminRole(ctx.role) && data.business_unit !== ctx.businessUnit) return notFound('Resource not found.');

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
  const { name, description, trigger_type, trigger_value, status, completion_campaign_id, created_by } = body;

  const supabase = adminClient();

  // Workspace isolation — an agent may only touch plans in their own business_unit.
  const { data: existing } = await supabase
    .from('crm_action_plans')
    .select('status, business_unit, created_by')
    .eq('id', id)
    .single();
  if (!existing) return notFound('Resource not found.');
  const isAdmin = isAdminRole(ctx.role);
  if (!isAdmin && existing.business_unit !== ctx.businessUnit) return notFound('Resource not found.');

  // Activating a plan starts real automated sends — admins or the plan's owner only.
  const isOwner = existing.created_by === ctx.userId;
  if (status === 'active' && existing.status !== 'active' && !isAdmin && !isOwner) {
    return forbidden('Forbidden — only the plan owner or an admin can activate an action plan');
  }

  // `created_by` is an ownership field: reassignment is admin-only (the owner dropdown is
  // already admin-gated in the UI), so an agent can't hand a plan to — or take it from —
  // someone else via a crafted PATCH body.
  const reassignOwner = created_by !== undefined && isAdmin;

  const { data, error } = await supabase
    .from('crm_action_plans')
    .update({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(trigger_type !== undefined && { trigger_type }),
      ...(trigger_value !== undefined && { trigger_value }),
      ...(status !== undefined && { status }),
      ...(completion_campaign_id !== undefined && { completion_campaign_id: completion_campaign_id || null }),
      ...(reassignOwner && { created_by }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ plan: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Admin-only — action plan deletion affects all enrolled contacts
  const admin = await getCrmAdmin(req);
  if (!admin) return forbidden();

  const { id } = await params;
  const supabase = adminClient();
  const { error } = await supabase.from('crm_action_plans').delete().eq('id', id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ success: true });
}
