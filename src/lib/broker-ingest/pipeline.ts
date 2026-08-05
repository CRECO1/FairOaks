/**
 * End-to-end pipeline: list -> fetch -> extract -> drop non-listings -> dedup-insert.
 *
 * Idempotent and safe to re-run (dedup guards against re-inserting known properties).
 * Used by both the weekly cron route and scripts/broker-backfill.mjs.
 */

import { getBrokerAccessToken, listMessageIds, fetchEmail } from './gmail';
import { extractListing, MODEL } from './extract';
import { upsertProperties } from './upsert';
import type { Extraction, PropertyRecord } from './types';

/**
 * Default Gmail search: broker blasts almost always contain an unsubscribe footer,
 * a size ("SF" / "square feet" / "acres"), and a lease/sale/available/sublease cue.
 */
export const DEFAULT_QUERY =
  'unsubscribe (SF OR acres OR "square feet") (lease OR sale OR available OR sublease)';

export interface PipelineOptions {
  /** Full Gmail query. Defaults to DEFAULT_QUERY. */
  query?: string;
  /** Max messages to scan. Default 50. */
  limit?: number;
  /** Actually write to the DB. Default false (dry run). */
  commit?: boolean;
  /** Max flyer images sent to Claude per email. Default 6. */
  maxImages?: number;
  /** Optional progress callback for CLI logging. */
  onProgress?: (msg: string) => void;
}

export interface PipelineResult {
  scanned: number;
  listings: number;
  nonListings: number;
  extractErrors: number;
  inserted: number;
  dupSkipped: number;
  skippedNoAddress: number;
  model: string;
  /** The de-duplicated records that were (or, on a dry run, would be) inserted. */
  wouldInsert: PropertyRecord[];
}

export async function runPipeline(opts: PipelineOptions = {}): Promise<PipelineResult> {
  const query = opts.query ?? DEFAULT_QUERY;
  const limit = opts.limit ?? 50;
  const commit = opts.commit ?? false;
  const maxImages = opts.maxImages ?? 6;
  const log = opts.onProgress ?? (() => {});

  const token = await getBrokerAccessToken();
  const ids = await listMessageIds(token, query, limit);
  log(`Scanning ${ids.length} message(s)...`);

  const extractions: Extraction[] = [];
  let nonListings = 0;
  let extractErrors = 0;

  let i = 0;
  for (const id of ids) {
    i++;
    const email = await fetchEmail(token, id, maxImages);
    if (!email) {
      extractErrors++;
      log(`  [${i}/${ids.length}] fetch failed (${id})`);
      continue;
    }
    try {
      const ex = await extractListing(email);
      if (!ex.is_listing) {
        nonListings++;
        log(`  [${i}/${ids.length}] not a listing — "${email.subject.slice(0, 60)}"`);
        continue;
      }
      extractions.push(ex);
      log(
        `  [${i}/${ids.length}] LISTING — ${ex.name ?? ex.address ?? '(no name)'} ` +
          `[${ex.asset_type ?? 'Office'}${ex.size_sf ? `, ${ex.size_sf} SF` : ''}]`,
      );
    } catch (err) {
      extractErrors++;
      log(`  [${i}/${ids.length}] extract error — ${(err as Error).message}`);
    }
  }

  const up = await upsertProperties(extractions, { commit });

  return {
    scanned: ids.length,
    listings: extractions.length,
    nonListings,
    extractErrors,
    inserted: up.inserted,
    dupSkipped: up.dupSkipped,
    skippedNoAddress: up.skippedNoAddress,
    model: MODEL,
    wouldInsert: up.records,
  };
}
