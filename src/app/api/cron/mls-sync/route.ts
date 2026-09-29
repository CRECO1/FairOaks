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
import { ACTIVE_FILTER } from '@/lib/sabor-reso';

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

    // SABOR's feed only exposes active inventory, so the delta just refreshes active
    // listings (price/status changes among the still-listed). Retiring SOLD listings
    // is handled by the daily reconcile cron — a sold listing simply drops out of
    // this feed and never appears as CLOSED (see reconcileOffMarket).
    const deltaFilter = `${ACTIVE_FILTER} and ModificationTimestamp gt ${since}`;

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
