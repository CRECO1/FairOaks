/**
 * GET /api/cron/mls-sync
 *
 * Vercel cron endpoint — runs every 30 minutes to pull fresh MLS data
 * from SABOR and upsert into the listings table.
 *
 * Secured with CRON_SECRET (same one used for the campaigns cron).
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Verify the cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Delegate to the sync route so logic stays in one place
    const origin = req.nextUrl.origin;
    const syncRes = await fetch(`${origin}/api/mls/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Pass the service role key so the sync route can use it without
        // requiring a user session (cron runs server-to-server)
        'x-internal-key': process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      },
    });

    const data = await syncRes.json();

    if (!syncRes.ok) {
      console.error('[MLS cron] sync failed:', data);
      return NextResponse.json({ error: data.error ?? 'Sync failed' }, { status: 500 });
    }

    console.log('[MLS cron] sync complete:', data);
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[MLS cron] error:', err);
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
