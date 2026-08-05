/**
 * GET /api/cron/broker-ingest
 *
 * Weekly Vercel cron: reads recent commercial-real-estate broker "available space"
 * emails from the connected Gmail account (zack@crecotx.com), extracts listings with
 * Claude vision, and inserts new buildings into crm_prospective_properties.
 *
 * Idempotent via normalized-address dedup, so it is safe to run repeatedly.
 * Secured with CRON_SECRET (same pattern as every other cron route).
 *
 * Optional query params (for manual runs):
 *   ?window=newer_than:8d   Gmail recency filter (default newer_than:8d)
 *   ?query=...              override the base Gmail query
 *   ?limit=40               max messages to scan
 */

import { NextRequest, NextResponse } from 'next/server';
import { runPipeline, DEFAULT_QUERY } from '@/lib/broker-ingest';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const baseQuery = sp.get('query') ?? DEFAULT_QUERY;
  const window = sp.get('window') ?? 'newer_than:2d';
  const query = `${baseQuery} ${window}`.trim();
  const limit = Number(sp.get('limit') ?? 40);

  try {
    const r = await runPipeline({ query, limit, commit: true });
    return NextResponse.json({
      scanned: r.scanned,
      listings: r.listings,
      nonListings: r.nonListings,
      extractErrors: r.extractErrors,
      inserted: r.inserted,
      dupSkipped: r.dupSkipped,
      model: r.model,
    });
  } catch (err) {
    console.error('broker-ingest cron error:', err);
    return NextResponse.json({ error: (err as Error).message ?? 'ingest failed' }, { status: 500 });
  }
}
