/**
 * Create a follow-up task the moment a real inbound lead lands.
 *
 * Speed-to-lead is the single biggest lever on conversion in residential and
 * commercial alike, and the failure mode is mundane: a lead arrives, the
 * notification email is read on a phone, and nothing anchors it to a day's
 * work. A task does.
 *
 * Every guard here exists because the alternative is worse than no task:
 *
 *  - TEST ROWS are skipped through the same lead_is_test() the dashboard uses,
 *    so a verification lead never puts a chore on Zack's list. Calling the RPC
 *    rather than re-implementing the pattern means the two cannot drift.
 *  - IMPORTED PROSPECT LISTS never reach here: only the inbound web/lead paths
 *    call this, and those are exactly the rows crm_lead_is_inbound recognises.
 *  - DUPLICATES are checked per contact, because several of these paths can
 *    fire for one person — the importer re-runs every 15 minutes, and a repeat
 *    enquiry from a known contact hits the same code.
 *  - FAILURE IS SWALLOWED. A task is a convenience; the lead is the asset. This
 *    never throws, so a task problem can never cost a lead or return an error
 *    to someone filling in a form.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * crm_tasks.type is constrained to 'call' | 'email' | 'follow_up'. Using the
 * existing 'follow_up' rather than widening the CHECK keeps these tasks
 * indistinguishable from a hand-made follow-up everywhere in the CRM UI — the
 * brief was to reuse the schema, not extend it.
 *
 * It also makes the duplicate check slightly broader in a useful way: if Zack
 * has already put a follow-up on a contact, a fresh enquiry from that same
 * person does not add a second one.
 */
export const LEAD_FOLLOWUP_TYPE = 'follow_up';

export interface LeadFollowUpInput {
  clientId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  channel?: string | null;
  leadSite?: string | null;
  campaign?: string | null;
  source?: string | null;
  businessUnit?: string | null;
  /** Message or search criteria — what they actually asked for. */
  detail?: string | null;
  /**
   * Who the call-back belongs to: the contact's owner (Zack for his own
   * listings, Brian for the rest). Falls back to the super_admin when unset.
   */
  ownerId?: string | null;
}

/** Today in US-Central, as a date string. A same-day SLA in the wrong timezone is not a SLA. */
function todayCentral(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createLeadFollowUpTask(db: SupabaseClient<any, any, any>, input: LeadFollowUpInput): Promise<void> {
  try {
    if (!input.clientId) return;

    // Same classifier as the dashboard — never re-implemented here.
    try {
      const { data: isTest } = await db.rpc('lead_is_test', {
        p_name: input.name ?? '',
        p_email: input.email ?? '',
      });
      if (isTest === true) {
        console.log(`[lead-followup] skipped test lead ${input.email ?? input.name}`);
        return;
      }
    } catch (e) {
      // If the classifier is unreachable, skip rather than risk a task for a
      // test row. A missed task is recoverable; a polluted task list erodes
      // trust in the list itself.
      console.error('[lead-followup] lead_is_test unavailable — skipping task', e);
      return;
    }

    const { data: existing } = await db
      .from('crm_tasks')
      .select('id')
      .eq('client_id', input.clientId)
      .eq('type', LEAD_FOLLOWUP_TYPE)
      .limit(1)
      .maybeSingle();
    if (existing?.id) return;

    const { data: owner } = input.ownerId
      ? await db.from('crm_profiles').select('id').eq('id', input.ownerId).maybeSingle()
      : await db.from('crm_profiles').select('id').eq('role', 'super_admin').limit(1).maybeSingle();
    if (!owner?.id) {
      console.error('[lead-followup] no owner to assign to — no task created');
      return;
    }

    const site = input.leadSite || 'the website';
    const channel = input.channel || 'web';
    const who = (input.name || input.email || 'New lead').trim();
    const title = `Call ${who} — ${channel} lead from ${site}`
      + (input.campaign ? ` (${input.campaign})` : '');

    const notes = [
      `🔔 New inbound lead — call within 15 minutes. If you can't reach them, log the attempt (or complete this task) so the lead-SLA reminder stops.`,
      input.email ? `Email: ${input.email}` : '',
      input.phone ? `Phone: ${input.phone}` : '',
      input.source ? `Source: ${input.source}` : '',
      input.leadSite ? `Site: ${input.leadSite}` : '',
      input.channel ? `Channel: ${input.channel}` : '',
      input.campaign ? `Campaign: ${input.campaign}` : '',
      input.detail ? `\n${input.detail}` : '',
    ].filter(Boolean).join('\n');

    const { error } = await db.from('crm_tasks').insert([{
      client_id: input.clientId,
      title: title.slice(0, 200),
      type: LEAD_FOLLOWUP_TYPE,
      notes,
      status: 'open',
      priority: 'high',            // speed-to-lead: this outranks routine work
      due_date: todayCentral(),    // same-day SLA
      agent_id: owner.id,
      assigned_to: owner.id,
      created_by: owner.id,
      business_unit: input.businessUnit || 'commercial',
    }]);
    if (error) {
      console.error('[lead-followup] task insert failed:', JSON.stringify(error));
      return;
    }
    console.log(`[lead-followup] task created for ${who} (${input.clientId})`);
  } catch (e) {
    // Never let this break lead creation.
    console.error('[lead-followup] unexpected failure (lead itself is unaffected):', e);
  }
}
