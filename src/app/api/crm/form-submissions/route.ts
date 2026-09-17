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

// ── Overlay-doc edit log ────────────────────────────────────────────────────
// Builder docs (the LOIs) diff their term list; every OTHER transaction doc is a
// flat overlay of placed fields, so diff the typed values instead. Fields are
// matched by their stable `id`, and a field that wraps across lines is stored as
// `key_l0`/`key_l1` — group those so the summary says "Rent" once, not "Rent, Rent".
interface OverlayField { id?: string; type?: string; value?: string; label?: string; fieldKey?: string }

function overlayLabel(f: OverlayField): string {
  const base = (f.fieldKey || '').replace(/_l\d+$/, '');
  return (f.label || base || 'field').replace(/\s*[:#]$/, '');
}

function diffOverlay(oldVals: unknown, newVals: unknown) {
  const list = (v: unknown): OverlayField[] => Array.isArray(v) ? (v as OverlayField[]) : [];
  // Signature/initial/date placeholders are stamped at signing, not typed by the
  // agent — they'd churn the log on every send, so leave them out.
  const typed = (f: OverlayField) => !f.type || f.type === 'text' || f.type === 'check';
  const byId = (arr: OverlayField[]) => new Map(arr.filter(f => f.id && typed(f)).map(f => [f.id as string, f]));
  const oldMap = byId(list(oldVals)), newMap = byId(list(newVals));
  const filled = new Set<string>(), cleared = new Set<string>(), edited = new Set<string>();
  for (const [id, f] of newMap) {
    const before = (oldMap.get(id)?.value ?? '').trim();
    const after = (f.value ?? '').trim();
    if (before === after) continue;
    if (!before) filled.add(overlayLabel(f));
    else if (!after) cleared.add(overlayLabel(f));
    else edited.add(overlayLabel(f));
  }
  for (const [id, f] of oldMap) {
    if (newMap.has(id)) continue;
    if ((f.value ?? '').trim()) cleared.add(overlayLabel(f));   // the whole field was removed
  }
  return { filled: [...filled], cleared: [...cleared], edited: [...edited] };
}

// Keep summaries readable when someone fills a 40-blank contract in one pass.
function nameList(names: string[], cap = 4): string {
  if (names.length <= cap) return names.join(', ');
  return `${names.slice(0, cap).join(', ')} +${names.length - cap} more`;
}

function summarizeOverlay(d: ReturnType<typeof diffOverlay>): string {
  const parts: string[] = [];
  if (d.edited.length) parts.push(`Edited ${nameList(d.edited)}`);
  if (d.filled.length) parts.push(`Filled ${nameList(d.filled)}`);
  if (d.cleared.length) parts.push(`Cleared ${nameList(d.cleared)}`);
  return parts.join(' · ');
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
  const clientId = req.nextUrl.searchParams.get('client_id');
  // These ids are interpolated into PostgREST .or() filter strings below, so reject
  // anything that isn't a bare UUID — otherwise a value like "x,status.eq.signed"
  // injects extra filter clauses and widens the query.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const [k, v] of Object.entries({ deal_id: dealId, listing_id: listingId, client_id: clientId })) {
    if (v && !UUID_RE.test(v)) return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
  }
  const supabase = adminClient();
  let q = supabase
    .from('crm_form_submissions')
    .select('id, form_id, deal_id, listing_id, client_id, title, filled_path, status, created_at, updated_at, crm_forms(name, form_code)')
    .order('updated_at', { ascending: false });
  if (!isAdminRole(ctx.role)) q = q.eq('business_unit', ctx.businessUnit);
  // A document lives in ONE row that both surfaces read, so an edit made from a deal
  // and an edit made from the property are the same edit — they mirror by construction
  // rather than by copying. What differs is the view:
  //   deal D at property L  → D's own docs, plus L's property-level docs
  //   property L            → L's own docs, plus every doc on a deal at L
  // The `deal_id.is.null` guard on the deal side matters: without it, deal D would also
  // pull in the docs of every OTHER deal at the same property.
  if (dealId) {
    if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
    const { data: deal } = await supabase.from('crm_deals').select('listing_id').eq('id', dealId).maybeSingle();
    const lid = deal?.listing_id as string | null | undefined;
    // Only mirror the property's docs down if the caller may see that property.
    q = lid && await assertCanAccessListing(lid, ctx)
      ? q.or(`deal_id.eq.${dealId},and(listing_id.eq.${lid},deal_id.is.null)`)
      : q.eq('deal_id', dealId);
  }
  // A contact's documents: the ones filed directly on them, plus the ones on their
  // deals — a lease filed against the deal is still that person's lease.
  if (clientId) {
    let dq = supabase.from('crm_deals').select('id').eq('client_id', clientId);
    if (!isAdminRole(ctx.role)) dq = dq.eq('business_unit', ctx.businessUnit);
    const { data: theirDeals } = await dq;
    const ids = (theirDeals ?? []).map(d => d.id as string);
    q = ids.length
      ? q.or(`client_id.eq.${clientId},deal_id.in.(${ids.join(',')})`)
      : q.eq('client_id', clientId);
  }

  if (listingId) {
    if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
    let dq = supabase.from('crm_deals').select('id').eq('listing_id', listingId);
    if (!isAdminRole(ctx.role)) dq = dq.eq('business_unit', ctx.businessUnit);
    const { data: dealsAtListing } = await dq;
    const ids = (dealsAtListing ?? []).map(d => d.id as string);
    // A doc with a deal_id belongs to that deal: it shows here only while the deal is
    // at this property. (Filtering on listing_id alone kept showing a deal's docs after
    // the deal was unlinked or moved, because they still carried this listing_id.)
    q = ids.length
      ? q.or(`and(listing_id.eq.${listingId},deal_id.is.null),deal_id.in.(${ids.join(',')})`)
      : q.eq('listing_id', listingId).is('deal_id', null);
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
      form_id: src.form_id, deal_id: src.deal_id, listing_id: src.listing_id, client_id: src.client_id ?? null, business_unit: src.business_unit,
      title: `${src.title || 'Document'} (copy)`, values: src.values ?? [], status: 'saved', filled_path, created_by: ctx.userId,
      // Carry the editable source so a copied builder doc (e.g. an LOI) stays re-editable.
      builder_data: src.builder_data ?? null,
    }).select().single();
    if (error) { console.error('[api/form-submissions] copy', error); return NextResponse.json({ error: 'Copy failed' }, { status: 500 }); }
    return NextResponse.json({ submission: copy });
  }

  const { form_id, deal_id, listing_id, client_id, title, values, pdfBase64, business_unit, submission_id, builder_data } = body;
  // Explicit intent flags for an UPDATE. Editors always send the deal they were opened
  // from and the template's name; neither means "move this doc" or "rename it".
  const relinkDeal = body.relink_deal === true;
  const retitle = body.retitle === true;
  if (!form_id && !submission_id) return NextResponse.json({ error: 'form_id required' }, { status: 400 });
  const supabase = adminClient();

  // An update may only target a submission in the caller's workspace.
  if (submission_id && !(await assertOwnsResource('crm_form_submissions', submission_id, ctx))) {
    return notFound('Submission not found');
  }
  // Agents can't file a submission against another workspace's deal, listing, or unit.
  if (deal_id && (!submission_id || relinkDeal) && !(await assertOwnsResource('crm_deals', deal_id, ctx))) {
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
    const path = `submissions/${form_id ?? 'imported'}/${stamp}.pdf`;
    const { error: upErr } = await supabase.storage.from('transaction-forms').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) console.error('[api/form-submissions] upload', upErr);
    else filled_path = path;
  }

  // Snapshot the prior builder state so the save can log what the agent changed,
  // and the prior links so a save never silently unfiles the doc (below).
  let priorBuilder: LoiData | null = null;
  let priorValues: unknown = null;
  let priorLinks: { deal_id: string | null; listing_id: string | null; client_id: string | null } | null = null;
  let priorTitle: string | null = null;
  if (submission_id) {
    const { data: prior } = await supabase.from('crm_form_submissions')
      .select('builder_data, values, deal_id, listing_id, client_id, title').eq('id', submission_id).maybeSingle();
    priorBuilder = (prior?.builder_data as LoiData) ?? null;
    priorValues = prior?.values ?? null;
    if (prior) { priorLinks = { deal_id: prior.deal_id ?? null, listing_id: prior.listing_id ?? null, client_id: prior.client_id ?? null }; priorTitle = prior.title ?? null; }
  }

  const base = {
    ...(form_id ? { form_id } : {}),
    // Because the two surfaces mirror each other, a property-level doc can be edited
    // from a deal (and vice versa) — and that caller only knows its OWN id. Writing
    // `deal_id || null` there would null the doc's listing_id and drop it out of the
    // property. Keep whichever link the caller didn't speak to.
    // A property-level doc is mirrored into every deal at the property, so the deal an
    // editor was opened from says nothing about where the doc lives. On update the deal
    // link only changes when the caller explicitly re-links (the deal picker) — which is
    // also how a doc is unlinked (relink_deal with deal_id null).
    deal_id: priorLinks ? (relinkDeal ? (deal_id || null) : priorLinks.deal_id) : (deal_id || null),
    listing_id: listing_id || priorLinks?.listing_id || null,
    client_id: client_id || priorLinks?.client_id || null,
    business_unit: unit,
    // Saving must not undo a rename: editors send the template's name every time.
    title: priorLinks && !retitle ? (priorTitle ?? title ?? null) : (title || null),
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

  // Audit trail: what an agent changed, on EVERY transaction doc — builder docs
  // (LOI term edits/deletions) and flat overlay forms alike. A save that changed
  // nothing writes nothing, so the history stays signal.
  if (res.data) {
    try {
      let summary = 'Created'; let changes: unknown = {};
      if (submission_id) {
        if (builder_data !== undefined) {
          if (priorBuilder) { const d = diffBuilder(priorBuilder, builder_data as LoiData); summary = summarizeDiff(d); changes = d; }
          else { summary = 'Created in the builder'; }   // first builder save: nothing to diff against
        }
        else { const d = diffOverlay(priorValues, values ?? []); summary = summarizeOverlay(d); changes = d; }
      }
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

  // A document that has been signed is a business record, and the envelope carries
  // the only proof of it: the executed PDF, each signer's signature image, the
  // consent, the timestamps and the IP. Deleting the document used to destroy all of
  // that — walking straight past the archive-not-delete rule on /api/crm/envelopes.
  const { data: envs } = await supabase.from('crm_envelopes')
    .select('id, status, executed_path, executed_clean_path').eq('submission_id', id);
  const executed = (envs ?? []).filter(e => e.status === 'completed');
  if (executed.length) {
    return NextResponse.json({
      error: 'This document has been signed, so it can’t be deleted — the executed copy and the record of who signed it live with it. Archive the signature request instead.',
    }, { status: 400 });
  }

  const { data: sub } = await supabase.from('crm_form_submissions').select('filled_path').eq('id', id).maybeSingle();
  if (sub?.filled_path) { await supabase.storage.from('transaction-forms').remove([sub.filled_path]); }
  // Cancel + clean up any UNSIGNED signature request on this document (voids pending
  // signers by removing the envelope, so their sign links stop working).
  for (const e of envs ?? []) {
    const { data: signers } = await supabase.from('crm_envelope_signers')
      .select('signature_path, initials_path').eq('envelope_id', e.id);
    // Every blob the envelope owns, not just the certificate copy — the clean copy
    // was being left behind in storage with nothing pointing at it.
    const blobs = [
      ...(signers ?? []).flatMap(s => [s.signature_path, s.initials_path]),
      e.executed_path, e.executed_clean_path,
    ].filter(Boolean) as string[];
    await supabase.from('crm_envelope_events').delete().eq('envelope_id', e.id);
    await supabase.from('crm_envelope_signers').delete().eq('envelope_id', e.id);
    if (blobs.length) await supabase.storage.from('transaction-forms').remove(blobs);
    await supabase.from('crm_envelopes').delete().eq('id', e.id);
  }
  // The edit log references the document; clear it first so the delete isn't blocked.
  await supabase.from('crm_form_submission_edits').delete().eq('submission_id', id);
  const { error } = await supabase.from('crm_form_submissions').delete().eq('id', id);
  if (error) { console.error('[api/form-submissions] DELETE', error); return NextResponse.json({ error: 'Delete failed' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
