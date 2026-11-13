import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { notifyTeammates } from '@/lib/teammate-notify';

// POST { entity_type: 'deal'|'contact', entity_id, user_ids: string[], kind?: 'assignment'|'mention', excerpt? }
// Called after a teammate is newly assigned/tagged on a deal or contact. Server-side so the
// de-dupe, self-skip and notify_email opt-out cannot be bypassed by the browser. Only people
// who are genuinely on the record (owner or assigned) can be notified — a caller can't use this
// to spam arbitrary teammates.
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => null);
  const entityType = b?.entity_type === 'contact' ? 'contact' : b?.entity_type === 'deal' ? 'deal' : null;
  const entityId = String(b?.entity_id ?? '');
  const userIds: string[] = Array.isArray(b?.user_ids) ? b.user_ids.map(String) : [];
  if (!entityType || !entityId || !userIds.length) return NextResponse.json({ error: 'entity_type, entity_id, user_ids required' }, { status: 400 });

  const table = entityType === 'deal' ? 'crm_deals' : 'crm_clients';
  const row = await assertOwnsResource(table, entityId, ctx);
  if (!row) return notFound('Not found');

  const { data: full } = await adminClient().from(table)
    .select(entityType === 'deal' ? 'client, property, agent_id, assigned_agent_ids' : 'first_name, last_name, business_name, agent_id, assigned_agent_ids')
    .eq('id', entityId).maybeSingle();
  const f = (full ?? {}) as Record<string, any>;
  const onRecord = new Set<string>([f.agent_id, ...(f.assigned_agent_ids ?? [])].filter(Boolean));
  const kind = b?.kind === 'mention' ? 'mention' : 'assignment';
  // Assignments only go to people actually on the record; a mention can tag any teammate.
  const targets = kind === 'mention' ? userIds : userIds.filter(id => onRecord.has(id));
  const label = entityType === 'deal'
    ? [f.client, f.property].filter(Boolean).join(' — ') || 'a deal'
    : f.business_name || `${f.first_name ?? ''} ${f.last_name ?? ''}`.trim() || 'a contact';

  const r = await notifyTeammates({
    kind, excerpt: kind === 'mention' ? String(b?.excerpt ?? '').slice(0, 1000) : undefined, recipientIds: targets, actorId: ctx.userId, entityType, entityId, entityLabel: label,
    restricted: entityType === 'deal' && !!row.is_restricted, allowedIds: [...onRecord],
  }).catch(e => { console.error('[notify-assignment]', e); return { notified: 0, emailed: 0, skipped: 0 }; });
  return NextResponse.json(r);
}
