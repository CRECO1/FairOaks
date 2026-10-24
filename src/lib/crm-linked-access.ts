/**
 * Access check for records that hang off a deal and/or a listing (form submissions, e-sign envelopes and
 * imports, LOI drafts, calls...). assertOwnsResource() only applies the private-deal rule to crm_deals itself, so
 * a child row used to be reachable by id by anyone in the workspace even when its deal is Restricted.
 *
 * True when the caller may act on a row with these links:
 *  - non-admins: the row must be in their workspace;
 *  - a linked deal must not be one of the caller's hidden (Restricted, not theirs) deals;
 *  - a linked listing must pass the listing check (workspace + Restricted flag).
 */
import { hiddenDealIds, isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';

export async function canAccessLinked(
  ctx: CrmContext,
  row: { business_unit?: string | null; deal_id?: string | null; listing_id?: string | null },
): Promise<boolean> {
  if (!isAdminRole(ctx.role) && row.business_unit && row.business_unit !== ctx.businessUnit) return false;
  if (row.deal_id && (await hiddenDealIds(ctx)).includes(row.deal_id)) return false;
  if (row.listing_id && !(await assertCanAccessListing(row.listing_id, ctx))) return false;
  return true;
}
