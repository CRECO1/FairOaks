/**
 * GET /api/cron/prune-pageviews — daily. Keeps site_pageviews a rolling 7-day
 * window; the live-activity feed only ever looks back 30 minutes, so older rows
 * are pure retention (and pruned here). Also trims crawler_hits to 365 days.
 * Secured with CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = adminClient();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await db
    .from('site_pageviews')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);
  if (error) {
    console.error('[prune-pageviews]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // crawler_hits (AI/search bot tracker) keeps a year for trend lines.
  const crawlerCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const { error: crawlerError, count: crawlerCount } = await db
    .from('crawler_hits')
    .delete({ count: 'exact' })
    .lt('created_at', crawlerCutoff);
  if (crawlerError) console.error('[prune-pageviews] crawler_hits', crawlerError);

  return NextResponse.json({ pruned: count ?? 0, cutoff, crawlerPruned: crawlerCount ?? 0 });
}
