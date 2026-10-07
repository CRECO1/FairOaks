import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

/**
 * GET /api/action-plans/sent-to?client_id=…
 * Which action-plan emails this contact has received in the last 30 days — so the
 * "Deal Closed!" popup can show "✓ Sent Oct 7" and not offer to send the same email twice.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const clientId = req.nextUrl.searchParams.get('client_id');
  if (!clientId) return NextResponse.json({ sent: [] });
  if (!(await assertOwnsResource('crm_clients', clientId, ctx))) return notFound('Contact not found');
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await adminClient().from('crm_action_plan_sends')
    .select('plan_id, sent_at').eq('client_id', clientId).eq('status', 'sent').gte('sent_at', since).order('sent_at', { ascending: false });
  if (error) return dbError('api/action-plans/sent-to', error);
  // Newest send per plan.
  const latest: Record<string, string> = {};
  for (const r of data ?? []) if (!latest[r.plan_id]) latest[r.plan_id] = r.sent_at as string;
  return NextResponse.json({ sent: Object.entries(latest).map(([plan_id, sent_at]) => ({ plan_id, sent_at })) });
}
