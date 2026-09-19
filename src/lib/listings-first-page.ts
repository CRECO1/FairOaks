import { searchProperties, getMediaBatch, resoPropertyToListing, statusFilter } from '@/lib/sabor-reso';
import type { Listing } from '@/lib/supabase';

/**
 * The first page of /listings exactly as the unfiltered search shows it — the same
 * query /api/listings runs with no params (active + under contract + pending,
 * newest-modified first) — fetched on the server so the page's initial HTML carries
 * real listing links for search engines and AI crawlers.
 *
 * Returns null when the MLS feed can't be reached. Never substitutes placeholder
 * listings: a page with no listings is the honest result of a failed feed.
 */
export const FIRST_PAGE_LIMIT = 24;

export interface FirstPage { listings: Listing[]; total: number; totalPages: number }

export async function getFirstPageListings(revalidate: number): Promise<FirstPage | null> {
  try {
    const result = await searchProperties({
      filter: statusFilter(['ACTIVE', 'ACTIVE_UNDER_CONTRACT', 'PENDING']),
      top: FIRST_PAGE_LIMIT,
      orderby: 'ModificationTimestamp desc',
      count: true,
      revalidate,
    });
    const properties = result.value;
    const total = result['@odata.count'] ?? properties.length;
    const media = properties.length ? await getMediaBatch(properties.map(p => p.ListingId), revalidate) : new Map<string, string[]>();
    const listings = properties.map(p => resoPropertyToListing(p, media.get(p.ListingId) ?? [])) as unknown as Listing[];
    return { listings, total, totalPages: Math.ceil(total / FIRST_PAGE_LIMIT) };
  } catch (err) {
    console.error('[listings] first page fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
