import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * When a call to a contact is logged outside the Call Queue (the Calling Log's "log a call", a
 * call made from the phone and noted afterwards), the contact's open call task is still sitting
 * in the queue — so the next agent, or the same one tomorrow, calls them again. Eight tasks were
 * open for people already called that morning.
 *
 * The Call Queue's own outcome buttons complete the task and schedule the follow-up themselves;
 * this applies the same cadence to a call logged any other way:
 *   talked to them / wrong number → the task is done
 *   left a voicemail              → pushed out 2 days (the Call Queue's voicemail cadence)
 *   no answer                     → pushed out 1 day
 * Anything else (an inbound call, no result) is left alone.
 *
 * Tasks made within two minutes of the call are skipped: the Call Queue creates its follow-up task
 * just before it logs the call, and that follow-up must survive.
 */
const CENTRAL = 'America/Chicago';
const centralDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: CENTRAL });

export async function settleOpenCallTasks(
  db: SupabaseClient,
  opts: { contactId: string | null | undefined; unit?: string | null; result: string | null | undefined; callAt?: string | null; direction?: string | null },
): Promise<{ completed: number; rescheduled: number }> {
  const out = { completed: 0, rescheduled: 0 };
  try {
    const { contactId, result } = opts;
    if (!contactId || !result || (opts.direction && opts.direction !== 'outbound')) return out;
    const outcome = result === 'answered' || result === 'wrong_number' ? 'done'
      : result === 'left_voicemail' ? 'vm' : result === 'no_answer' ? 'na' : null;
    if (!outcome) return out;

    const nowMs = Date.now();
    const callMs = opts.callAt ? Date.parse(opts.callAt) : nowMs;
    // Only tasks that already existed two minutes BEFORE the call. The Call Queue writes its follow-up
    // a few seconds before it logs the call, so that follow-up is never mistaken for the one just worked.
    const cutoff = new Date(Math.min(Number.isFinite(callMs) ? callMs : nowMs, nowMs) - 120_000).toISOString();

    let q = db.from('crm_tasks').select('id, due_date, created_at')
      .eq('client_id', contactId).in('type', ['call', 'follow_up'])
      .is('completed_at', null).not('status', 'in', '(done,completed)')
      .lt('created_at', cutoff);
    if (opts.unit) q = q.eq('business_unit', opts.unit);
    const { data: tasks } = await q;
    if (!tasks?.length) return out;

    const nowIso = new Date().toISOString();
    if (outcome === 'done') {
      const { data } = await db.from('crm_tasks').update({ completed_at: nowIso, status: 'done', updated_at: nowIso })
        .in('id', tasks.map(t => t.id as string)).select('id');
      out.completed = data?.length ?? 0;
    } else {
      const next = centralDay((Number.isFinite(callMs) ? callMs : nowMs) + (outcome === 'vm' ? 2 : 1) * 86_400_000);
      for (const t of tasks) {
        if (t.due_date && String(t.due_date) >= next) continue;   // already scheduled later than that
        const { error } = await db.from('crm_tasks').update({ due_date: next, updated_at: nowIso }).eq('id', t.id as string);
        if (!error) out.rescheduled++;
      }
    }
  } catch (e) {
    console.error('[call-task-settle] failed (the call itself is logged):', e);
  }
  return out;
}
