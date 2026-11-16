import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { buildInquiries, buildMentions, buildTargeted, buildFunnel, type InquiryItem } from '@/lib/listing-inquiries';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/crm/listing-inquiries?listing_id=… — who asked about this property: contacts whose notes (or a logged call / meeting /
 * note) #-tagged it, e.g. "#1222Chulie", calls whose note tagged it from a caller who is not a contact yet, and deals whose
 * notes (summary, dated notes, meetings) tagged it.
 * Answers "who asked about this building?" even when no deal exists.
 *
 * Access: the caller must be able to open the listing, and a contact only appears if the caller could open that contact
 * (new-lead holds are the broker's alone; otherwise same workspace, admins see all) — the same rule as assertOwnsResource.
 */
export type { InquiryItem };

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id') ?? '';
  if (!UUID.test(listingId)) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
  const r = await buildInquiries(ctx, listingId);
  if (!r.ok) return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  const targeted = await buildTargeted(ctx, listingId).catch(() => ({ total: 0, items: [] }));
  return NextResponse.json({ items: r.items, mentions: await buildMentions(ctx, listingId).catch(() => []), targeted, funnel: await buildFunnel(ctx, listingId, r.items, targeted.total).catch(() => null) });
}
