/**
 * GET /api/cron/digest-dedupe
 *
 * Weekly Vercel cron: collapses source='digest' rows that are the same listing
 * captured twice (a name+city collision the address-keyed crawl dedup can't catch —
 * typically one copy with the street address, one without). Keeps the richest copy,
 * folds in any fields it was missing, and deletes the redundant rows. Idempotent:
 * a run with nothing to collapse deletes nothing.
 *
 * Secured with CRON_SECRET (same pattern as the other cron routes).
 * ?dry=1 reports what it WOULD collapse without writing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dedupeDigestDuplicates } from '@/lib/broker-ingest/dedupe';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dry = req.nextUrl.searchParams.get('dry') === '1';
  try {
    const r = await dedupeDigestDuplicates({ commit: !dry });
    return NextResponse.json({ mode: dry ? 'dry-run' : 'committed', ...r });
  } catch (err) {
    console.error('digest-dedupe cron error:', err);
    return NextResponse.json({ error: (err as Error).message ?? 'dedupe failed' }, { status: 500 });
  }
}
