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
import { runPipeline } from '@/lib/broker-ingest';
import { geocodeMissing } from '@/lib/broker-ingest/geocode';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  // Default routine: ingest everything the user files into the "Property DB"
  // Gmail folder. The folder is curated + small, so we scan the whole label
  // each run (no recency window); dedup keeps re-scans idempotent. Overridable
  // via ?query / ?window / BROKER_INGEST_QUERY for ad-hoc or broad sweeps.
  const baseQuery = sp.get('query') ?? process.env.BROKER_INGEST_QUERY ?? 'label:"Property DB"';
  const window = sp.get('window') ?? '';
  const query = `${baseQuery} ${window}`.trim();
  const limit = Number(sp.get('limit') ?? 60);

  try {
    const r = await runPipeline({ query, limit, commit: true });
    // Geocode any newly-ingested (or previously un-geocoded) properties so they
    // show on the Property DB map. Bounded per run to stay within cron time.
    const geo = await geocodeMissing(25);
    return NextResponse.json({
      scanned: r.scanned,
      listings: r.listings,
      nonListings: r.nonListings,
      extractErrors: r.extractErrors,
      inserted: r.inserted,
      dupSkipped: r.dupSkipped,
      geocoded: geo.geocoded,
      model: r.model,
    });
  } catch (err) {
    console.error('broker-ingest cron error:', err);
    return NextResponse.json({ error: (err as Error).message ?? 'ingest failed' }, { status: 500 });
  }
}
