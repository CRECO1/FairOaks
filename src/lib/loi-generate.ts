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

export interface GenerateInput {
  formId: string;
  dealId?: string | null;
  listingId?: string | null;
  provided?: Record<string, string>;
  submissionId?: string | null;
  /** Deliberate override of the direction warning (a listing-side deal). */
  acknowledgeDirection?: boolean;
  /** Where to fetch the letterhead from. */
  baseUrl: string;
}

export type GenerateResult =
  | { ok: true; submission: Record<string, unknown>; url: string | null; side: string }
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
    formId: input.formId, dealId: input.dealId ?? null, listingId: input.listingId ?? null, provided: input.provided ?? {},
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
    const out = await renderLoi(draft.data, await letterhead(input.baseUrl), spec);
    pdfBytes = out.pdfBytes; sigFields = out.sigFields;
  } catch (e) {
    console.error('[loi-generate] render', e);
    return { ok: false, status: 500, error: 'Could not build the document.' };
  }

  const path = `submissions/${input.formId}/${Date.now()}_${Math.round(Math.random() * 1e6)}.pdf`;
  const { error: upErr } = await db.storage.from('transaction-forms')
    .upload(path, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true });
  if (upErr) { console.error('[loi-generate] upload', upErr); return { ok: false, status: 500, error: 'Could not save the document.' }; }

  const row = {
    form_id: input.formId, deal_id: input.dealId ?? null, listing_id: draft.listingId,
    business_unit: form?.business_unit ?? businessUnit ?? 'commercial',
    title: spec.title, values: sigFields, builder_data: draft.data,
    filled_path: path, status: 'saved', updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = input.submissionId
    ? await db.from('crm_form_submissions').update(row).eq('id', input.submissionId).select('id, title, filled_path, deal_id, listing_id, status').single()
    : await db.from('crm_form_submissions').insert({ ...row, created_by: userId }).select('id, title, filled_path, deal_id, listing_id, status').single();
  if (error) { console.error('[loi-generate] save', error); return { ok: false, status: 500, error: 'Could not file the document.' }; }

  const { data: signed } = await db.storage.from('transaction-forms').createSignedUrl(path, 60 * 60);
  return { ok: true, submission: saved as Record<string, unknown>, url: signed?.signedUrl ?? null, side: draft.side.side };
}
