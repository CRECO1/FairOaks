import type { SupabaseClient } from '@supabase/supabase-js';
import { assertOwnsResource, type CrmContext } from '@/lib/crm-auth';
import { UUID_RE, MAX_CONTACTS_PER_SAVE, changedContacts } from '@/lib/sheet-team-notes';

/**
 * Team notes typed in a live-feed sheet (Robert's / Brian's outreach emails, the Elkhorn trackers…) also land on the
 * contact's card.
 *
 * A feed sheet's first columns come from the CRM and are rewritten on every refresh; the columns the team adds to the right
 * of them ("Team notes") belong to the team and stay attached to the same CRM record (feedKeys). Until now those notes lived
 * only in the sheet, so the person's card never showed them. On each save we compare the team columns with the previous
 * save and write what changed to the card's Activity list: ONE note per contact per sheet, kept in step as it is edited
 * and removed when the cell is cleared. Only changes are mirrored (nothing is back-filled), and the editor must be able to
 * open the contact (same rule as opening the card).
 *
 * Best effort and idempotent: never throws, so a hiccup here can never fail the sheet's own save.
 */

export const noteLead = (sheetTitle: string) => `Team note · ${sheetTitle.replace(/\s+/g, ' ').trim().slice(0, 80)} — `;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

export async function mirrorSheetNotes(
  admin: SupabaseClient,
  a: { docId: string; title: string; bu: string; before: string | null | undefined; after: string; actorId: string; ctx: CrmContext },
): Promise<{ created: number; updated: number; removed: number }> {
  const res = { created: 0, updated: 0, removed: 0 };
  try {
    const changed = changedContacts(a.before, a.after).slice(0, MAX_CONTACTS_PER_SAVE);
    if (!changed.length) return res;
    const lead = noteLead(a.title);
    for (const { ref, text } of changed) {
      // Who is it? A contact id, or an email that matches exactly one contact in the editor's workspace.
      let clientId = '';
      if (UUID_RE.test(ref)) clientId = ref;
      else {
        const { data } = await admin.from('crm_clients').select('id').eq('business_unit', a.bu).ilike('email', likeEscape(ref)).limit(2);
        if (data?.length === 1) clientId = data[0].id as string;
      }
      if (!clientId) continue;
      if (!(await assertOwnsResource('crm_clients', clientId, a.ctx))) continue;   // same rule as opening the card

      // The card note belonging to THIS sheet: found by the sheet's id. Notes written before ids existed carry only the title text,
      // so (when there is no note for this id yet) one that starts with this sheet's lead and has no id is adopted — and tagged with the id from then on.
      const { data: byId } = await admin.from('crm_client_activities').select('id, note')
        .eq('client_id', clientId).eq('type', 'note').eq('sheet_doc_id', a.docId).limit(1);
      let mine = byId?.[0] as { id: string; note: string } | undefined;
      if (!mine) {
        const { data: legacy } = await admin.from('crm_client_activities').select('id, note')
          .eq('client_id', clientId).eq('type', 'note').is('sheet_doc_id', null).like('note', `${likeEscape(lead)}%`).order('created_at', { ascending: false }).limit(1);
        mine = legacy?.[0] as { id: string; note: string } | undefined;
      }
      if (!text) {
        if (mine) { await admin.from('crm_client_activities').delete().eq('id', mine.id); res.removed++; }
        continue;
      }
      const note = `${lead}${text}`;
      if (mine) {
        await admin.from('crm_client_activities').update({ ...(mine.note !== note ? { note } : {}), sheet_doc_id: a.docId }).eq('id', mine.id);
        if (mine.note !== note) res.updated++;
      } else {
        const { error } = await admin.from('crm_client_activities').insert({ client_id: clientId, agent_id: a.actorId, type: 'note', note, sheet_doc_id: a.docId });
        if (error) console.error('[sheet-note-mirror] insert failed:', error.message); else res.created++;
      }
    }
  } catch (e) {
    console.error('[sheet-note-mirror] failed (the sheet itself saved fine):', e);
  }
  return res;
}
