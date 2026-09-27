import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, assertOwnsResource } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { generateLoi } from '@/lib/loi-generate';

/**
 * POST /api/crm/form-fill/generate
 *
 * Renders the reviewed draft to a PDF and files it on the deal as a saved document.
 *
 * It STOPS THERE. No envelope, no email, no signer. E-signature stays the separate,
 * manual step it is today: /api/crm/envelopes already refuses a submission with no
 * saved PDF, so the natural next action is the one a person takes after opening this
 * document and reading it.
 *
 * The values are rebuilt here from the same resolver the draft used, with the agent's
 * edits passed back in `provided` — so the document is generated from data the server
 * derived, not from a blob the client assembled.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const b = await req.json().catch(() => ({}));
  const formId = String(b.form_id ?? '');
  const dealId = b.deal_id ? String(b.deal_id) : null;
  const contactId = b.contact_id ? String(b.contact_id) : null;
  const side = typeof b.side === 'string' ? b.side : null;
  const listingId = b.listing_id ? String(b.listing_id) : null;
  const submissionId = b.submission_id ? String(b.submission_id) : null;
  if (!formId) return NextResponse.json({ error: 'form_id required' }, { status: 400 });

  if (dealId && !(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
  if (contactId && !(await assertOwnsResource('crm_clients', contactId, ctx))) return notFound('Contact not found');
  if (listingId && !(await assertCanAccessListing(listingId, ctx))) return notFound('Property not found');
  if (submissionId && !(await assertOwnsResource('crm_form_submissions', submissionId, ctx))) return notFound('Document not found');

  const db = adminClient();
  const { data: prof } = await db.from('crm_profiles').select('first_name, last_name, email, phone, license').eq('id', ctx.userId).maybeSingle();
  const agent = {
    name: `${prof?.first_name ?? ''} ${prof?.last_name ?? ''}`.trim(),
    email: prof?.email ?? '', phone: prof?.phone ?? '', license: prof?.license ?? '',
  };

  const r = await generateLoi(db, ctx.userId, ctx.businessUnit, agent, {
    formId, dealId, contactId, listingId, submissionId, side,
    provided: (b.provided && typeof b.provided === 'object') ? b.provided as Record<string, string> : {},
    acknowledgeDirection: b.acknowledge_direction === true,
    baseUrl: req.nextUrl.origin,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error, ...(r.missingRequired ? { missingRequired: r.missingRequired } : {}), ...(r.blocked ? { blocked: r.blocked } : {}) }, { status: r.status });
  }
  return NextResponse.json({
    submission: r.submission, url: r.url, side: r.side, filedOn: r.filedOn,
    // Said plainly so no caller mistakes filing for sending.
    note: 'Filed as a draft on the deal. Nothing has been sent — e-signature is a separate step.',
  });
}
