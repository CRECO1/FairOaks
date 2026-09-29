/**
 * GET /api/cron/mls-reconcile — runs daily.
 *
 * Retires listings we hold as `active` that SABOR no longer lists (sold / expired /
 * withdrawn). The 30-minute delta sync can't catch these: SABOR's feed exposes ACTIVE
 * inventory only, so a sold listing just drops out — it never comes back as CLOSED.
 * reconcileOffMarket() fetches SABOR's full active set and flips our absent actives to
 * off-market, with guard rails against retiring real inventory on a bad fetch.
 *
 * Secured with CRON_SECRET (same one as the other crons).
 */

import { NextRequest, NextResponse } from 'next/server';
import { reconcileOffMarket } from '@/lib/mls-sync';

// Paging SABOR's full ~30k active feed takes well over the default budget.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await reconcileOffMarket();
    console.log('[MLS reconcile]', result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[MLS reconcile] error:', err);
    return NextResponse.json({ error: 'reconcile failed' }, { status: 500 });
  }
}
