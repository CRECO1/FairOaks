/**
 * GET /api/cron/prune-pageviews — daily. Keeps site_pageviews + site_events a rolling 90-day
 * window (was 7 days): the live feed only looks back 30 minutes, but the per-lead / per-contact
 * website history and the engagement reports need weeks of visitor-level data. Also trims crawler_hits to 365 days.
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
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await db
    .from('site_pageviews')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);
  if (error) {
    console.error('[prune-pageviews]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: evErr, count: evCount } = await db.from('site_events').delete({ count: 'exact' }).lt('created_at', cutoff);
  if (evErr) console.error('[prune-pageviews] site_events', evErr);

  // crawler_hits (AI/search bot tracker) keeps a year for trend lines.
  const crawlerCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const { error: crawlerError, count: crawlerCount } = await db
    .from('crawler_hits')
    .delete({ count: 'exact' })
    .lt('created_at', crawlerCutoff);
  if (crawlerError) console.error('[prune-pageviews] crawler_hits', crawlerError);

  return NextResponse.json({ pruned: count ?? 0, eventsPruned: evCount ?? 0, cutoff, crawlerPruned: crawlerCount ?? 0 });
}
