// Extra work the crecotx.com site used to do itself with the CRM master key (its pushToCrm): find a returning contact by
// PHONE as well as email, record the lead on email_lead_imports (the Prospects view reads it), and open a "Prospect" deal.
// Now it asks the CRM to do it through /api/webhook/lead with `web_lead_sync: true`, so the public site needs no CRM database key.
// Nothing here runs unless the sender sets that flag; Zapier / Crexi / other senders are unaffected.
import type { SupabaseClient } from '@supabase/supabase-js';

export const WEB_SYNC_TYPES = ['Buyer', 'Seller', 'Tenant', 'Landlord/Investor', 'Agent', 'Broker', 'Other'];
const DEAL_TYPES = ['Buyer Purchase', 'Seller Listing', 'Tenant Lease', 'Landlord Listing'];
const DUPLICATE_DEAL_WINDOW_MS = 24 * 60 * 60 * 1000;

const s = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** The formats a US number may be stored in (PostgREST has no digits-only compare). */
export function phoneVariants(phone: string | null | undefined): string[] {
  let d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return d.length >= 7 ? [d] : [];
  const [a, b, c] = [d.slice(0, 3), d.slice(3, 6), d.slice(6)];
  return [d, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `+1${d}`, `1${d}`, `(${a})${b}-${c}`];
}

/** Returning contact matched by phone (used only when no email match was found). */
export async function findByPhone(supabase: SupabaseClient, phone: string | undefined) {
  const v = phoneVariants(phone);
  if (!v.length) return null;
  const { data } = await supabase.from('crm_clients')
    .select('id, tags, lead_source, channel, visitor_id, created_at, agent_id')
    .or(v.map(x => `phone.eq.${x}`).join(',')).limit(1);
  return data?.[0] ?? null;
}

/** email_lead_imports row + Prospect deal. Never throws: the contact is already saved. */
export async function syncProspectExtras(supabase: SupabaseClient, a: {
  body: Record<string, unknown>; clientId: string; agentId: string | null;
  firstName: string; lastName: string; email?: string; phone?: string; message: string; sourceLabel: string;
}): Promise<void> {
  const { body, clientId, firstName, lastName, email, phone } = a;
  try {
    const messageId = s(body.import_message_id, 200);
    if (messageId) {
      const { error } = await supabase.from('email_lead_imports').insert([{
        gmail_message_id: messageId, source: a.sourceLabel, business_unit: 'commercial', client_id: clientId,
        raw_subject: s(body.import_subject, 200) ?? a.sourceLabel,
        parsed_name: [firstName, lastName].filter(Boolean).join(' '), parsed_email: email ?? null, parsed_phone: phone || null,
        parsed_property: s(body.property_interest, 300), parsed_message: a.message.slice(0, 4000),
      }]);
      if (error && (error as { code?: string }).code !== '23505') console.error('[web-lead-sync] import insert failed:', error.message);
    }

    const dealType = typeof body.deal_type === 'string' && DEAL_TYPES.includes(body.deal_type) ? body.deal_type : null;
    if (!dealType) return;
    const { data: openDeal } = await supabase.from('crm_deals').select('id').eq('client_id', clientId)
      .not('stage', 'in', '("Closed","Lost")').limit(1).maybeSingle();
    if (openDeal) return;
    const filters = [email ? `client_email.eq.${email}` : '', ...phoneVariants(phone).map(v => `client_phone.eq.${v}`)].filter(Boolean);
    if (filters.length) {
      const since = new Date(Date.now() - DUPLICATE_DEAL_WINDOW_MS).toISOString();
      const { data: recent } = await supabase.from('crm_deals').select('id').eq('stage', 'Prospect').gte('created_at', since).or(filters.join(',')).limit(1);
      if (recent?.length) return;
    }
    let agentId = a.agentId;
    if (!agentId) {
      const { data: adm } = await supabase.from('crm_profiles').select('id').in('role', ['admin', 'super_admin']).limit(1).maybeSingle();
      agentId = adm?.id ?? null;
    }
    const { error: dealErr } = await supabase.from('crm_deals').insert([{
      client_id: clientId, client: [firstName, lastName].filter(Boolean).join(' ') || 'Web Lead',
      client_email: email ?? '', client_phone: phone || '', type: dealType, property: s(body.property_interest, 300) ?? '',
      value: 0, notes: a.message, agent_id: agentId, stage: 'Prospect',
      last_touch: new Date().toISOString().slice(0, 10), business_unit: 'commercial',
    }]);
    if (dealErr) console.error('[web-lead-sync] deal insert failed:', dealErr.message);
  } catch (e) {
    console.error('[web-lead-sync] threw:', e instanceof Error ? e.message : e);
  }
}
