/**
 * End-to-end pipeline: list -> fetch -> extract -> drop non-listings -> dedup-insert.
 *
 * Idempotent and safe to re-run (dedup guards against re-inserting known properties).
 * Used by both the weekly cron route and scripts/broker-backfill.mjs.
 */

import { getBrokerAccessToken, listMessageIds, fetchEmail } from './gmail';
import { extractListing, MODEL } from './extract';
import { upsertProperties } from './upsert';
import type { Extraction, GmailImage, PropertyRecord } from './types';

/** The flyer is almost always the largest image (logos/signatures/pixels are tiny). */
function pickFlyer(images: GmailImage[]): GmailImage | undefined {
  if (!images.length) return undefined;
  return images.reduce((a, b) => (b.data.length > a.data.length ? b : a));
}

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
  /** Up to 5 distinct fetch/extract error messages seen this run (for alerting). */
  errorSample: string[];
  inserted: number;
  dupSkipped: number;
  skippedNoAddress: number;
  photosAdded: number;
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

  const items: Array<{ extraction: Extraction; flyer?: GmailImage }> = [];
  let nonListings = 0;
  let extractErrors = 0;
  const errorSample: string[] = [];
  const noteError = (msg: string) => {
    const m = (msg || 'unknown error').slice(0, 300);
    if (errorSample.length < 5 && !errorSample.includes(m)) errorSample.push(m);
  };

  let i = 0;
  for (const id of ids) {
    i++;
    const email = await fetchEmail(token, id, maxImages);
    if (!email) {
      extractErrors++;
      noteError(`fetch failed (message ${id})`);
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
      items.push({ extraction: ex, flyer: pickFlyer(email.images) });
      log(
        `  [${i}/${ids.length}] LISTING — ${ex.name ?? ex.address ?? '(no name)'} ` +
          `[${ex.asset_type ?? 'Office'}${ex.size_sf ? `, ${ex.size_sf} SF` : ''}]`,
      );
    } catch (err) {
      extractErrors++;
      noteError((err as Error).message);
      log(`  [${i}/${ids.length}] extract error — ${(err as Error).message}`);
    }
  }

  const up = await upsertProperties(items, { commit });

  return {
    scanned: ids.length,
    listings: items.length,
    nonListings,
    extractErrors,
    errorSample,
    inserted: up.inserted,
    dupSkipped: up.dupSkipped,
    skippedNoAddress: up.skippedNoAddress,
    photosAdded: up.photosAdded,
    model: MODEL,
    wouldInsert: up.records,
  };
}
