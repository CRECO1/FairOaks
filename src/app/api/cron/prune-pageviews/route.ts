/**
 * GET /api/cron/prune-pageviews — daily. Keeps site_pageviews a rolling 7-day
 * window; the live-activity feed only ever looks back 30 minutes, so older rows
 * are pure retention (and pruned here). Secured with CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await adminClient()
    .from('site_pageviews')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);
  if (error) {
    console.error('[prune-pageviews]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ pruned: count ?? 0, cutoff });
}
