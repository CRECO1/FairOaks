import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, hiddenDealIds, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { onDeal } from '@/lib/deal-access';

export const dynamic = 'force-dynamic';

// The "who am I writing to" strip in the Emails reader: a contact's deals (with stage), what's still open for them,
// and the last thing logged on their card — so you see the relationship before you reply. Read-only, same access
// rules as everywhere else: the contact must be in the caller's workspace, and private deals stay private.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  if (!UUID_RE.test(clientId)) return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_clients', clientId, ctx))) return notFound('Contact not found');

  const db = adminClient();
  let dq = db.from('crm_deals').select('id, property, stage, type, last_touch, agent_id, assigned_agent_ids').eq('client_id', clientId);
  let tq = db.from('crm_tasks').select('id, title, due_date, status, deal_id').eq('client_id', clientId).neq('status', 'completed');
  if (!isAdminRole(ctx.role)) { dq = dq.eq('business_unit', ctx.businessUnit); tq = tq.eq('business_unit', ctx.businessUnit); }
  const [hidden, deals, tasks, acts] = await Promise.all([
    hiddenDealIds(ctx),
    dq.order('created_at', { ascending: false }).limit(12),
    tq.order('due_date', { ascending: true }).limit(4),
    db.from('crm_client_activities').select('type, note, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1),
  ]);
  // An agent only sees deals they are on — not a colleague's deal that happens to be with the same contact.
  const hide = new Set([...hidden, ...(deals.data ?? []).filter(d => !onDeal(ctx, d as { agent_id?: string | null; assigned_agent_ids?: string[] | null })).map(d => d.id as string)]);
  return NextResponse.json({
    deals: (deals.data ?? []).filter(d => !hide.has(d.id as string)).map(d => ({ id: d.id, property: d.property, stage: d.stage, type: d.type })),
    tasks: (tasks.data ?? []).filter(t => !t.deal_id || !hide.has(t.deal_id as string)).map(t => ({ id: t.id, title: t.title, due: t.due_date })),
    last: acts.data?.[0] ? { type: acts.data[0].type, note: String(acts.data[0].note ?? '').replace(/\s+/g, ' ').slice(0, 140), at: acts.data[0].created_at } : null,
  });
}
