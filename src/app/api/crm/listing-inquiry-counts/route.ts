import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { buildInquiries, taggedListingIds, targetedCounts } from '@/lib/listing-inquiries';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crm/listing-inquiry-counts — { counts: { [listingId]: number } }: how many contacts, callers and deals asked about each
 * property (#-tagged in notes / calls / meetings). Each count is exactly the list the property's "Asked about this property" shows
 * for THIS caller (same function, same access rules), so a number never reveals something the list would hide.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const db = adminClient();
  const ids = await taggedListingIds();
  const counts: Record<string, number> = {};
  await Promise.all(ids.map(async id => {
    if (!(await assertCanAccessListing(id, ctx))) return;
    const r = await buildInquiries(ctx, id);
    if (r.ok && r.items.length) counts[id] = r.items.length;
  }));
  return NextResponse.json({ counts, targeted: await targetedCounts(ctx).catch(() => ({})) });
}
