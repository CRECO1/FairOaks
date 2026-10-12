import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, forbidden, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Hand a call list to an agent: one open 'call' task per person in that agent's Call Queue.
// POST { assigned_to, due_date?: 'YYYY-MM-DD', items: [{ client_id, title, description?, priority? }] }
//   - An agent may only assign to themselves; an admin may assign to anyone in the CRM.
//   - People who already have an open call / follow-up task with that agent are skipped, so assigning
//     the same list twice (or a list that overlaps their own follow-ups) never doubles anyone up.
const MAX_ITEMS = 300;

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => null) as { assigned_to?: string; due_date?: string; business_unit?: string; set_owner?: boolean; refresh_existing?: boolean; items?: { client_id?: string; title?: string; description?: string; priority?: string }[] } | null;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: 'items required' }, { status: 400 });
  if (body.items.length > MAX_ITEMS) return NextResponse.json({ error: `Assign at most ${MAX_ITEMS} at a time` }, { status: 400 });

  const admin = isAdminRole(ctx.role);
  const assignee = String(body.assigned_to || ctx.userId);
  if (assignee !== ctx.userId && !admin) return forbidden('Only an admin can assign calls to someone else');
  const unit = admin ? (body.business_unit || ctx.businessUnit || 'commercial') : (ctx.businessUnit || 'commercial');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(body.due_date ?? '')) ? String(body.due_date) : new Date().toISOString().slice(0, 10);

  const db = adminClient();
  const { data: who } = await db.from('crm_profiles').select('id, first_name, last_name, business_unit, role').eq('id', assignee).maybeSingle();
  if (!who) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 });
  if (!admin && who.business_unit !== unit) return forbidden('That agent is in another workspace');

  const wanted = body.items.filter(i => i?.client_id && i?.title).map(i => ({ ...i, client_id: String(i.client_id) }));
  const ids = [...new Set(wanted.map(i => i.client_id))];
  if (!ids.length) return NextResponse.json({ error: 'No valid people to assign' }, { status: 400 });

  // Only contacts in this workspace.
  const valid = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db.from('crm_clients').select('id').in('id', ids.slice(i, i + 150)).eq('business_unit', unit);
    for (const c of data ?? []) valid.add(c.id as string);
  }
  // Already in that agent's queue.
  const existing = new Set<string>();
  const existingId = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db.from('crm_tasks').select('id, client_id')
      .eq('agent_id', assignee).eq('status', 'open').is('completed_at', null).in('type', ['call', 'follow_up']).in('client_id', ids.slice(i, i + 150));
    for (const t of data ?? []) if (t.client_id) { existing.add(t.client_id as string); existingId.set(t.client_id as string, t.id as string); }
  }

  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  let skippedExisting = 0, skippedInvalid = 0, refreshed = 0;
  for (const it of wanted) {
    if (seen.has(it.client_id)) continue;
    seen.add(it.client_id);
    if (!valid.has(it.client_id)) { skippedInvalid++; continue; }
    if (existing.has(it.client_id)) {
      // Same person, already in that agent's queue: optionally bring the task's context up to date (campaign, ask-for).
      if (body.refresh_existing && existingId.get(it.client_id)) {
        const { error: uerr } = await db.from('crm_tasks').update({ title: String(it.title).slice(0, 300), description: it.description ? String(it.description).slice(0, 2000) : null, priority: it.priority === 'high' ? 'high' : 'normal' }).eq('id', existingId.get(it.client_id)!);
        if (!uerr) refreshed++;
      }
      skippedExisting++; continue;
    }
    rows.push({
      title: String(it.title).slice(0, 300), description: it.description ? String(it.description).slice(0, 2000) : null,
      due_date: due, assigned_to: assignee, agent_id: assignee, client_id: it.client_id, type: 'call',
      priority: it.priority === 'high' ? 'high' : 'normal', status: 'open', business_unit: unit, created_by: ctx.userId,
    });
  }
  if (rows.length) {
    const { error } = await db.from('crm_tasks').insert(rows);
    if (error) return dbError('api/crm/tasks/assign-calls', error);
  }
  // New leads: assigning the call also makes them the contact's owner (the lead-SLA clock and the alerts follow the owner).
  let owned = 0;
  if (body.set_owner && admin && valid.size) {
    const { data, error } = await db.from('crm_clients').update({ agent_id: assignee }).in('id', [...valid]).eq('business_unit', unit).select('id');
    if (!error) owned = data?.length ?? 0;
  }
  return NextResponse.json({
    owned,
    refreshed,
    created: rows.length, skipped_existing: skippedExisting, skipped_invalid: skippedInvalid,
    assignee_name: `${who.first_name ?? ''} ${who.last_name ?? ''}`.trim() || 'agent',
  });
}
