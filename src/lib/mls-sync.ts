/**
 * Shared MLS sync core — pulls matching properties from SABOR's RESO Web API
 * and upserts them into the `listings` table.
 *
 * This lives in a lib (not inside a route) on purpose: the cron used to
 * `fetch(${origin}/api/mls/sync)` to reuse the logic, but when Vercel fires the
 * cron the origin is the PROTECTED *.vercel.app deployment URL, so Deployment
 * Protection intercepted that internal call and the sync failed on every
 * scheduled run (`sync failed: { protection: … }`). Calling this in-process
 * removes the HTTP hop entirely, so protection can never block it.
 */

import { createClient } from '@supabase/supabase-js';
import { searchPropertiesAll, getMediaBatch, resoPropertyToListing, fetchAllActiveListingKeys } from '@/lib/sabor-reso';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface MlsSyncResult { synced: number; failed: number; total: number; filter: string }

/**
 * Fetch every listing matching `filter` from SABOR and upsert it. Each listing's
 * status is set from its StandardStatus on upsert (see resoPropertyToListing), so
 * INCLUDING the off-market statuses in the filter (SYNC_FILTER / OFF_MARKET_FILTER)
 * is what retires sold / expired listings. There is deliberately no separate
 * "mark listings absent from the feed as stale" pass — that was unreliable: the feed
 * is capped at 10k records, so absence never actually meant off-market, and the
 * 10k-key NOT-IN it built blew past the query-length limit and silently no-op'd.
 *
 * @param filter OData $filter string (already built by the caller).
 */
export async function runMlsSync(filter: string): Promise<MlsSyncResult> {
  // ── Fetch all matching properties from SABOR ──────────────────────────────
  const properties = await searchPropertiesAll(
    { filter, orderby: 'ModificationTimestamp desc', top: 200 },
    50 // max 50 pages = up to 10,000 records per sync
  );

  if (properties.length === 0) {
    return { synced: 0, failed: 0, total: 0, filter };
  }

  // ── Fetch media for all listings in batches ───────────────────────────────
  const listingIds = properties.map(p => p.ListingId);
  const mediaMap = await getMediaBatch(listingIds);

  // ── Upsert into Supabase ──────────────────────────────────────────────────
  const supabase = adminClient();
  let synced = 0;
  let failed = 0;

  const CHUNK = 50;
  for (let i = 0; i < properties.length; i += CHUNK) {
    const chunk = properties.slice(i, i + CHUNK);
    const rows = chunk.map(p => resoPropertyToListing(p, mediaMap.get(p.ListingId) ?? []));

    const { error } = await supabase
      .from('listings')
      .upsert(rows, { onConflict: 'listing_key', ignoreDuplicates: false });

    if (error) {
      console.error('[MLS sync] upsert error:', error);
      failed += chunk.length;
    } else {
      synced += chunk.length;
    }
  }

  return { synced, failed, total: properties.length, filter };
}

export interface ReconcileResult {
  ourActive: number;
  saborActive: number;
  expected: number;
  retire: number;
  retired: number;
  aborted?: string;
}

/**
 * Retire listings we hold as `active` that SABOR no longer returns as active — the
 * only reliable off-market signal, since SABOR's feed exposes active inventory only
 * (a sold listing drops out; it never appears as CLOSED). Fetches SABOR's FULL active
 * key set and flips our absent actives to off-market.
 *
 * Two guard rails, because a false positive would blank real inventory off the site:
 *   1. If we fetched < 95% of SABOR's reported active count, the feed was truncated —
 *      abort without retiring anything.
 *   2. If the retire set is > 40% of our active listings, that's implausible (a broken
 *      fetch, not that many real sales) — abort.
 * `dryRun` computes the counts without writing.
 */
export async function reconcileOffMarket(opts: { dryRun?: boolean } = {}): Promise<ReconcileResult> {
  const supabase = adminClient();

  const { data: ours, error } = await supabase
    .from('listings')
    .select('id, listing_key')
    .eq('source', 'mls')
    .eq('status', 'active')
    .limit(100000);
  if (error) {
    return { ourActive: 0, saborActive: 0, expected: 0, retire: 0, retired: 0, aborted: `could not read our listings: ${error.message}` };
  }
  const ourList = (ours ?? []).filter(r => r.listing_key) as { id: string; listing_key: string }[];

  const { keys: saborKeys, expected } = await fetchAllActiveListingKeys();

  // Guard 1: an incomplete fetch must not retire anything.
  if (expected > 0 && saborKeys.size < expected * 0.95) {
    return { ourActive: ourList.length, saborActive: saborKeys.size, expected, retire: 0, retired: 0,
      aborted: `only fetched ${saborKeys.size}/${expected} SABOR active keys (<95%) — feed likely truncated, retiring nothing` };
  }

  const retire = ourList.filter(r => !saborKeys.has(r.listing_key));

  // Guard 2: implausibly large retire set => something is wrong, do not retire.
  if (ourList.length > 0 && retire.length > ourList.length * 0.4) {
    return { ourActive: ourList.length, saborActive: saborKeys.size, expected, retire: retire.length, retired: 0,
      aborted: `would retire ${retire.length}/${ourList.length} (>40%) — implausible, retiring nothing` };
  }

  if (opts.dryRun) {
    return { ourActive: ourList.length, saborActive: saborKeys.size, expected, retire: retire.length, retired: 0 };
  }

  let retired = 0;
  const CHUNK = 200;
  for (let i = 0; i < retire.length; i += CHUNK) {
    const ids = retire.slice(i, i + CHUNK).map(r => r.id);
    const { error: upErr } = await supabase
      .from('listings')
      .update({ status: 'off-market', synced_at: new Date().toISOString() })
      .in('id', ids);
    if (upErr) console.error('[reconcile] retire batch failed:', upErr.message);
    else retired += ids.length;
  }

  return { ourActive: ourList.length, saborActive: saborKeys.size, expected, retire: retire.length, retired };
}
