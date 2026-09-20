import type { SupabaseClient } from '@supabase/supabase-js';
import { newApplicantTags } from '@/lib/recruiting';

export interface RecruitApplicant {
  name: string;
  email: string;
  phone?: string | null;
  license?: string | null;
  experience?: string | null;
  current_brokerage?: string | null;
  production?: string | null;
  message?: string | null;
  /** Where the application came from, e.g. "fairoaksrealtygroup.com/join". */
  sourceLabel: string;
  businessUnit: 'residential' | 'commercial';
}

/**
 * File an agent applicant in the CRM as a recruiting prospect.
 *
 * Recruiting lives on contacts, not on crm_deals: an agent we are hiring is
 * not a client transaction, and dropping them into the deal board would
 * distort pipeline value. The funnel is carried by tags — `Recruiting` plus
 * exactly one `Recruiting: <stage>` — which the contact editor can already
 * change, and each stage has a saved smart list.
 *
 * Never sends mail. The caller owns notifying the broker, and applicants are
 * deliberately not auto-replied to: Zack answers these himself.
 *
 * Returns the contact id, or null when the applicant already existed or the
 * insert failed. Recruiting capture must never break the form submission, so
 * every failure here is logged and swallowed.
 */
export async function createRecruitContact(
  supabase: SupabaseClient,
  a: RecruitApplicant,
): Promise<{ id: string | null; existed: boolean }> {
  try {
    // Owner: the broker. Prefer super_admin (Zack) over any other admin.
    const { data: owner } = await supabase
      .from('crm_profiles')
      .select('id')
      .eq('role', 'super_admin')
      .limit(1)
      .maybeSingle();
    const { data: fallback } = owner?.id
      ? { data: null }
      : await supabase.from('crm_profiles').select('id').in('role', ['admin', 'super_admin']).limit(1).maybeSingle();
    const agentId: string | null = owner?.id ?? fallback?.id ?? null;
    if (!agentId) {
      console.error('[recruiting] no admin profile found — cannot file applicant');
      return { id: null, existed: false };
    }

    // An applicant who already exists as a contact keeps their record; we add
    // the recruiting tags rather than creating a second row for the same person.
    const { data: existing } = await supabase
      .from('crm_clients')
      .select('id, tags')
      .eq('email', a.email)
      .maybeSingle();

    const tags = newApplicantTags(a.businessUnit);

    if (existing?.id) {
      const merged = [...new Set([...(existing.tags ?? []), ...tags])];
      await supabase.from('crm_clients').update({ tags: merged }).eq('id', existing.id);
      await logApplication(supabase, existing.id, agentId, a);
      return { id: existing.id, existed: true };
    }

    const parts = a.name.trim().split(/\s+/);
    const first_name = parts[0] ?? a.name;
    const last_name = parts.slice(1).join(' ');

    const { data: created, error } = await supabase
      .from('crm_clients')
      .insert([{
        first_name,
        last_name,
        email: a.email,
        phone: a.phone ?? '',
        // 'Agent' is the CRM's existing contact type for licensed people. The
        // Recruiting tag is what separates someone we are hiring from an
        // outside agent on the other side of a deal.
        type: 'Agent',
        business_unit: a.businessUnit,
        agent_id: agentId,
        lead_source: a.sourceLabel,
        prospect_status: 'Prospect',
        tags,
        notes: applicationNotes(a),
        unsubscribe_token: crypto.randomUUID().replace(/-/g, ''),
      }])
      .select('id')
      .single();

    if (error || !created) {
      console.error('[recruiting] crm_clients insert failed:', error?.message ?? error);
      return { id: null, existed: false };
    }

    await logApplication(supabase, created.id, agentId, a);
    return { id: created.id, existed: false };
  } catch (err) {
    console.error('[recruiting] capture exception:', err);
    return { id: null, existed: false };
  }
}

function applicationNotes(a: RecruitApplicant): string {
  return [
    `AGENT APPLICATION — ${a.sourceLabel}`,
    `Received: ${new Date().toISOString()}`,
    '',
    `TX license: ${a.license || '—'}`,
    `Experience: ${a.experience || '—'}`,
    `Current brokerage: ${a.current_brokerage || '—'}`,
    `Annual production: ${a.production || '—'}`,
    a.message ? `\nWhat they wrote:\n${a.message}` : '',
  ].filter(Boolean).join('\n');
}

async function logApplication(
  supabase: SupabaseClient,
  clientId: string,
  agentId: string,
  a: RecruitApplicant,
): Promise<void> {
  const { error } = await supabase.from('crm_activity').insert([{
    client_id: clientId,
    agent_id: agentId,
    type: 'email',
    notes: `Agent application received via ${a.sourceLabel}. No auto-reply was sent — needs a personal response from the broker.`,
  }]);
  if (error) console.error('[recruiting] activity log failed:', error.message);
}
