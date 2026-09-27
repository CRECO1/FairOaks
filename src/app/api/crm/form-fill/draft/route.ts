import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, assertOwnsResource } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { buildLoiDraft, missingRequired } from '@/lib/loi-autofill';

/**
 * POST /api/crm/form-fill/draft
 *
 * Proposes a filled Letter of Intent. It creates nothing, sends nothing and stores
 * nothing — it reads the deal, the contact, the property and the agent's profile and
 * returns what it could fill, what it could not, and where each value came from.
 *
 * Deliberately read-only. The agent reviews the draft and presses Generate, which is
 * the only step that writes. That division is the point: the risk on a legal document
 * is not a failed save, it is a plausible value nobody looked at.
 */
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const b = await req.json().catch(() => ({}));
  const formId = String(b.form_id ?? '');
  const dealId = b.deal_id ? String(b.deal_id) : null;
  const contactId = b.contact_id ? String(b.contact_id) : null;
  const side = typeof b.side === 'string' ? b.side : null;
  const listingId = b.listing_id ? String(b.listing_id) : null;
  if (!formId) return NextResponse.json({ error: 'form_id required' }, { status: 400 });

  // The draft reads a deal, a contact and a property, so it answers to the same
  // ownership checks the rest of the CRM does — the service-role key bypasses RLS.
  if (dealId && !(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
  if (contactId && !(await assertOwnsResource('crm_clients', contactId, ctx))) return notFound('Contact not found');
  if (listingId && !(await assertCanAccessListing(listingId, ctx))) return notFound('Property not found');

  const db = adminClient();
  const { data: prof } = await db.from('crm_profiles').select('first_name, last_name, email, phone, license').eq('id', ctx.userId).maybeSingle();
  const agent = {
    name: `${prof?.first_name ?? ''} ${prof?.last_name ?? ''}`.trim(),
    email: prof?.email ?? '', phone: prof?.phone ?? '', license: prof?.license ?? '',
  };

  const draft = await buildLoiDraft(db, agent, {
    formId, dealId, contactId, listingId, side,
    provided: (b.provided && typeof b.provided === 'object') ? b.provided as Record<string, string> : {},
  });
  if ('error' in draft) return NextResponse.json({ error: draft.error }, { status: 400 });

  const missing = missingRequired(draft);
  return NextResponse.json({
    draft,
    canGenerate: missing.length === 0 && !draft.blocked,
    missingRequired: missing,
  });
}
