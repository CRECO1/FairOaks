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
import { searchPropertiesAll, getMediaBatch, resoPropertyToListing } from '@/lib/sabor-reso';

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
