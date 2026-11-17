import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { jobHealth } from '@/lib/job-health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crm/job-runs — admins: every scheduled tagging job with its last runs, whether it is on schedule / late / failed / never run, and the last time it did
 * something for real (an alert reached a phone, a draft was saved, a call was tagged). Empty until the log table exists.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  return NextResponse.json({ jobs: (await jobHealth(adminClient())).map(({ real, ...j }) => { void real; return j; }) });
}
