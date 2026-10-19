import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { callerNumberOrNull, cleanEmail, matchContact, type LeadType } from '@/lib/voicebot';
import { backupFor, junkKind, ownerFor, type Profile } from '@/lib/call-routing';
import { toE164 } from '@/lib/phone';

/**
 * A phone lead becomes a contact the moment the call is understood, not when someone gets around
 * to pressing "Save as contact".
 *
 * Website, form and email leads were already contacts on arrival; phone leads stayed as rows in the
 * call log until an agent saved them — a named caller with a stated purpose (a lease inquiry, a
 * vendor asking for a call-back) was nowhere in Contacts, so no card, no history, no follow-up
 * trail. Called when the bot's end-of-call summary lands.
 *
 * Only for calls that are a real call-back: inbound, not spam/silent/wrong-number, flagged as needing
 * a follow-up or carrying a name. An existing contact (same number) is linked, never duplicated.
 */
export type PhoneLeadResult = { contactId: string; created: boolean } | null;

// What the bot learned about the caller → how the contact is filed (existing CRM types and tags).
const FILING: Record<LeadType, { type: string; tag: string | null }> = {
  prospective_tenant: { type: 'Tenant', tag: 'Prospective Tenant' }, buyer: { type: 'Buyer', tag: null },
  property_owner: { type: 'Landlord/Investor', tag: 'Property Owner' }, seller: { type: 'Seller', tag: null },
  broker: { type: 'Broker', tag: 'Broker/Agent' }, current_tenant: { type: 'Tenant', tag: null }, vendor: { type: 'Other', tag: null }, other: { type: 'Other', tag: null },
};

const splitName = (full: string) => {
  const parts = full.trim().replace(/\s+/g, ' ').split(' ');
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
};

/** Is this call a lead worth a contact card? Pure, so the rule can be checked against real calls. */
export function isPhoneLead(call: {
  direction?: string | null; source?: string | null; caller_name?: string | null; intent?: string | null;
  summary?: string | null; needs_follow_up?: boolean | null; contact_id?: string | null;
}): boolean {
  if (call.contact_id || call.direction !== 'inbound') return false;
  // Only calls the bot actually held a conversation on. A phone-system call's caller_name is a
  // caller-ID label ("HPI INC"), a hang-up has nothing to save: neither is a lead.
  if (call.source !== 'voicebot') return false;
  if (junkKind({ intent: call.intent ?? null, summary: call.summary ?? null })) return false;
  const name = String(call.caller_name ?? '').trim();
  const said = String(call.intent ?? '').trim();
  const saidNothing = !said || /\b(unknown|nothing|no (details|information|info)|silent|did not|didn't|hung up|hang[- ]?up)\b/i.test(said);
  // A name, or a stated purpose, is what makes a caller a lead.
  return !!name || (!saidNothing && !!call.needs_follow_up);
}

export async function ensureContactForCall(db: SupabaseClient, callId: string): Promise<PhoneLeadResult> {
  try {
    const { data: call } = await db.from('crm_call_log')
      .select('id, business_unit, source, direction, from_number, callback_number, caller_name, contact_id, intent, summary, needs_follow_up, follow_up_assignee, ai_meta')
      .eq('id', callId).maybeSingle();
    if (!call) return null;
    if (call.contact_id) return { contactId: call.contact_id as string, created: false };
    if (!isPhoneLead(call as never)) return null;
    const name = String(call.caller_name ?? '').trim();

    const unit = call.business_unit as string;
    // Never file a contact under one of OUR lines (a forwarded call can carry it as the caller ID).
    const number = toE164(await callerNumberOrNull(db, (call.callback_number as string | null) || (call.from_number as string | null)));
    if (!number) return null;

    const meta = (call.ai_meta as Record<string, unknown> | null) ?? {};
    const email = cleanEmail(meta.caller_email);

    // Same number as someone already in the book: link, don't duplicate. (And give them the email they just
    // dictated if their card has none.)
    const known = await matchContact(db, number, unit);
    if (known) {
      await db.from('crm_call_log').update({ contact_id: known.id, updated_at: new Date().toISOString() }).eq('id', call.id);
      if (email) await db.from('crm_clients').update({ email }).eq('id', known.id).or('email.is.null,email.eq.');
      return { contactId: known.id, created: false };
    }
    // Same email as someone already in the book (new phone number): link to them rather than make a twin.
    if (email) {
      const { data: byEmail } = await db.from('crm_clients').select('id').eq('business_unit', unit).ilike('email', email).limit(1).maybeSingle();
      if (byEmail) {
        await db.from('crm_call_log').update({ contact_id: byEmail.id, updated_at: new Date().toISOString() }).eq('id', call.id);
        return { contactId: byEmail.id as string, created: false };
      }
    }

    const { data: profileRows } = await db.from('crm_profiles').select('id, email, first_name, last_name, role');
    const profiles = (profileRows ?? []) as Profile[];
    // The contact belongs to whoever the call-back was routed to, so card and call-back agree.
    const owner = (call.follow_up_assignee as string | null) ?? ownerFor(call as never, null, profiles);
    const backup = backupFor(owner, profiles);
    const detail = [call.intent, meta.property ? `Asked about: ${meta.property}` : null, call.summary].filter(Boolean).join('\n');
    const { first, last } = splitName(name);

    const lt = (meta.lead_type as LeadType) in FILING ? (meta.lead_type as LeadType) : 'other';
    // The residential book only knows Buyer / Seller (and Agent): a renter or a homeowner maps onto those.
    const filing = unit === 'residential'
      ? ({ prospective_tenant: { type: 'Buyer', tag: 'Renter' }, buyer: { type: 'Buyer', tag: null }, property_owner: { type: 'Seller', tag: null }, seller: { type: 'Seller', tag: null },
          broker: { type: 'Agent', tag: 'Broker/Agent' }, current_tenant: { type: 'Buyer', tag: null }, vendor: { type: 'Other', tag: null }, other: { type: 'Other', tag: null } } as Record<LeadType, { type: string; tag: string | null }>)[lt]
      : FILING[lt];
    const rec: Record<string, unknown> = {
      first_name: first, type: filing.type, business_unit: unit,
      agent_id: owner, assigned_agent_ids: backup && backup !== owner ? [backup] : [],
      lead_source: call.source === 'voicebot' ? 'Phone (voice bot)' : 'Phone call', channel: 'phone',
      unsubscribe_token: randomUUID(), phone: number,
      tags: ['New Lead', ...(filing.tag ? [filing.tag] : []), ...(meta.hot ? ['Hot Lead'] : []), ...(meta.language === 'es' ? ['Spanish Speaker'] : [])],
    };
    if (email) rec.email = email;
    if (last) rec.last_name = last;
    if (detail) rec.notes = `📞 ${detail}`.slice(0, 2000);
    const { data: created, error } = await db.from('crm_clients').insert(rec).select('id').single();
    if (error || !created) { console.error('[phone-lead-contact] insert failed:', error?.message); return null; }

    // Link this call and every other unlinked call from the same number.
    const tail = number.replace(/\D/g, '').slice(-10);
    await db.from('crm_call_log').update({ contact_id: created.id, updated_at: new Date().toISOString() }).eq('id', call.id);
    if (tail.length === 10) {
      await db.from('crm_call_log').update({ contact_id: created.id, updated_at: new Date().toISOString() })
        .eq('business_unit', unit).is('contact_id', null)
        .or(`from_number.like.%${tail},to_number.like.%${tail},callback_number.like.%${tail}`);
    }
    await db.from('crm_activity').insert({
      client_id: created.id, agent_id: owner, type: 'call', business_unit: unit,
      notes: `Called in${call.summary ? `: ${String(call.summary).slice(0, 400)}` : ''}`,
    });
    return { contactId: created.id as string, created: true };
  } catch (e) {
    console.error('[phone-lead-contact] failed (the call itself is logged):', e);
    return null;
  }
}
