import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  const { id } = await params;
  const body = await req.json();
  const allowed = ['title','description','due_date','assigned_to','status','priority'];
  const update: Record<string,unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in body) update[k] = body[k] ?? null;
  const supabase = adminClient();
  // Keep status and completed_at consistent: stamp completed_at when a task
  // becomes 'done' (preserving an existing timestamp), clear it otherwise.
  if ('status' in body) {
    if (body.status === 'done') {
      const { data: existing } = await supabase.from('crm_tasks').select('completed_at').eq('id', id).single();
      if (!existing?.completed_at) update.completed_at = new Date().toISOString();
    } else {
      update.completed_at = null;
    }
  }
  const { data, error } = await supabase.from('crm_tasks').update(update).eq('id', id).select().single();
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ task: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();
  const { error } = await supabase.from('crm_tasks').delete().eq('id', id);
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ deleted: true });
}
