/**
 * Render a reviewed LOI draft and file it on the deal.
 *
 * Shared by the review screen's route and the copilot's complete_loi tool so there is
 * one implementation of "what gets stamped". The copilot used to reach this through an
 * HTTP call to our own API, which meant the generate step depended on the agent's
 * Bearer token surviving a server-to-server hop — the exact fragility that made
 * send_email fail silently. A direct call removes the hop, the token dependency and
 * the second set of auth checks that could drift from the first.
 *
 * Callers are responsible for authorization BEFORE calling this: it runs on the
 * service-role client and does not re-check ownership.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildLoiDraft, missingRequired, type DraftSlot } from '@/lib/loi-autofill';
import { renderLoi, specForForm } from '@/lib/loi-doc';
import { leaseSpec, type LoiPurchaseData } from '@/lib/loi-spec';
import { liveEnvelope, logDocEdit, OUT_FOR_SIGNATURE } from '@/lib/doc-edit';

export interface GenerateInput {
  formId: string;
  /** All optional: a deal, just a contact, or neither. */
  dealId?: string | null;
  contactId?: string | null;
  listingId?: string | null;
  /** Which side we act for, when the agent states it outright. */
  side?: string | null;
  provided?: Record<string, string>;
  submissionId?: string | null;
  /** Deliberate override of the direction warning (a listing-side deal). */
  acknowledgeDirection?: boolean;
  /** Where to fetch the letterhead from. */
  baseUrl: string;
}

export type GenerateResult =
  | { ok: true; submission: Record<string, unknown>; url: string | null; side: string; filedOn: string; unmatchedProvided: string[] }
  | { ok: false; status: number; error: string; missingRequired?: DraftSlot[]; blocked?: { reason: string; fix: string } };

/** The letterhead, fetched once per warm instance. */
let logoCache: Uint8Array | null = null;
async function letterhead(baseUrl: string): Promise<Uint8Array> {
  if (logoCache) return logoCache;
  const res = await fetch(`${baseUrl}/creco-letterhead-logo.png`);
  if (!res.ok) throw new Error(`letterhead ${res.status}`);
  logoCache = new Uint8Array(await res.arrayBuffer());
  return logoCache;
}

export interface GenerateAgent { name: string; email: string; phone: string; license: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateLoi(db: SupabaseClient<any, any, any>, userId: string, businessUnit: string | null, agent: GenerateAgent, input: GenerateInput): Promise<GenerateResult> {
  const draft = await buildLoiDraft(db, agent, {
    formId: input.formId, dealId: input.dealId ?? null, contactId: input.contactId ?? null,
    listingId: input.listingId ?? null, side: input.side ?? null, provided: input.provided ?? {},
  });
  if ('error' in draft) return { ok: false, status: 400, error: draft.error };

  // The gate. Nothing is rendered while a required blank is still a blank.
  const missing = missingRequired(draft);
  if (missing.length) {
    return { ok: false, status: 422, error: `Still missing: ${missing.map(m => m.label).join(', ')}`, missingRequired: missing };
  }
  if (draft.blocked && !input.acknowledgeDirection) {
    return { ok: false, status: 409, error: draft.blocked.reason, blocked: draft.blocked };
  }

  const { data: form } = await db.from('crm_forms').select('id, name, form_code, business_unit').eq('id', input.formId).maybeSingle();
  const spec = specForForm(form?.form_code, form?.name ?? '');
  if (!spec) return { ok: false, status: 400, error: 'That form is not a Letter of Intent.' };

  let pdfBytes: Uint8Array;
  let sigFields: unknown[];
  try {
    const exhibit = spec.exhibit
      ? await fetch(`${input.baseUrl}${spec.exhibit.imagePath}`).then(r => r.ok ? r.arrayBuffer() : null).then(b => b ? new Uint8Array(b) : undefined).catch(() => undefined)
      : undefined;
    const out = await renderLoi(draft.data, await letterhead(input.baseUrl), spec, exhibit);
    pdfBytes = out.pdfBytes; sigFields = out.sigFields;
  } catch (e) {
    console.error('[loi-generate] render', e);
    return { ok: false, status: 500, error: 'Could not build the document.' };
  }

  const path = `submissions/${input.formId}/${Date.now()}_${Math.round(Math.random() * 1e6)}.pdf`;
  const { error: upErr } = await db.storage.from('transaction-forms')
    .upload(path, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true });
  if (upErr) { console.error('[loi-generate] upload', upErr); return { ok: false, status: 500, error: 'Could not save the document.' }; }

  // Filed against whatever the agent actually has. With no deal and no contact it is
  // a standalone document, which the E-Sign page lists — so it is still somewhere they
  // can open, review and send from.
  const row = {
    form_id: input.formId, deal_id: draft.dealId, client_id: draft.contactId, listing_id: draft.listingId,
    business_unit: form?.business_unit ?? businessUnit ?? 'commercial',
    title: spec.title, values: sigFields, builder_data: draft.data,
    filled_path: path, status: 'saved', updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = input.submissionId
    ? await db.from('crm_form_submissions').update(row).eq('id', input.submissionId).select('id, title, filled_path, deal_id, client_id, listing_id, status').single()
    : await db.from('crm_form_submissions').insert({ ...row, created_by: userId }).select('id, title, filled_path, deal_id, client_id, listing_id, status').single();
  if (error) { console.error('[loi-generate] save', error); return { ok: false, status: 500, error: 'Could not file the document.' }; }

  const { data: signed } = await db.storage.from('transaction-forms').createSignedUrl(path, 60 * 60);
  return { ok: true, submission: saved as Record<string, unknown>, url: signed?.signedUrl ?? null, side: draft.side.side, filedOn: draft.filesOn.label, unmatchedProvided: draft.unmatchedProvided };
}


// ── Live edits to an existing LOI ────────────────────────────────────────────────
// The Copilot's edit_loi. The LOI's source of truth is builder_data (the term list and
// letter fields); the PDF is derived from it. So an edit changes builder_data, re-renders
// the SAME branded PDF the builder would, and refiles it — exactly what a Save in the
// builder does — and writes a line in the document's edit history.

export interface LoiEdit {
  /** Existing term label → new value (label matched case-insensitively, colon optional). */
  setTerms?: Record<string, string>;
  addTerms?: { label: string; value: string; after?: string }[];
  removeTerms?: string[];
  /** Letter-level fields. */
  fields?: Partial<Pick<LoiPurchaseData, 'loiDate' | 'addresseeName' | 'addresseeAddr1' | 'addresseeAddr2' | 'reLine' | 'additionalTerms' | 'intro' | 'subtitle' | 'agentName' | 'agentEmail' | 'agentPhone'>>;
  /** Acceptance blocks by position (0 = first). */
  sellers?: { entity?: string; signatory?: string }[];
}

const LETTER_FIELDS: (keyof NonNullable<LoiEdit['fields']>)[] = ['loiDate', 'addresseeName', 'addresseeAddr1', 'addresseeAddr2', 'reLine', 'additionalTerms', 'intro', 'subtitle', 'agentName', 'agentEmail', 'agentPhone'];
const normLabel = (s: string) => String(s ?? '').toLowerCase().replace(/[:\s]+/g, ' ').trim();

export type EditLoiResult =
  | { ok: true; submission: { id: string; title: string | null }; changes: string[]; unmatched: string[] }
  | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function editLoi(db: SupabaseClient<any, any, any>, userId: string, businessUnit: string | null, submissionId: string, edit: LoiEdit, baseUrl: string): Promise<EditLoiResult> {
  const { data: sub } = await db.from('crm_form_submissions')
    .select('id, title, form_id, status, builder_data, business_unit').eq('id', submissionId).maybeSingle();
  if (!sub) return { ok: false, error: 'Document not found' };
  if (businessUnit && sub.business_unit !== businessUnit) return { ok: false, error: 'Document is in a different workspace' };
  if (sub.status === 'executed' || sub.status === 'completed') return { ok: false, error: 'That letter is already executed — it can no longer be edited.' };
  const bd = sub.builder_data as LoiPurchaseData | null;
  if (!bd || !Array.isArray(bd.terms)) return { ok: false, error: 'That document is not a Letter of Intent built in the builder. For a form with fillable blanks, use fill_document instead.' };
  if (await liveEnvelope(db, submissionId)) return { ok: false, error: OUT_FOR_SIGNATURE };

  const next: LoiPurchaseData = { ...bd, terms: bd.terms.map(t => ({ ...t })), sellers: (bd.sellers ?? []).map(x => ({ ...x })) };
  const changes: string[] = [];
  const unmatched: string[] = [];
  const findTerm = (label: string) => {
    const k = normLabel(label);
    let i = next.terms.findIndex(t => normLabel(t.label) === k);
    if (i === -1) i = next.terms.findIndex(t => { const n = normLabel(t.label); return !!n && (n.includes(k) || k.includes(n)); });
    return i;
  };
  const clip = (v: string) => (v.length > 60 ? v.slice(0, 57) + '…' : v);

  for (const [label, value] of Object.entries(edit.setTerms ?? {})) {
    const i = findTerm(label);
    if (i === -1) { unmatched.push(label); continue; }
    if (next.terms[i].value === String(value)) continue;
    changes.push(`${next.terms[i].label.replace(/:$/, '')}: “${clip(next.terms[i].value)}” → “${clip(String(value))}”`);
    next.terms[i] = { ...next.terms[i], value: String(value) };
  }
  for (const label of edit.removeTerms ?? []) {
    const i = findTerm(label);
    if (i === -1) { unmatched.push(label); continue; }
    changes.push(`Removed “${next.terms[i].label.replace(/:$/, '')}”`);
    next.terms.splice(i, 1);
  }
  for (const t of edit.addTerms ?? []) {
    const label = String(t.label ?? '').trim();
    if (!label) continue;
    const row = { id: `t${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`, label: label.endsWith(':') ? label : `${label}:`, value: String(t.value ?? '') };
    const at = t.after ? findTerm(t.after) : -1;
    if (at === -1) next.terms.push(row); else next.terms.splice(at + 1, 0, row);
    changes.push(`Added “${row.label.replace(/:$/, '')}”: “${clip(row.value)}”`);
  }
  for (const k of LETTER_FIELDS) {
    const v = edit.fields?.[k];
    if (v === undefined) continue;
    const cur = String((next as unknown as Record<string, unknown>)[k] ?? '');
    if (cur === String(v)) continue;
    (next as unknown as Record<string, unknown>)[k] = String(v);
    changes.push(`${k}: “${clip(cur)}” → “${clip(String(v))}”`);
  }
  (edit.sellers ?? []).forEach((s, i) => {
    if (!s || i > 1) return;
    while (next.sellers.length <= i) next.sellers.push({ entity: '', signatory: '' });
    if (s.entity !== undefined && s.entity !== next.sellers[i].entity) { changes.push(`Signer ${i + 1} entity → “${clip(s.entity)}”`); next.sellers[i].entity = s.entity; }
    if (s.signatory !== undefined && s.signatory !== next.sellers[i].signatory) { changes.push(`Signer ${i + 1} signatory → “${clip(s.signatory)}”`); next.sellers[i].signatory = s.signatory; }
  });

  if (!changes.length) {
    return { ok: false, error: unmatched.length ? `No term on this letter matches: ${unmatched.join(', ')}. Read the document for the exact term labels.` : 'Nothing to change — the letter already says that.' };
  }
  if (!next.terms.some(t => t.value.trim() || t.label.trim())) return { ok: false, error: 'A letter needs at least one term.' };

  const { data: form } = await db.from('crm_forms').select('form_code, name').eq('id', sub.form_id).maybeSingle();
  const spec = next.variant === 'tenantrep' ? leaseSpec('tenantrep') : specForForm(form?.form_code, form?.name ?? '');
  if (!spec) return { ok: false, error: 'That form is not a Letter of Intent.' };

  let pdfBytes: Uint8Array; let sigFields: unknown[];
  try {
    const exhibit = spec.exhibit
      ? await fetch(`${baseUrl}${spec.exhibit.imagePath}`).then(r => r.ok ? r.arrayBuffer() : null).then(b => b ? new Uint8Array(b) : undefined).catch(() => undefined)
      : undefined;
    const out = await renderLoi(next, await letterhead(baseUrl), spec, exhibit);
    pdfBytes = out.pdfBytes; sigFields = out.sigFields;
  } catch (e) {
    console.error('[loi-edit] render', e);
    return { ok: false, error: 'Could not rebuild the letter.' };
  }
  const path = `submissions/${sub.form_id}/${Date.now()}_${Math.round(Math.random() * 1e6)}.pdf`;
  const { error: upErr } = await db.storage.from('transaction-forms').upload(path, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true });
  if (upErr) { console.error('[loi-edit] upload', upErr); return { ok: false, error: 'Could not save the rebuilt letter.' }; }
  const { data: saved, error } = await db.from('crm_form_submissions')
    .update({ builder_data: next, values: sigFields, filled_path: path, updated_at: new Date().toISOString() })
    .eq('id', submissionId).select('id, title').single();
  if (error) { console.error('[loi-edit] save', error); return { ok: false, error: 'Could not file the edited letter.' }; }
  await logDocEdit(db, { submissionId, editorId: userId, unit: sub.business_unit as string | null, summary: `Copilot: ${changes.slice(0, 4).join('; ')}${changes.length > 4 ? ` (+${changes.length - 4} more)` : ''}`, changes: { kind: 'copilot_edit_loi', changes } });
  return { ok: true, submission: { id: saved.id as string, title: (saved.title as string) ?? null }, changes, unmatched };
}
