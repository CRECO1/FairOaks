import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Unified, newest-first activity feed for one deal: emails, calls, meetings, stage changes
// (crm_deal_stage_history, written by a DB trigger), tags/mentions, dated notes and tasks.
// Gated by the parent deal, so private deals 404 for non-owners.

export type TimelineKind = 'email' | 'call' | 'meeting' | 'stage' | 'note' | 'tag' | 'task';
export interface TimelineItem {
  id: string; kind: TimelineKind; at: string; title: string; detail?: string | null;
  actor_id?: string | null; meta?: Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const dealId = req.nextUrl.searchParams.get('deal_id');
  if (!dealId) return NextResponse.json({ error: 'deal_id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
  const db = adminClient();

  const [emails, calls, meetings, stages, notes, tags, tasks] = await Promise.all([
    db.from('crm_deal_emails').select('id, direction, from_email, to_email, subject, email_date, opened_at').eq('deal_id', dealId).order('email_date', { ascending: false }).limit(200),
    db.from('crm_call_log').select('id, direction, result, caller_name, started_at, duration_sec, summary, notes, handled_by').eq('deal_id', dealId).order('started_at', { ascending: false }).limit(200),
    db.from('crm_deal_meetings').select('id, agent_id, meeting_date, title, note, created_at').eq('deal_id', dealId).order('meeting_date', { ascending: false }).limit(200),
    db.from('crm_deal_stage_history').select('id, from_stage, to_stage, changed_by, changed_at').eq('deal_id', dealId).order('changed_at', { ascending: false }).limit(200),
    db.from('crm_deal_notes').select('id, author_id, body, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(300),
    db.from('crm_notifications').select('id, sender_id, type, message, created_at, recipient_id').eq('entity_type', 'deal').eq('entity_id', dealId).order('created_at', { ascending: false }).limit(200),
    db.from('crm_tasks').select('id, title, due_date, status, created_by, created_at, type').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(100),
  ]);

  const items: TimelineItem[] = [];
  for (const e of emails.data ?? []) items.push({
    id: `email:${e.id}`, kind: 'email', at: e.email_date,
    title: `${e.direction === 'sent' ? 'Email sent' : 'Email received'}${e.subject ? ` — ${e.subject}` : ''}`,
    detail: e.direction === 'sent' ? `To ${e.to_email}` : `From ${e.from_email}`,
    meta: { direction: e.direction, opened: !!e.opened_at },
  });
  for (const c of calls.data ?? []) items.push({
    id: `call:${c.id}`, kind: 'call', at: c.started_at,
    title: `${c.direction === 'outbound' ? 'Outbound' : 'Inbound'} call${c.result ? ` · ${String(c.result).replace(/_/g, ' ')}` : ''}${c.duration_sec ? ` · ${Math.max(1, Math.round(c.duration_sec / 60))} min` : ''}`,
    detail: [c.summary, c.notes].filter(Boolean).join(' — ') || c.caller_name || null, actor_id: c.handled_by,
  });
  for (const m of meetings.data ?? []) items.push({
    id: `meeting:${m.id}`, kind: 'meeting', at: m.meeting_date && m.meeting_date.length <= 10 ? `${m.meeting_date}T12:00:00` : (m.meeting_date || m.created_at),
    title: `Meeting${m.title ? ` — ${m.title}` : ''}`, detail: m.note, actor_id: m.agent_id,
  });
  for (const s of stages.data ?? []) items.push({
    id: `stage:${s.id}`, kind: 'stage', at: s.changed_at,
    title: s.from_stage ? `Stage: ${s.from_stage} → ${s.to_stage}` : `Deal created in ${s.to_stage}`,
    actor_id: s.changed_by, meta: { from: s.from_stage, to: s.to_stage },
  });
  for (const n of notes.data ?? []) items.push({ id: `note:${n.id}`, kind: 'note', at: n.created_at, title: 'Note', detail: n.body, actor_id: n.author_id });
  for (const t of tags.data ?? []) items.push({
    id: `tag:${t.id}`, kind: 'tag', at: t.created_at,
    title: t.type === 'assignment' ? 'Teammate assigned' : 'Teammate mentioned', detail: t.message, actor_id: t.sender_id, meta: { recipient_id: t.recipient_id },
  });
  for (const t of tasks.data ?? []) items.push({
    id: `task:${t.id}`, kind: 'task', at: t.created_at,
    title: `Next step${t.status === 'done' || t.status === 'completed' ? ' (done)' : ''} — ${t.title}`,
    detail: t.due_date ? `Due ${String(t.due_date).slice(0, 10)}` : null, actor_id: t.created_by,
  });
  items.sort((a, b) => (a.at < b.at ? 1 : -1));

  const actorIds = Array.from(new Set(items.flatMap(i => [i.actor_id, i.meta?.recipient_id as string | undefined]).filter(Boolean))) as string[];
  const names: Record<string, string> = {};
  if (actorIds.length) {
    const { data: profs } = await db.from('crm_profiles').select('id, first_name, last_name').in('id', actorIds);
    for (const p of profs ?? []) names[p.id] = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  }
  return NextResponse.json({ items, names });
}
