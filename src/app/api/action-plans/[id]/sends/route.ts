/**
 * GET /api/action-plans/[id]/sends — the send history for an action plan (every email it has sent, with opens),
 * for the plan's History tab. Same workspace/ownership rule as the plan itself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, assertOwnsResource } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { fetchAll } from '@/lib/campaign-engagement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertOwnsResource('crm_action_plans', id, ctx))) return notFound('Plan not found');

  const db = adminClient();
  const sends = await fetchAll<Record<string, unknown>>((a, b) => db.from('crm_action_plan_sends')
    .select('id, plan_id, step_id, client_id, type, status, subject, error_message, sent_at, opened_at, last_opened_at, open_count, tracking_id')
    .eq('plan_id', id).order('sent_at', { ascending: false }).order('id').range(a, b));
  return NextResponse.json({ sends });
}
