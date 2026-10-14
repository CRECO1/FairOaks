import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Put a call's note on the contact's card.
 *
 * The Calling Log and Call Queue store what an agent wrote about a call on crm_call_log.notes.
 * The contact card's Activity list reads crm_client_activities, so those notes were invisible
 * where an agent actually looks when they open the person. This writes ONE activity per call
 * (call_log_id is unique), keeps it in step if the note is edited, and adopts an entry the
 * Call Queue already logged for the same call instead of adding a second.
 *
 * Best effort and idempotent: never throws, safe to call on every save.
 */

/** System text that fills the notes box, not something a person wrote. */
const SYSTEM_NOTE = /^(internal call \(between our own|auto-closed:|not documented at the time)/i;
export const isSystemNote = (n: string) => SYSTEM_NOTE.test(n.trim());

const OUTCOME: Record<string, string> = { new_lead: 'New lead', client: 'Client', tenant: 'Tenant', vendor: 'Vendor', spam: 'Spam', personal: 'Personal', other: 'Other' };
const RESULT: Record<string, string> = { answered: 'Talked to them', left_voicemail: 'Left a voicemail', no_answer: 'No answer', wrong_number: 'Wrong number' };

interface CallRow {
  id: string; contact_id: string | null; direction: string | null; result: string | null; outcome: string | null;
  notes: string | null; started_at: string | null; handled_by: string | null; wrapped_by: string | null;
}

export function callNoteText(c: Pick<CallRow, 'direction' | 'result' | 'outcome' | 'notes'>): string {
  const dir = c.direction === 'outbound' ? 'Outbound call' : 'Inbound call';
  const how = (c.outcome && OUTCOME[c.outcome]) || (c.result && RESULT[c.result]) || null;
  return `${dir}${how ? ` · ${how}` : ''} — ${String(c.notes ?? '').trim().slice(0, 1000)}`;
}

export async function mirrorCallNote(db: SupabaseClient, callId: string, actorId?: string | null): Promise<'created' | 'updated' | 'adopted' | 'skipped'> {
  try {
    const { data } = await db.from('crm_call_log')
      .select('id, contact_id, direction, result, outcome, notes, started_at, handled_by, wrapped_by')
      .eq('id', callId).maybeSingle();
    const call = data as CallRow | null;
    const notes = (call?.notes ?? '').trim();
    if (!call || !call.contact_id || !notes || isSystemNote(notes)) return 'skipped';

    const text = callNoteText(call);
    const at = call.started_at ?? new Date().toISOString();
    const agent = actorId ?? call.wrapped_by ?? call.handled_by ?? null;

    // Already mirrored: keep it current.
    const { data: mine } = await db.from('crm_client_activities').select('id, note, client_id').eq('call_log_id', call.id).maybeSingle();
    if (mine) {
      if (mine.note === text && mine.client_id === call.contact_id) return 'skipped';
      await db.from('crm_client_activities').update({ note: text, client_id: call.contact_id }).eq('id', mine.id);
      return 'updated';
    }

    // The Call Queue may already have logged this call's note on the card — adopt it, don't double it.
    const from = new Date(Date.parse(at) - 15 * 60_000).toISOString();
    const to = new Date(Date.parse(at) + 6 * 3600_000).toISOString();
    const probe = notes.slice(0, 25);
    const { data: near } = await db.from('crm_client_activities').select('id, note')
      .eq('client_id', call.contact_id).in('type', ['call', 'note']).is('call_log_id', null).gte('created_at', from).lte('created_at', to);
    const twin = (near ?? []).find(r => String(r.note ?? '').includes(probe));
    if (twin) {
      await db.from('crm_client_activities').update({ call_log_id: call.id }).eq('id', twin.id);
      return 'adopted';
    }

    // A conversation (outbound, or an inbound we answered) is a call; a note on a call nobody picked
    // up stays a plain note, so it reads right on the card.
    const spoke = call.direction === 'outbound' || call.result === 'answered';
    const { error } = await db.from('crm_client_activities').insert({
      client_id: call.contact_id, agent_id: agent, type: spoke ? 'call' : 'note', note: text, call_log_id: call.id, created_at: at,
    });
    if (error) { console.error('[call-note-mirror] insert failed:', error.message); return 'skipped'; }
    return 'created';
  } catch (e) {
    console.error('[call-note-mirror] failed (the call itself is unaffected):', e);
    return 'skipped';
  }
}

/** Mirror every note-bearing call that is linked to this contact (used when a caller is attached to a card). */
export async function mirrorNotesForContact(db: SupabaseClient, contactId: string, actorId?: string | null): Promise<number> {
  const { data } = await db.from('crm_call_log').select('id').eq('contact_id', contactId).not('notes', 'is', null);
  let n = 0;
  for (const r of data ?? []) { const s = await mirrorCallNote(db, r.id as string, actorId); if (s === 'created' || s === 'adopted') n++; }
  return n;
}
