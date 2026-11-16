import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { buildInquiries } from '@/lib/listing-inquiries';
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
  const tables = ['crm_clients', 'crm_client_activities', 'crm_call_log', 'crm_deals', 'crm_deal_notes', 'crm_deal_meetings'];
  const rows = await Promise.all(tables.map(t => db.from(t).select('tagged_listing_ids').not('tagged_listing_ids', 'eq', '{}').limit(1000)));
  if (rows.some(r => r.error)) return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  const ids = [...new Set(rows.flatMap(r => (r.data ?? []).flatMap(x => (x as { tagged_listing_ids: string[] | null }).tagged_listing_ids ?? [])))].slice(0, 80);
  const counts: Record<string, number> = {};
  await Promise.all(ids.map(async id => {
    if (!(await assertCanAccessListing(id, ctx))) return;
    const r = await buildInquiries(ctx, id);
    if (r.ok && r.items.length) counts[id] = r.items.length;
  }));
  return NextResponse.json({ counts });
}
