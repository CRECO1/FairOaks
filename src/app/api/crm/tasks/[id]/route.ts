import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { validAssignee } from '@/lib/crm-assignee';
import { normalizeStatus, syncDone } from '@/lib/tasks-view';

/** For an agent, a task is theirs when they own it or are assigned to it (admins pass the ownership check regardless). */
const OWN_TASK = { ownerColumns: ['agent_id', 'assigned_to'], requireOwner: true };

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  // An admin may change any task in the workspace (bar a teammate's they are walled off from); an agent only their own — owner or assignee. This route
  // writes with the service key, so this check is the only gate: the database policy never sees the write.
  if (!(await assertOwnsResource('crm_tasks', id, ctx, OWN_TASK))) return notFound();

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const allowed = ['title','description','due_date','assigned_to','status','priority','client_id','deal_id'];
  const nowIso = new Date().toISOString();
  const update: Record<string,unknown> = { updated_at: nowIso };
  for (const k of allowed) if (k in body) update[k] = body[k] !== '' ? body[k] : null;
  if ('status' in body) {
    // Only the three statuses the Tasks page knows ("completed" from the old Copilot tool counts as done) — anything else used to be stored as-is and made the task vanish from the board.
    const s = normalizeStatus(body.status);
    if (!s) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    update.status = s;
  }
  // A re-linked client/deal must be in the caller's workspace (mirrors POST /api/crm/tasks).
  if (update.client_id && !(await assertOwnsResource('crm_clients', String(update.client_id), ctx))) return NextResponse.json({ error: 'Invalid client_id' }, { status: 400 });
  if (update.deal_id && !(await assertOwnsResource('crm_deals', String(update.deal_id), ctx))) return NextResponse.json({ error: 'Invalid deal_id' }, { status: 400 });
  if (update.assigned_to && !(await validAssignee(String(update.assigned_to), ctx))) return NextResponse.json({ error: 'Invalid assigned_to' }, { status: 400 });
  const supabase = adminClient();
  // Keep "done" in step everywhere: the Dashboard and Call Queue read completed_at, this page reads status. A task marked done here
  // gets its completed_at (reopening clears it), and a new assignee also becomes the agent the Call Queue files it under.
  const { data: cur } = await supabase.from('crm_tasks').select('status, completed_at').eq('id', id).maybeSingle();
  Object.assign(update, syncDone(cur ?? {}, update, nowIso));
  const { data, error } = await supabase.from('crm_tasks').update(update).eq('id', id).select().single();
  if (error) return dbError('api/crm/tasks/[id]', error);
  return NextResponse.json({ task: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertOwnsResource('crm_tasks', id, ctx, OWN_TASK))) return notFound();

  const supabase = adminClient();
  const { error } = await supabase.from('crm_tasks').delete().eq('id', id);
  if (error) return dbError('api/crm/tasks/[id]', error);
  return NextResponse.json({ deleted: true });
}
