/**
 * GET /api/cron/mls-sync
 *
 * Vercel cron endpoint — runs every 30 minutes to pull fresh MLS data
 * from SABOR and upsert into the listings table.
 *
 * Sends a delta filter: only records modified in the last 35 minutes so
 * each run is fast and doesn't hammer the RETS/OData endpoint.
 *
 * Secured with CRON_SECRET (same one used for the campaigns cron).
 */

import { NextRequest, NextResponse } from 'next/server';
import { runMlsSync } from '@/lib/mls-sync';
import { SYNC_FILTER } from '@/lib/sabor-reso';

export async function GET(req: NextRequest) {
  // Verify the cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Build a timestamp 35 minutes ago (5-minute buffer over the 30-min cron
    // interval to avoid missing records due to clock skew or slow delivery).
    const deltaMs = 35 * 60 * 1000;
    const since   = new Date(Date.now() - deltaMs).toISOString().replace(/\.\d+Z$/, 'Z');

    // Pull every recently-changed listing — active states AND the off-market
    // transitions (SYNC_FILTER). A listing that sold / expired / withdrew in this
    // window is fetched and, on upsert, flipped to sold/off-market, so it drops off
    // the active feed. That replaces the old (broken) "retire listings absent from
    // the feed" sweep with SABOR's positive status signal.
    const deltaFilter = `${SYNC_FILTER} and ModificationTimestamp gt ${since}`;

    // Run the sync IN-PROCESS — not via fetch(`${origin}/api/mls/sync`). When Vercel
    // fires the cron, `origin` is the PROTECTED *.vercel.app deployment URL, so
    // Deployment Protection intercepted that internal call and every scheduled run
    // failed with `sync failed: { protection: … }` (the data froze for 68 days).
    // Calling the shared function directly removes the HTTP hop entirely.
    const result = await runMlsSync(deltaFilter);

    console.log('[MLS cron] delta sync complete (since %s):', since, result);
    return NextResponse.json({ ...result, deltaFilter, since });
  } catch (err: any) {
    console.error('[MLS cron] error:', err);
    return NextResponse.json({ error: 'MLS sync failed.' }, { status: 500 });
  }
}
