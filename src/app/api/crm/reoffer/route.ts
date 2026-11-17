import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { buildReoffer, saveReofferDrafts, REOFFER_STATUSES } from '@/lib/reoffer';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/crm/reoffer?listing_id= — who asked about a property that is now leased / sold / under contract, and which of our other active listings might suit them (read-only). */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('listing_id') ?? '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  const r = await buildReoffer(adminClient(), ctx, id);
  if (!r) return notFound('Listing not found');
  return NextResponse.json({ ...r, eligible: REOFFER_STATUSES.includes(r.listing.status) });
}

/**
 * POST /api/crm/reoffer {listing_id, contact_ids?} — saves a re-offer email DRAFT for each chosen asker in YOUR Drafts (your signature). Nothing is sent: you read, edit and send
 * each one yourself. A person who already has a re-offer draft for that property is skipped.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => null);
  const id = String(b?.listing_id ?? '');
  if (!UUID.test(id)) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  const contactIds = Array.isArray(b?.contact_ids) ? (b.contact_ids as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 200) : null;
  const db = adminClient();
  const r = await buildReoffer(db, ctx, id);
  if (!r) return notFound('Listing not found');
  if (!REOFFER_STATUSES.includes(r.listing.status)) return NextResponse.json({ error: 'This property is still active, so there is nothing to re-offer.' }, { status: 409 });
  const out = await saveReofferDrafts(db, ctx, r, contactIds);
  return NextResponse.json({ ok: true, ...out });
}
