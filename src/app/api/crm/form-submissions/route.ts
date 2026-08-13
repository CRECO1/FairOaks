import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

// Completed/in-progress form instances (crm_form_submissions): stores the field
// VALUES (jsonb, so it can be re-opened & edited) and a generated PDF in storage.
// Optionally linked to a deal via deal_id.
//
// These hold transaction-document PII, so every read and write is scoped to the
// caller's business_unit (admins bypass).

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const dealId = req.nextUrl.searchParams.get('deal_id');
  const listingId = req.nextUrl.searchParams.get('listing_id');
  const supabase = adminClient();
  let q = supabase
    .from('crm_form_submissions')
    .select('id, form_id, deal_id, listing_id, title, filled_path, status, created_at, updated_at, crm_forms(name, form_code)')
    .order('updated_at', { ascending: false });
  if (!isAdminRole(ctx.role)) q = q.eq('business_unit', ctx.businessUnit);
  if (dealId) {
    if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
    q = q.eq('deal_id', dealId);
  }
  if (listingId) {
    if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
    q = q.eq('listing_id', listingId);
  }
  const { data, error } = await q;
  if (error) { console.error('[api/form-submissions] GET', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  const submissions = await Promise.all((data ?? []).map(async (s) => {
    let url: string | null = null;
    if (s.filled_path) {
      const { data: sg } = await supabase.storage.from('transaction-forms').createSignedUrl(s.filled_path, 3600);
      url = sg?.signedUrl ?? null;
    }
    return { ...s, url };
  }));
  return NextResponse.json({ submissions });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const { form_id, deal_id, listing_id, title, values, pdfBase64, business_unit, submission_id } = body;
  if (!form_id) return NextResponse.json({ error: 'form_id required' }, { status: 400 });
  const supabase = adminClient();

  // An update may only target a submission in the caller's workspace.
  if (submission_id && !(await assertOwnsResource('crm_form_submissions', submission_id, ctx))) {
    return notFound('Submission not found');
  }
  // Agents can't file a submission against another workspace's deal, listing, or unit.
  if (deal_id && !(await assertOwnsResource('crm_deals', deal_id, ctx))) {
    return notFound('Deal not found');
  }
  if (listing_id && !(await assertCanAccessListing(listing_id, ctx))) {
    return notFound('Listing not found');
  }
  const unit = isAdminRole(ctx.role)
    ? (business_unit || ctx.businessUnit || 'commercial')
    : (ctx.businessUnit ?? 'commercial');

  let filled_path: string | null = null;
  if (pdfBase64) {
    const bytes = Buffer.from(pdfBase64, 'base64');
    const stamp = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    const path = `submissions/${form_id}/${stamp}.pdf`;
    const { error: upErr } = await supabase.storage.from('transaction-forms').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) console.error('[api/form-submissions] upload', upErr);
    else filled_path = path;
  }

  const base = {
    form_id,
    deal_id: deal_id || null,
    listing_id: listing_id || null,
    business_unit: unit,
    title: title || null,
    values: values ?? [],
    status: 'saved',
    updated_at: new Date().toISOString(),
    ...(filled_path ? { filled_path } : {}),
  };

  const res = submission_id
    ? await supabase.from('crm_form_submissions').update(base).eq('id', submission_id).select().single()
    : await supabase.from('crm_form_submissions').insert({ ...base, created_by: ctx.userId }).select().single();

  if (res.error) { console.error('[api/form-submissions] save', res.error); return NextResponse.json({ error: 'Save failed' }, { status: 500 }); }
  return NextResponse.json({ submission: res.data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_form_submissions', id, ctx))) return notFound('Document not found');
  const supabase = adminClient();
  const { data: sub } = await supabase.from('crm_form_submissions').select('filled_path').eq('id', id).maybeSingle();
  if (sub?.filled_path) { await supabase.storage.from('transaction-forms').remove([sub.filled_path]); }
  const { error } = await supabase.from('crm_form_submissions').delete().eq('id', id);
  if (error) { console.error('[api/form-submissions] DELETE', error); return NextResponse.json({ error: 'Delete failed' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
