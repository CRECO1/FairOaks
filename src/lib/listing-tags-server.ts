import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrmContext } from '@/lib/crm-auth';
import { listingAccessible } from '@/lib/listing-files-access';
import { parseListingTagIds } from '@/lib/listing-tags';

/**
 * The listings #-tagged in a note ("#1222Chulie"), restricted to listings the caller may open in `unit` — so a tag can
 * never be used to attach (or learn the existence of) a Restricted property the person can't see.
 * Returns [] fast when the text has no '#'.
 */
export async function listingTagIdsForText(db: SupabaseClient, ctx: CrmContext, unit: string, text: unknown): Promise<string[]> {
  const t = typeof text === 'string' ? text : '';
  if (!t.includes('#')) return [];
  const { data } = await db.from('crm_listings')
    .select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').eq('business_unit', unit).or('status.is.null,status.neq.merged');
  const visible = (data ?? []).filter(l => listingAccessible(l as Record<string, unknown>, ctx));
  return parseListingTagIds(t, visible as { id: string; name: string | null; address: string | null }[]);
}
