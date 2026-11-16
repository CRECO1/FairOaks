import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { prepareSecondTouchDrafts } from '@/lib/second-touch';
import { recordJobRun } from '@/lib/job-runs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/cron/second-touch-drafts — Mondays. Prepares up to 25 second-touch email DRAFTS for outreach contacts 30+ days out with no reply (saved to the listing agent's Drafts; NEVER sent). Secured by CRON_SECRET. */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = adminClient();
  try {
    const r = await prepareSecondTouchDrafts(db, { unit: 'commercial', limit: 25 });
    await recordJobRun(db, 'second-touch-drafts', true, r.made ? `${r.made} second-touch draft${r.made === 1 ? '' : 's'} saved for review (nothing sent); ${r.skipped} skipped` : 'No outreach contacts are 30+ days out with no reply yet; nothing to prepare', { made: r.made, skipped: r.skipped });
    return NextResponse.json({ made: r.made, skipped: r.skipped });
  } catch (e) {
    await recordJobRun(db, 'second-touch-drafts', false, `Failed: ${(e as Error).message}`.slice(0, 300));
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
