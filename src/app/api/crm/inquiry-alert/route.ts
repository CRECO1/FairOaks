import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/** GET /api/crm/inquiry-alert — { listingAgent }: is the caller the listing agent (or an assigned agent) on any listing in their workspace?
 *  The "Property inquiries" alert only makes sense for them, so only they are asked whether they want it. */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { data } = await adminClient().from('crm_listings').select('id')
    .eq('business_unit', ctx.businessUnit ?? 'commercial').or(`listing_agent_id.eq.${ctx.userId},assigned_agent_ids.cs.{${ctx.userId}}`).limit(1);
  return NextResponse.json({ listingAgent: (data ?? []).length > 0 });
}
