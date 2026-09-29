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
 * @param filter    OData $filter string (already built by the caller).
 * @param markStale When true, MLS listings we hold that are NOT in this feed are
 *                  flipped to off-market. Only safe for a FULL sync — never for a
 *                  delta (a delta only contains recently-modified listings, so
 *                  everything else would be wrongly retired).
 */
export async function runMlsSync(filter: string, opts: { markStale?: boolean } = {}): Promise<MlsSyncResult> {
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

  // ── Mark listings no longer in the SABOR feed as off-market ──────────────
  // Only for MLS-sourced listings — never touch manually entered ones, and only
  // on a full sync (see markStale note above).
  if (opts.markStale && listingIds.length > 0) {
    const { data: stale } = await supabase
      .from('listings')
      .select('id, listing_key, title')
      .eq('source', 'mls')
      .in('status', ['active', 'pending'])
      .not('listing_key', 'in', `(${listingIds.filter(k => /^[\w\-]+$/.test(k)).map(k => `'${k}'`).join(',')})`)  // only allow safe alphanumeric/dash MLS IDs
      .limit(500);

    if (stale && stale.length > 0) {
      const staleIds = stale.map((r: { id: string }) => r.id);
      await supabase
        .from('listings')
        .update({ status: 'off-market', synced_at: new Date().toISOString() })
        .in('id', staleIds);
    }
  }

  return { synced, failed, total: properties.length, filter };
}
