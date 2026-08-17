import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

// ── Builder-doc edit log (audit trail of what an agent changed on save) ──────
interface LoiTerm { id?: string; label?: string; value?: string }
interface LoiData { terms?: LoiTerm[]; sellers?: unknown; [k: string]: unknown }

function diffBuilder(oldD: LoiData | null, newD: LoiData) {
  const oldTerms = oldD?.terms ?? [], newTerms = newD?.terms ?? [];
  const map = (arr: LoiTerm[]) => new Map(arr.filter(t => t.id).map(t => [t.id as string, t]));
  const oldMap = map(oldTerms), newMap = map(newTerms);
  const clean = (l?: string) => (l || 'term').replace(/:$/, '');
  const removed: string[] = [], added: string[] = [], edited: string[] = [];
  for (const t of oldTerms) if (t.id && !newMap.has(t.id)) removed.push(clean(t.label));
  for (const t of newTerms) if (t.id && !oldMap.has(t.id)) added.push(clean(t.label));
  for (const t of newTerms) { const o = t.id ? oldMap.get(t.id) : undefined; if (o && (o.value !== t.value || o.label !== t.label)) edited.push(clean(t.label)); }
  const FMAP: Record<string, string> = { loiDate: 'date', addresseeName: 'addressee', addresseeAddr1: 'addressee', addresseeAddr2: 'addressee', reLine: 'Re line', agentName: 'sign-off', agentEmail: 'sign-off', agentPhone: 'sign-off', additionalTerms: 'Other Stipulations' };
  const fields = new Set<string>();
  for (const k of Object.keys(FMAP)) if (String(oldD?.[k] ?? '') !== String(newD?.[k] ?? '')) fields.add(FMAP[k]);
  if (JSON.stringify(oldD?.sellers ?? []) !== JSON.stringify(newD?.sellers ?? [])) fields.add('signers');
  return { removed, added, edited, fields: Array.from(fields) };
}

function summarizeDiff(d: ReturnType<typeof diffBuilder>): string {
  const parts: string[] = [];
  if (d.removed.length) parts.push(`Removed ${d.removed.join(', ')}`);
  if (d.added.length) parts.push(`Added ${d.added.length} term${d.added.length > 1 ? 's' : ''}`);
  if (d.edited.length) parts.push(`Edited ${d.edited.join(', ')}`);
  if (d.fields.length) parts.push(`Updated ${d.fields.join(', ')}`);
  return parts.join(' · ');
}

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

  // Duplicate an existing submission (server-side copy of its values + PDF).
  if (body.copy_from) {
    if (!(await assertOwnsResource('crm_form_submissions', body.copy_from, ctx))) return notFound('Document not found');
    const supabase = adminClient();
    const { data: src } = await supabase.from('crm_form_submissions').select('*').eq('id', body.copy_from).single();
    if (!src) return notFound('Document not found');
    let filled_path: string | null = null;
    if (src.filled_path) {
      const { data: blob } = await supabase.storage.from('transaction-forms').download(src.filled_path);
      if (blob) {
        const bytes = Buffer.from(await blob.arrayBuffer());
        const path = `submissions/${src.form_id}/${Date.now()}_${Math.round(Math.random() * 1e6)}.pdf`;
        const { error: upErr } = await supabase.storage.from('transaction-forms').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
        if (!upErr) filled_path = path;
      }
    }
    const { data: copy, error } = await supabase.from('crm_form_submissions').insert({
      form_id: src.form_id, deal_id: src.deal_id, listing_id: src.listing_id, business_unit: src.business_unit,
      title: `${src.title || 'Document'} (copy)`, values: src.values ?? [], status: 'saved', filled_path, created_by: ctx.userId,
      // Carry the editable source so a copied builder doc (e.g. an LOI) stays re-editable.
      builder_data: src.builder_data ?? null,
    }).select().single();
    if (error) { console.error('[api/form-submissions] copy', error); return NextResponse.json({ error: 'Copy failed' }, { status: 500 }); }
    return NextResponse.json({ submission: copy });
  }

  const { form_id, deal_id, listing_id, title, values, pdfBase64, business_unit, submission_id, builder_data } = body;
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

  // Snapshot the prior builder state so the save can log what the agent changed.
  let priorBuilder: LoiData | null = null;
  if (builder_data !== undefined && submission_id) {
    const { data: prior } = await supabase.from('crm_form_submissions').select('builder_data').eq('id', submission_id).maybeSingle();
    priorBuilder = (prior?.builder_data as LoiData) ?? null;
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
    // Editable source for builder-style docs (e.g. the LOI to Purchase term list),
    // so the doc can be reopened and regenerated. Plain overlay forms never send it.
    ...(builder_data !== undefined ? { builder_data } : {}),
  };

  const res = submission_id
    ? await supabase.from('crm_form_submissions').update(base).eq('id', submission_id).select().single()
    : await supabase.from('crm_form_submissions').insert({ ...base, created_by: ctx.userId }).select().single();

  if (res.error) { console.error('[api/form-submissions] save', res.error); return NextResponse.json({ error: 'Save failed' }, { status: 500 }); }

  // Audit trail: record what an agent changed on a builder doc (LOI term edits/deletions).
  if (builder_data !== undefined && res.data) {
    try {
      let summary = 'Created'; let changes: unknown = {};
      if (submission_id) { const d = diffBuilder(priorBuilder, builder_data as LoiData); summary = summarizeDiff(d); changes = d; }
      if (summary) await supabase.from('crm_form_submission_edits').insert({ submission_id: (res.data as { id: string }).id, editor_id: ctx.userId, business_unit: unit, summary, changes });
    } catch (e) { console.error('[api/form-submissions] edit-log', e); }
  }

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
  // Cancel + clean up any signature request on this document (voids pending signers by
  // removing the envelope, so their sign links stop working) before deleting the row.
  const { data: envs } = await supabase.from('crm_envelopes').select('id, executed_path').eq('submission_id', id);
  for (const e of envs ?? []) {
    await supabase.from('crm_envelope_events').delete().eq('envelope_id', e.id);
    await supabase.from('crm_envelope_signers').delete().eq('envelope_id', e.id);
    if (e.executed_path) await supabase.storage.from('transaction-forms').remove([e.executed_path]);
    await supabase.from('crm_envelopes').delete().eq('id', e.id);
  }
  const { error } = await supabase.from('crm_form_submissions').delete().eq('id', id);
  if (error) { console.error('[api/form-submissions] DELETE', error); return NextResponse.json({ error: 'Delete failed' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
