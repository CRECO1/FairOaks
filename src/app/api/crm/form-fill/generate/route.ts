import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, assertOwnsResource } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { buildLoiDraft, missingRequired } from '@/lib/loi-autofill';
import { renderLoi, specForForm } from '@/lib/loi-doc';

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

/** The letterhead, fetched from our own public assets once per warm instance. */
let logoCache: Uint8Array | null = null;
async function letterhead(origin: string): Promise<Uint8Array> {
  if (logoCache) return logoCache;
  const res = await fetch(`${origin}/creco-letterhead-logo.png`);
  if (!res.ok) throw new Error(`letterhead ${res.status}`);
  logoCache = new Uint8Array(await res.arrayBuffer());
  return logoCache;
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const b = await req.json().catch(() => ({}));
  const formId = String(b.form_id ?? '');
  const dealId = b.deal_id ? String(b.deal_id) : null;
  const listingId = b.listing_id ? String(b.listing_id) : null;
  const submissionId = b.submission_id ? String(b.submission_id) : null;
  if (!formId) return NextResponse.json({ error: 'form_id required' }, { status: 400 });

  if (dealId && !(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
  if (listingId && !(await assertCanAccessListing(listingId, ctx))) return notFound('Property not found');
  if (submissionId && !(await assertOwnsResource('crm_form_submissions', submissionId, ctx))) return notFound('Document not found');

  const db = adminClient();
  const { data: prof } = await db.from('crm_profiles').select('first_name, last_name, email, phone, license').eq('id', ctx.userId).maybeSingle();
  const agent = {
    name: `${prof?.first_name ?? ''} ${prof?.last_name ?? ''}`.trim(),
    email: prof?.email ?? '', phone: prof?.phone ?? '', license: prof?.license ?? '',
  };

  const draft = await buildLoiDraft(db, agent, {
    formId, dealId, listingId,
    provided: (b.provided && typeof b.provided === 'object') ? b.provided as Record<string, string> : {},
  });
  if ('error' in draft) return NextResponse.json({ error: draft.error }, { status: 400 });

  // ── The gate. Nothing is rendered while a required blank is still a blank. ──
  const missing = missingRequired(draft);
  if (missing.length) {
    return NextResponse.json({
      error: `Still missing: ${missing.map(m => m.label).join(', ')}`,
      missingRequired: missing,
    }, { status: 422 });
  }
  // A direction mismatch is overridable, but only deliberately and on the record.
  if (draft.blocked && b.acknowledge_direction !== true) {
    return NextResponse.json({ error: draft.blocked.reason, blocked: draft.blocked }, { status: 409 });
  }

  const { data: form } = await db.from('crm_forms').select('id, name, form_code, business_unit').eq('id', formId).maybeSingle();
  const spec = specForForm(form?.form_code, form?.name ?? '');
  if (!spec) return NextResponse.json({ error: 'That form is not a Letter of Intent.' }, { status: 400 });

  let pdfBytes: Uint8Array;
  let sigFields: unknown[];
  try {
    const out = await renderLoi(draft.data, await letterhead(req.nextUrl.origin), spec);
    pdfBytes = out.pdfBytes; sigFields = out.sigFields;
  } catch (e) {
    console.error('[form-fill/generate] render', e);
    return NextResponse.json({ error: 'Could not build the document.' }, { status: 500 });
  }

  const path = `submissions/${formId}/${Date.now()}_${Math.round(Math.random() * 1e6)}.pdf`;
  const { error: upErr } = await db.storage.from('transaction-forms')
    .upload(path, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true });
  if (upErr) { console.error('[form-fill/generate] upload', upErr); return NextResponse.json({ error: 'Could not save the document.' }, { status: 500 }); }

  const row = {
    form_id: formId, deal_id: dealId, listing_id: draft.listingId,
    business_unit: form?.business_unit ?? ctx.businessUnit ?? 'commercial',
    title: spec.title, values: sigFields, builder_data: draft.data,
    filled_path: path, status: 'saved', updated_at: new Date().toISOString(),
  };

  const { data: saved, error } = submissionId
    ? await db.from('crm_form_submissions').update(row).eq('id', submissionId).select('id, title, filled_path, deal_id, listing_id, status').single()
    : await db.from('crm_form_submissions').insert({ ...row, created_by: ctx.userId }).select('id, title, filled_path, deal_id, listing_id, status').single();
  if (error) { console.error('[form-fill/generate] save', error); return NextResponse.json({ error: 'Could not file the document.' }, { status: 500 }); }

  const { data: signed } = await db.storage.from('transaction-forms').createSignedUrl(path, 60 * 60);

  return NextResponse.json({
    submission: saved,
    url: signed?.signedUrl ?? null,
    side: draft.side.side,
    // Said plainly so no caller mistakes filing for sending.
    note: 'Filed as a draft on the deal. Nothing has been sent — e-signature is a separate step.',
  });
}
