/**
 * Shared authorization helpers for the listing-files routes.
 *
 * `crm_listing_files` has no `business_unit` of its own, so access is always derived
 * from the parent listing.
 */
import { assertOwnsResource, type CrmContext } from '@/lib/crm-auth';

export const LISTING_FILES_BUCKET = 'listing-files';

/** True when the caller's workspace owns `listingId` (admins bypass the unit check). */
export async function callerCanAccessListing(listingId: string, ctx: CrmContext): Promise<boolean> {
  return !!(await assertOwnsResource('crm_listings', listingId, ctx));
}

/**
 * Storage paths are always minted server-side as `${listing_id}/…` (see presign).
 * Rejecting anything else stops a client from handing us a path that belongs to a
 * different listing — which would otherwise turn /confirm into a signed-URL oracle for
 * any object in the bucket.
 */
export function isPathInsideListing(storagePath: unknown, listingId: string): boolean {
  return typeof storagePath === 'string'
    && storagePath.startsWith(`${listingId}/`)
    && !storagePath.split('/').includes('..');
}
