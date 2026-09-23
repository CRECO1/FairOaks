import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  // Tasks are shared across a workspace, so business_unit is the scope (admins bypass).
  if (!(await assertOwnsResource('crm_tasks', id, ctx))) return notFound();

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const allowed = ['title','description','due_date','assigned_to','status','priority','client_id','deal_id'];
  const update: Record<string,unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in body) update[k] = body[k] !== '' ? body[k] : null;
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_tasks').update(update).eq('id', id).select().single();
  if (error) return dbError('api/crm/tasks/[id]', error);
  return NextResponse.json({ task: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertOwnsResource('crm_tasks', id, ctx))) return notFound();

  const supabase = adminClient();
  const { error } = await supabase.from('crm_tasks').delete().eq('id', id);
  if (error) return dbError('api/crm/tasks/[id]', error);
  return NextResponse.json({ deleted: true });
}
