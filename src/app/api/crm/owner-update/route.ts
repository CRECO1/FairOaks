import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanSeeRentRoll } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { buildOwnerUpdate, saveOwnerUpdateDraft } from '@/lib/owner-update';

export const dynamic = 'force-dynamic';

/** POST /api/crm/owner-update { listing_id } — writes this week's owner update for the property into the CALLER's Drafts (review it, then send it yourself). Never sends anything. */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => null);
  const listingId = String(b?.listing_id ?? '');
  if (!listingId || !(await assertCanSeeRentRoll(listingId, ctx))) return notFound('Listing not found');
  const db = adminClient();
  const u = await buildOwnerUpdate(db, ctx, listingId);
  if (!u) return NextResponse.json({ ok: false, reason: 'nothing_to_report' });
  const key = await saveOwnerUpdateDraft(db, ctx.userId, u).catch(() => null);
  if (!key) return NextResponse.json({ error: 'Could not save the draft' }, { status: 500 });
  return NextResponse.json({ ok: true, key, subject: u.subject, to: u.to, recipients: u.recipients });
}
