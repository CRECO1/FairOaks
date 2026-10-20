import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/[id]/opens — every logged open of this campaign, one row per open with its exact time.
 * The send row only keeps the first open (and a count); each open lands in email_tracking_events through the Resend
 * webhook. That table has row-level security and no browser policy, so the CRM reads it here, with the same
 * campaign-access check as the rest of the campaign routes.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!(await assertOwnsResource('crm_campaigns', id, ctx))) return notFound('Campaign not found');
  const supabase = adminClient();
  const opens: { client_id: string; occurred_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('email_tracking_events')
      .select('client_id, occurred_at').eq('campaign_id', id).eq('event_type', 'open')
      .order('occurred_at').order('id').range(from, from + 999);
    if (error) return dbError('api/campaigns/[id]/opens', error);
    opens.push(...((data ?? []) as { client_id: string; occurred_at: string }[]));
    if (!data || data.length < 1000) break;
  }
  return NextResponse.json({ opens });
}
