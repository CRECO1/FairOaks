import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCrmContext, isAdminRole, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { last10, toE164 } from '@/lib/phone';
import { matchContact } from '@/lib/voicebot';
import { backupFor, ownerFor, type Profile } from '@/lib/call-routing';
import { maybeAutoEnrollLead } from '@/lib/lead-autoenroll';

/**
 * POST /api/crm/calls/contact — put a caller on a contact card.
 *
 *   { call_id, contact_id }                       link the call to an existing contact
 *   { call_id, first_name, last_name, business_name, email, phone, type, outcome }
 *                                                  save the caller as a new contact
 *
 * Never makes a duplicate: a new contact whose number or email already belongs to
 * someone in the workspace links to that card instead. A new contact is owned by
 * the same rule as web leads (lib/call-routing ownerFor) with the other broker as
 * backup, and every other call from that number is linked too.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({}));
  if (!b.call_id) return NextResponse.json({ error: 'call_id required' }, { status: 400 });
  const db = adminClient();
  const { data: call } = await db.from('crm_call_log')
    .select('id, business_unit, source, direction, from_number, to_number, callback_number, contact_id, summary, intent, ai_meta, needs_follow_up, handled_at, follow_up_assignee')
    .eq('id', b.call_id).maybeSingle();
  if (!call || (!isAdminRole(ctx.role) && call.business_unit !== ctx.businessUnit)) return notFound('Call not found');
  const unit = call.business_unit as string;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const callNumber = call.callback_number || (call.direction === 'outbound' ? call.to_number : call.from_number);

  let contact: { id: string; first_name: string | null; last_name: string | null; business_name: string | null; type: string | null; agent_id: string | null } | null = null;
  let created = false;

  if (b.contact_id) {
    const { data } = await db.from('crm_clients').select('id, first_name, last_name, business_name, type, agent_id').eq('id', b.contact_id).eq('business_unit', unit).maybeSingle();
    if (!data) return notFound('Contact not found');
    contact = data;
  } else {
    const first = str(b.first_name), last = str(b.last_name), business = str(b.business_name), email = str(b.email)?.toLowerCase() ?? null;
    if (!first && !last && !business) return NextResponse.json({ error: 'A name or company is required.' }, { status: 400 });
    const phone = toE164(str(b.phone) ?? callNumber);

    // Already a contact? Link instead of duplicating.
    const byPhone = phone ? await matchContact(db, phone, unit) : null;
    if (byPhone) {
      contact = (await db.from('crm_clients').select('id, first_name, last_name, business_name, type, agent_id').eq('id', byPhone.id).maybeSingle()).data;
    } else if (email) {
      contact = (await db.from('crm_clients').select('id, first_name, last_name, business_name, type, agent_id').eq('business_unit', unit).ilike('email', email).limit(1).maybeSingle()).data;
    }

    if (!contact) {
      const { data: profileRows } = await db.from('crm_profiles').select('id, email, first_name, last_name, role');
      const profiles = (profileRows ?? []) as Profile[];
      const owner = ownerFor(call, null, profiles) ?? ctx.userId;
      const backup = backupFor(owner, profiles);
      const property = (call.ai_meta as Record<string, unknown> | null)?.property;
      const detail = [call.intent, property ? `Asked about: ${property}` : null, call.summary].filter(Boolean).join('\n');
      // Several crm_clients text columns are NOT NULL with '' defaults — only send what we have.
      const rec: Record<string, unknown> = {
        first_name: first ?? '', type: str(b.type) || 'Other', business_unit: unit,
        agent_id: owner, assigned_agent_ids: backup ? [backup] : [],
        lead_source: call.source === 'voicebot' ? 'Phone (voice bot)' : 'Phone call', channel: 'phone',
        unsubscribe_token: randomUUID(),
      };
      for (const [k, v] of Object.entries({ last_name: last, business_name: business, email, phone, notes: detail || null })) if (v) rec[k] = v;
      const { data, error } = await db.from('crm_clients').insert(rec).select('id, first_name, last_name, business_name, type, agent_id').single();
      if (error) return dbError('api/crm/calls/contact insert', error);
      contact = data;
      created = true;
    }
  }
  if (!contact) return NextResponse.json({ error: 'Could not save the contact' }, { status: 500 });

  // Link this call and every other unlinked call from the same number.
  const tail = last10(callNumber);
  await db.from('crm_call_log').update({ contact_id: contact.id, updated_at: new Date().toISOString() }).eq('id', call.id);
  if (tail.length === 10) {
    await db.from('crm_call_log').update({ contact_id: contact.id, updated_at: new Date().toISOString() })
      .eq('business_unit', unit).is('contact_id', null)
      .or(`from_number.like.%${tail},to_number.like.%${tail},callback_number.like.%${tail}`);
  }
  // An open call-back with no owner goes to the contact's agent.
  if (call.needs_follow_up && !call.handled_at && !call.follow_up_assignee && contact.agent_id) {
    await db.from('crm_call_log').update({ follow_up_assignee: contact.agent_id }).eq('id', call.id);
  }

  if (created) {
    await db.from('crm_activity').insert({
      client_id: contact.id, agent_id: ctx.userId, type: 'call', business_unit: unit,
      notes: `${call.direction === 'outbound' ? 'Outbound call' : 'Called in'}${call.summary ? `: ${String(call.summary).slice(0, 400)}` : ''}`,
    });
    // A new lead with an email gets the brand's welcome series (off unless LEAD_AUTOENROLL_UNITS names the unit).
    if (b.outcome === 'new_lead' && (unit === 'commercial' || unit === 'residential')) {
      try { await maybeAutoEnrollLead(db, { clientId: contact.id, agentId: contact.agent_id, businessUnit: unit }); } catch (e) { console.warn('[calls/contact] autoenroll', e); }
    }
  }

  const name = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.business_name || 'Contact';
  return NextResponse.json({ contact: { id: contact.id, name, type: contact.type, business_name: contact.business_name }, created });
}
