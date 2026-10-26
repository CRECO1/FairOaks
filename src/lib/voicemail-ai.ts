import type { SupabaseClient } from '@supabase/supabase-js';
import { callerNumberOrNull, flattenTranscript, loadSettings, matchContact, notifyCallSummary, summarizeCall, type Turn } from '@/lib/voicebot';
import { junkKind, tidyCallLog } from '@/lib/call-routing';
import { ensureContactForCall } from '@/lib/phone-lead-contact';
import { createLeadFollowUpTask } from '@/lib/lead-followup';
import { prettyPhone } from '@/lib/phone';

/**
 * Read the voicemails people leave on the office line.
 *
 * Calls the voice bot answers are summarized, matched to a contact and queued the moment they end.
 * A voicemail left on the Talkroute line was only ever logged: no summary, no contact, nothing but a
 * row in the call-back queue. Two voicemails from a buyer asking to see a house sat unreturned for
 * seven weeks that way (Sept 2026) — the transcript was there the whole time, nobody read it.
 *
 * For each voicemail with a transcript (Talkroute delivers it a few minutes after the message, so
 * this runs from the 15-minute sync, not from the webhook): the same AI summary the bot's calls get,
 * an owner and due time (tidyCallLog), a contact card (ensureContactForCall — voicemails count once
 * they are summarized), a same-day call task for the owner, and the internal "call-back waiting"
 * email to the agents. Spam / wrong-number voicemails are closed out like the bot's are.
 *
 * Idempotent: a row is done once it has a summary; a failed summary is retried a few times (an
 * out-of-credits or timed-out model must not turn into a hot loop) and then left alone for a human.
 * Only recent voicemails are touched, so switching this on can never flood the team with old mail.
 */
const MAX_ATTEMPTS = 3;

export interface VoicemailRunResult { seen: number; summarized: number; contacts: number; tasks: number; junk: number; failed: number }

export async function processVoicemails(
  db: SupabaseClient,
  opts: { sinceHours?: number; limit?: number; notify?: boolean } = {},
): Promise<VoicemailRunResult> {
  const out: VoicemailRunResult = { seen: 0, summarized: 0, contacts: 0, tasks: 0, junk: 0, failed: 0 };
  const since = new Date(Date.now() - (opts.sinceHours ?? 72) * 3_600_000).toISOString();
  const { data: rows, error } = await db.from('crm_call_log')
    .select('id, business_unit, from_number, caller_name, contact_id, started_at, duration_sec, transcript, ai_meta')
    .eq('source', 'talkroute').eq('kind', 'voicemail')
    .is('summary', null).is('handled_at', null).not('transcript', 'is', null)
    .gte('started_at', since).order('started_at', { ascending: true }).limit(40);
  if (error) throw new Error(`voicemail query: ${error.message}`);

  const todo = (rows ?? []).filter(r => {
    const meta = (r.ai_meta as Record<string, unknown> | null) ?? {};
    return String(r.transcript ?? '').trim().length >= 8 && Number(meta.voicemail_ai_attempts ?? 0) < MAX_ATTEMPTS;
  }).slice(0, opts.limit ?? 5);
  out.seen = todo.length;

  for (const row of todo) {
    try {
      const meta = ((row.ai_meta as Record<string, unknown> | null) ?? {});
      const unit = row.business_unit as string;
      const transcript = String(row.transcript).trim();
      const realFrom = await callerNumberOrNull(db, row.from_number as string | null);

      let contact: { id: string; name: string } | null = null;
      if (row.contact_id) {
        const { data: c } = await db.from('crm_clients').select('id, first_name, last_name, business_name').eq('id', row.contact_id).maybeSingle();
        if (c) contact = { id: c.id as string, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || (c.business_name as string) || 'Contact' };
      } else {
        const m = await matchContact(db, realFrom, unit);
        if (m) contact = { id: m.id, name: m.name };
      }

      const turns: Turn[] = [{ role: 'caller', text: transcript }];
      const s = await summarizeCall(turns, { callerNumber: realFrom, contact }, { voicemail: true });
      if (!s) {
        out.failed++;
        await db.from('crm_call_log').update({ ai_meta: { ...meta, voicemail_ai_attempts: Number(meta.voicemail_ai_attempts ?? 0) + 1 }, updated_at: new Date().toISOString() }).eq('id', row.id);
        continue;
      }

      const junk = !!junkKind({ intent: s.intent, summary: s.summary });
      const needsFollowUp = s.needs_follow_up && !junk;
      const patch: Record<string, unknown> = {
        summary: s.summary,
        intent: s.intent,
        callback_number: s.callback_number,
        needs_follow_up: needsFollowUp,
        ai_meta: {
          ...meta, voicemail_ai: true, spoken_name: s.caller_name, caller_id_name: row.caller_name ?? null,
          property: s.property, urgency: s.urgency, caller_email: s.caller_email, lead_type: s.lead_type, hot: s.hot, language: s.language,
          ...(s.callback_at ? { callback_at: s.callback_at } : {}),
        },
        updated_at: new Date().toISOString(),
      };
      // A name the caller SAID beats the Talkroute caller-ID label; the label is kept in ai_meta.caller_id_name.
      if (s.caller_name) patch.caller_name = s.caller_name;
      if (s.callback_at) patch.follow_up_due = s.callback_at;
      await db.from('crm_call_log').update(patch).eq('id', row.id);
      out.summarized++;

      // Owner + due time — and, for spam / wrong-number voicemails, tidyCallLog closes the row out, as it does for the bot's.
      try { await tidyCallLog(db, { callIds: [row.id as string], days: 90 }); } catch (e) { console.warn('[voicemail-ai] tidy', e); }
      if (junk) { out.junk++; continue; }
      const saved = await ensureContactForCall(db, row.id as string);
      if (saved?.created) out.contacts++;
      const { data: after } = await db.from('crm_call_log').select('contact_id, follow_up_assignee').eq('id', row.id).maybeSingle();
      const clientId = saved?.contactId ?? (after?.contact_id as string | null) ?? null;
      const assignee = (after?.follow_up_assignee as string | null) ?? null;
      if (!needsFollowUp) continue;

      // A same-day call task on the owner's list — the call-back queue alone is what let this slip before.
      // Tasks are stored under the commercial workspace (the one the dashboard lists), whichever line rang.
      if (clientId) {
        const who = s.caller_name || contact?.name || prettyPhone(s.callback_number || realFrom) || 'caller';
        const before = await db.from('crm_tasks').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
        await createLeadFollowUpTask(db, {
          clientId, name: who, phone: s.callback_number || realFrom, channel: 'voicemail', leadSite: 'the office phone line',
          source: 'Voicemail', businessUnit: 'commercial', ownerId: assignee,
          detail: [s.summary, s.property ? `Asked about: ${s.property}` : ''].filter(Boolean).join('\n'),
        });
        const afterTasks = await db.from('crm_tasks').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
        if ((afterTasks.count ?? 0) > (before.count ?? 0)) out.tasks++;
      }

      if (opts.notify !== false) {
        const settings = await loadSettings(db, unit);
        await notifyCallSummary(settings, {
          id: row.id as string, from_number: realFrom, caller_name: s.caller_name || (row.caller_name as string | null), contact,
          started_at: row.started_at as string, duration_sec: (row.duration_sec as number | null) ?? null, summary: `Voicemail — ${s.summary}`, intent: s.intent,
          callback_number: s.callback_number, property: s.property, urgency: s.urgency, transcript: flattenTranscript(turns).replace(/^Caller: /, ''),
          email: s.caller_email, lead_type: s.lead_type, hot: s.hot, language: s.language, callback_at: s.callback_at,
        });
      }
    } catch (e) {
      out.failed++;
      console.error('[voicemail-ai] failed for', row.id, e);
    }
  }
  return out;
}
