import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, isSuperAdminRole, unauthorized, forbidden, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { notifyAssignment, senderName } from '@/lib/notify';

/**
 * PATCH /api/crm/clients/:id/owner  { agent_id }
 *
 * Reassign a contact (usually a brand-new lead) to another agent. Account owner (super_admin) only.
 * The owner is who the lead-SLA clock, the call-back task and the "who's on the site" alerts follow, so the
 * lead's own work moves with it:
 *   - the owner's open call / follow-up tasks on this contact, and
 *   - the contact's Prospect-stage deal(s) the old owner holds (the one the lead sync opened) —
 *     an Active / LOI / In Contract deal is real work in flight and stays where it is.
 * A deal handed to a super_admin becomes private (the insert trigger only covers new deals); handed to anyone else it
 * is ordinary — only the broker holds private deals.
 * A lead on hold is released by the lead_hold trigger when it is handed to anyone but the broker.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) return forbidden('Only the account owner can reassign a lead');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const body = await req.json().catch(() => null) as { agent_id?: string } | null;
  const newOwnerId = String(body?.agent_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(newOwnerId)) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });

  if (!(await assertOwnsResource('crm_clients', id, ctx))) return notFound();
  const db = adminClient();
  const { data: client } = await db.from('crm_clients').select('id, first_name, last_name, business_name, agent_id, business_unit').eq('id', id).maybeSingle();
  if (!client) return notFound();
  const { data: target } = await db.from('crm_profiles').select('id, first_name, last_name, role, business_unit').eq('id', newOwnerId).maybeSingle();
  if (!target) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 });
  if (target.business_unit !== client.business_unit) return forbidden('That agent is in another workspace');

  const prevId = (client.agent_id as string | null) ?? null;
  if (prevId === newOwnerId) return NextResponse.json({ agent_id: newOwnerId, unchanged: true });

  const { data: updated, error } = await db.from('crm_clients').update({ agent_id: newOwnerId }).eq('id', id).select('agent_id, lead_hold').single();
  if (error) return dbError('api/crm/clients/owner', error);

  // The lead's own work follows it. Best effort: the owner change above is what matters.
  let tasks = 0, deals = 0;
  if (prevId) {
    const { data: t } = await db.from('crm_tasks')
      .update({ agent_id: newOwnerId, assigned_to: newOwnerId })
      .eq('client_id', id).eq('agent_id', prevId).eq('status', 'open').is('completed_at', null).in('type', ['call', 'follow_up'])
      .select('id');
    tasks = t?.length ?? 0;
    // Only the broker (super_admin) may hold a private deal: handed to him it becomes private, handed to anyone else it is ordinary.
    const move = { agent_id: newOwnerId, is_restricted: target.role === 'super_admin' };
    const { data: d } = await db.from('crm_deals').update(move).eq('client_id', id).eq('agent_id', prevId).eq('stage', 'Prospect').select('id');
    deals = d?.length ?? 0;
  }

  const from = await senderName(db, ctx.userId);
  const toName = `${target.first_name ?? ''} ${target.last_name ?? ''}`.trim() || 'agent';
  const who = [client.first_name, client.last_name].filter(Boolean).join(' ') || (client.business_name as string) || 'a lead';
  const { data: prev } = prevId ? await db.from('crm_profiles').select('first_name, last_name').eq('id', prevId).maybeSingle() : { data: null };
  const fromName = prev ? `${prev.first_name ?? ''} ${prev.last_name ?? ''}`.trim() : 'no one';
  await db.from('crm_activity').insert([{ client_id: id, agent_id: ctx.userId, type: 'note', notes: `👤 Owner changed: ${fromName} → ${toName}`, business_unit: client.business_unit }]);
  await notifyAssignment(db, { recipientId: newOwnerId, senderId: ctx.userId, entityType: 'contact', entityId: id, message: `${from} assigned you a lead — ${who}` });

  return NextResponse.json({ agent_id: updated.agent_id, lead_hold: updated.lead_hold, tasks, deals, owner_name: toName });
}
