/**
 * Shared authorization helpers for the listing-files routes.
 *
 * `crm_listing_files` has no `business_unit` of its own, so access is always derived
 * from the parent listing.
 */
import { isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const LISTING_FILES_BUCKET = 'listing-files';

/**
 * Full listing-access check honoring the "Restricted" folder flag:
 * - admins: always;
 * - otherwise the listing must be in the caller's business_unit, AND
 * - if the listing is Restricted, the caller must be the owner (listing_agent_id)
 *   or in assigned_agent_ids.
 * Returns the listing row, or null for no-such / forbidden (callers answer 404).
 */
export async function assertCanAccessListing(listingId: string, ctx: CrmContext): Promise<Record<string, unknown> | null> {
  const { data } = await adminClient()
    .from('crm_listings')
    .select('id, business_unit, listing_agent_id, assigned_agent_ids, is_restricted')
    .eq('id', listingId).maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row) return null;
  if (isAdminRole(ctx.role)) return row;
  if (row.business_unit !== ctx.businessUnit) return null;
  if (row.is_restricted) {
    const owner = row.listing_agent_id === ctx.userId;
    const assigned = Array.isArray(row.assigned_agent_ids) && (row.assigned_agent_ids as string[]).includes(ctx.userId);
    if (!owner && !assigned) return null;
  }
  return row;
}

/**
 * Rent-roll access, which is deliberately tighter than listing access.
 *
 * What a property earns, suite by suite, is owner-level information: the whole
 * roll, not just one deal. Agents therefore see it only for properties they are
 * actually tagged on — as the listing agent, or in `assigned_agent_ids` — no
 * matter whether the listing carries the Restricted flag. Admins (broker level
 * and above) always see it; the flag is for sharing, this is for confidentiality,
 * and the two should not be tied together.
 *
 * Covers the reconciliation packets as well, since those bill straight off the
 * roll and would otherwise be a way around it.
 */
export async function assertCanSeeRentRoll(listingId: string, ctx: CrmContext): Promise<Record<string, unknown> | null> {
  const { data } = await adminClient()
    .from('crm_listings')
    .select('id, business_unit, listing_agent_id, assigned_agent_ids, is_restricted')
    .eq('id', listingId).maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row) return null;
  if (isAdminRole(ctx.role)) return row;
  if (row.business_unit !== ctx.businessUnit) return null;
  const owner = row.listing_agent_id === ctx.userId;
  const assigned = Array.isArray(row.assigned_agent_ids) && (row.assigned_agent_ids as string[]).includes(ctx.userId);
  return owner || assigned ? row : null;
}

/** True when the caller may access `listingId` (workspace + Restricted-flag aware). */
export async function callerCanAccessListing(listingId: string, ctx: CrmContext): Promise<boolean> {
  return !!(await assertCanAccessListing(listingId, ctx));
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
