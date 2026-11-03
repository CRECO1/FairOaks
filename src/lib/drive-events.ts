import type { SupabaseClient } from '@supabase/supabase-js';

// The activity log of a My Drive document (crm_drive_doc_events): every change is recorded, best effort — logging must never fail the
// action it describes (and the table may not exist yet on an older database). Typing is saved every few seconds, so an editing session is
// ONE row: consecutive saves by the same person within EDIT_WINDOW_MS update that row (saves, characters before/after, last save time).

export type DocEventKind =
  | 'created' | 'edited' | 'renamed' | 'moved' | 'shared' | 'linked' | 'unlinked' | 'trashed' | 'restored'
  | 'version_saved' | 'version_restored' | 'commented' | 'deleted' | 'template_saved';

export interface DriveDocEvent {
  id: string; doc_id: string; actor_id: string | null; kind: DocEventKind; detail: Record<string, unknown>; created_at: string; updated_at: string;
}

export const EVENT_COLS = 'id,doc_id,actor_id,kind,detail,created_at,updated_at';
const EDIT_WINDOW_MS = 10 * 60_000;

export async function logDocEvent(
  admin: SupabaseClient,
  e: { docId: string; bu: string; actor: string | null; kind: DocEventKind; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    await admin.from('crm_drive_doc_events').insert({ doc_id: e.docId, business_unit: e.bu, actor_id: e.actor, kind: e.kind, detail: e.detail ?? {} });
  } catch (err) { console.error('[drive] event log', err); }
}

/** One editing session = one row: a save by the same person within 10 minutes of the last event extends it, anything else starts a new row. */
export async function logDocEdit(
  admin: SupabaseClient,
  e: { docId: string; bu: string; actor: string; charsBefore: number; charsAfter: number; wordsAfter: number },
): Promise<void> {
  try {
    const { data: last } = await admin.from('crm_drive_doc_events').select('id,actor_id,kind,detail,updated_at').eq('doc_id', e.docId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (last && last.kind === 'edited' && last.actor_id === e.actor && Date.now() - new Date(last.updated_at as string).getTime() < EDIT_WINDOW_MS) {
      const d = (last.detail ?? {}) as { saves?: number; chars_before?: number };
      await admin.from('crm_drive_doc_events').update({
        detail: { saves: (d.saves ?? 1) + 1, chars_before: d.chars_before ?? e.charsBefore, chars_after: e.charsAfter, words_after: e.wordsAfter }, updated_at: new Date().toISOString(),
      }).eq('id', last.id);
      return;
    }
    await admin.from('crm_drive_doc_events').insert({
      doc_id: e.docId, business_unit: e.bu, actor_id: e.actor, kind: 'edited', detail: { saves: 1, chars_before: e.charsBefore, chars_after: e.charsAfter, words_after: e.wordsAfter },
    });
  } catch (err) { console.error('[drive] edit log', err); }
}
