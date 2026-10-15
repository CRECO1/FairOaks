// Shared plumbing for the Copilot's live document edits (fill_document, edit_loi):
// "is this doc already out for signature?", "re-stamp the PDF after a values edit",
// and the who-changed-what history line the Edit History panel shows.
//
// Callers authorize BEFORE using these — they run on the service-role client.
import type { SupabaseClient } from '@supabase/supabase-js';
import { stampOverlay, type StampField } from '@/lib/overlay-stamp';

const BUCKET = 'transaction-forms';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

/** A live e-sign envelope on this document. Editing the source while it is out would
 *  leave signers looking at a different document than the CRM holds. */
export async function liveEnvelope(db: DB, submissionId: string): Promise<{ id: string; status: string } | null> {
  const { data } = await db.from('crm_envelopes').select('id, status')
    .eq('submission_id', submissionId).in('status', ['sent', 'in_progress']).is('archived_at', null).limit(1);
  return data?.[0] ?? null;
}

export const OUT_FOR_SIGNATURE = 'That document is currently out for e-signature. Editing it now would change what the signers see — void or finish the signature request first (E-Sign page), then I can edit it.';

export async function logDocEdit(db: DB, p: { submissionId: string; editorId: string; unit: string | null; summary: string; changes?: unknown }) {
  try {
    await db.from('crm_form_submission_edits').insert({
      submission_id: p.submissionId, editor_id: p.editorId, business_unit: p.unit ?? 'commercial',
      summary: p.summary.slice(0, 500), changes: p.changes ?? {},
    });
  } catch { /* history is best-effort */ }
}

/**
 * Re-stamp an overlay form's PDF from its saved values and point filled_path at it.
 * The editor stamps in the browser on Save; a values edit made from the server must do
 * the same or the PDF an agent sends for signature still shows the old text.
 */
export async function restampOverlay(db: DB, submissionId: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const { data: sub } = await db.from('crm_form_submissions').select('id, form_id, values, source_path').eq('id', submissionId).maybeSingle();
  if (!sub) return { ok: false, error: 'Document not found' };
  let blankPath: string | null = sub.source_path ?? null;
  if (sub.form_id) {
    const { data: form } = await db.from('crm_forms').select('storage_path').eq('id', sub.form_id).maybeSingle();
    blankPath = form?.storage_path ?? blankPath;
  }
  if (!blankPath) return { ok: false, error: 'No blank form PDF to stamp onto.' };
  const dl = await db.storage.from(BUCKET).download(blankPath);
  if (dl.error || !dl.data) return { ok: false, error: 'Could not load the blank form.' };
  let out: Uint8Array;
  try {
    out = await stampOverlay(new Uint8Array(await dl.data.arrayBuffer()), (Array.isArray(sub.values) ? sub.values : []) as StampField[]);
  } catch (e) {
    console.error('[doc-edit] stamp', e);
    return { ok: false, error: 'Could not rebuild the PDF.' };
  }
  const path = `submissions/${sub.form_id ?? 'imported'}/${Date.now()}_${Math.round(Math.random() * 1e6)}.pdf`;
  const up = await db.storage.from(BUCKET).upload(path, Buffer.from(out), { contentType: 'application/pdf', upsert: true });
  if (up.error) return { ok: false, error: 'Could not save the rebuilt PDF.' };
  const { error } = await db.from('crm_form_submissions').update({ filled_path: path, updated_at: new Date().toISOString() }).eq('id', submissionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}
