/**
 * GET /api/cron/property-dedupe
 *
 * Weekly Vercel cron: collapses property-level duplicates in the Property DB — the
 * same building ingested more than once under slightly different address formatting
 * (a re-processed broker email, or LoopNet "Pky" vs a broker's "Parkway"). Keeps the
 * richest copy, folds in any field it was missing, deletes the redundant rows.
 * Conservative (same canonical address + city + state only) and never deletes a
 * manually-added row. Idempotent — a run with nothing to collapse deletes nothing.
 *
 * Secured with CRON_SECRET. ?dry=1 reports what it WOULD collapse without writing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dedupeProperties } from '@/lib/broker-ingest/dedupe-properties';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dry = req.nextUrl.searchParams.get('dry') === '1';
  try {
    const r = await dedupeProperties({ commit: !dry });
    return NextResponse.json({ mode: dry ? 'dry-run' : 'committed', ...r });
  } catch (err) {
    console.error('property-dedupe cron error:', err);
    return NextResponse.json({ error: (err as Error).message ?? 'dedupe failed' }, { status: 500 });
  }
}
