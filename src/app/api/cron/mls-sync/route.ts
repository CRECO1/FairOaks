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

    const deltaFilter =
      `(StandardStatus eq ODataService.StandardStatus'ACTIVE' or ` +
      `StandardStatus eq ODataService.StandardStatus'ACTIVE_UNDER_CONTRACT') and ` +
      `ModificationTimestamp gt ${since}`;

    // Delegate to the sync route so logic stays in one place
    const origin  = req.nextUrl.origin;
    const syncRes = await fetch(`${origin}/api/mls/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Use a dedicated internal secret — never re-use the service role key as a transport token
        'x-internal-key': process.env.INTERNAL_SYNC_SECRET ?? '',
      },
      body: JSON.stringify({ filter: deltaFilter }),
    });

    const data = await syncRes.json();

    if (!syncRes.ok) {
      console.error('[MLS cron] sync failed:', data);
      return NextResponse.json({ error: data.error ?? 'Sync failed' }, { status: 500 });
    }

    console.log('[MLS cron] delta sync complete (since %s):', since, data);
    return NextResponse.json({ ...data, deltaFilter, since });
  } catch (err: any) {
    console.error('[MLS cron] error:', err);
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
