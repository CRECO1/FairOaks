import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { buildOverview } from '@/lib/listing-inquiries';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/crm/interest-overview — every property the caller can see that has tagged interest or outreach, side by side (asked, reached out, followed up, deals, waiting on a call-back, average days to our first email). Same access rules as each property's own list. */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  return NextResponse.json({ rows: await buildOverview(ctx) });
}
