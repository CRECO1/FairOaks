/**
 * End-to-end pipeline: list -> fetch -> extract -> drop non-listings -> dedup-insert.
 *
 * Idempotent and safe to re-run (dedup guards against re-inserting known properties).
 * Used by both the weekly cron route and scripts/broker-backfill.mjs.
 */

import { getBrokerAccessToken, listMessageIds, fetchEmail } from './gmail';
import { extractListing, extractDigestListings, MODEL } from './extract';
import { upsertProperties } from './upsert';
import type { Extraction, GmailImage, PropertyRecord } from './types';

/** The flyer is almost always the largest image (logos/signatures/pixels are tiny). */
function pickFlyer(images: GmailImage[]): GmailImage | undefined {
  if (!images.length) return undefined;
  return images.reduce((a, b) => (b.data.length > a.data.length ? b : a));
}

/**
 * Cheap gate for the digest path: only spend a second model call mining a
 * roundup when the email is plausibly one (a marketplace sender, or a subject
 * that reads like a "recommended/featured/new listings" blast). Keeps us from
 * hallucinating listings out of newsletters and tenant-need broadcasts.
 */
function looksLikeDigest(email: { from: string; subject: string }): boolean {
  const from = (email.from || '').toLowerCase();
  if (/crexi|loopnet|commercialcafe|commercialsearch|commercialexchange|catylist|brevitas|biproxi|commercialedge/.test(from)) return true;
  const subj = (email.subject || '').toLowerCase();
  return /(recommended|featured|new listings|listings for you|properties for you|just listed|matching your search|weekly (update|listings)|top (listings|properties))/.test(subj);
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
  /** Also mine marketplace digests (Crexi/LoopNet roundups) for many listings. Default true. */
  digests?: boolean;
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
  /** Existing duplicate rows enriched with previously-missing data (broker + digest). */
  enriched: number;
  /** Total individual fields filled in across all enriched rows. */
  fieldsEnriched: number;
  model: string;
  /** The de-duplicated records that were (or, on a dry run, would be) inserted. */
  wouldInsert: PropertyRecord[];
  /** Multi-listing marketplace-digest path (Crexi/LoopNet roundups), source='digest'. */
  digestListingsFound: number;
  digestInserted: number;
  digestDupSkipped: number;
  digestWouldInsert: PropertyRecord[];
}

export async function runPipeline(opts: PipelineOptions = {}): Promise<PipelineResult> {
  const query = opts.query ?? DEFAULT_QUERY;
  const limit = opts.limit ?? 50;
  const commit = opts.commit ?? false;
  const maxImages = opts.maxImages ?? 6;
  const digests = opts.digests ?? true;
  const log = opts.onProgress ?? (() => {});

  const token = await getBrokerAccessToken();
  const ids = await listMessageIds(token, query, limit);
  log(`Scanning ${ids.length} message(s)...`);

  const items: Array<{ extraction: Extraction; flyer?: GmailImage }> = [];
  const digestItems: Array<{ extraction: Extraction }> = [];
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
        // A roundup the single-listing pass discards — mine it for ALL its listings.
        if (digests && looksLikeDigest(email)) {
          try {
            const ds = await extractDigestListings(email);
            for (const d of ds) digestItems.push({ extraction: d });
            log(`  [${i}/${ids.length}] DIGEST — ${ds.length} listing(s) from "${email.subject.slice(0, 50)}"`);
          } catch (err) {
            noteError('digest: ' + (err as Error).message);
            log(`  [${i}/${ids.length}] digest error — ${(err as Error).message}`);
          }
        } else {
          log(`  [${i}/${ids.length}] not a listing — "${email.subject.slice(0, 60)}"`);
        }
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

  // Digest listings insert separately, tagged source='digest'. When committing,
  // the broker rows above are already in the DB so this pass dedups against them too.
  let digestInserted = 0;
  let digestDupSkipped = 0;
  let digestWouldInsert: PropertyRecord[] = [];
  let digestEnriched = 0;
  let digestFieldsEnriched = 0;
  if (digestItems.length) {
    const dup = await upsertProperties(digestItems, { commit, source: 'digest' });
    digestInserted = dup.inserted;
    digestDupSkipped = dup.dupSkipped;
    digestWouldInsert = dup.records;
    digestEnriched = dup.enriched;
    digestFieldsEnriched = dup.fieldsEnriched;
  }

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
    enriched: up.enriched + digestEnriched,
    fieldsEnriched: up.fieldsEnriched + digestFieldsEnriched,
    model: MODEL,
    wouldInsert: up.records,
    digestListingsFound: digestItems.length,
    digestInserted,
    digestDupSkipped,
    digestWouldInsert,
  };
}
