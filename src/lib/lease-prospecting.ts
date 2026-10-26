import { adminClient } from '@/lib/supabase-admin';
import { chicagoToday } from '@/lib/chicago-time';

// Renewal outreach starts this many days before a lease expires when the contact
// doesn't specify its own lead time (lxp_follow_up_days). ~4 months.
export const DEFAULT_LEAD_DAYS = 120;

function todayISO() { return chicagoToday(); }
function shiftDays(dateStr: string, n: number) {
  const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface LeaseClient {
  id: string; first_name: string | null; last_name: string | null; business_name: string | null;
  type: string | null; agent_id: string | null;
  lease_expiration_date: string; lxp_follow_up_days: number | null; lxp_prospected_for: string | null;
}

const SELECT = 'id, first_name, last_name, business_name, type, agent_id, lease_expiration_date, lxp_follow_up_days, lxp_prospected_for';

/** All contacts in a unit that carry a lease expiration date, soonest first. */
export async function listLeaseClients(businessUnit: string): Promise<LeaseClient[]> {
  const { data } = await adminClient()
    .from('crm_clients')
    .select(SELECT)
    .eq('business_unit', businessUnit)
    .not('lease_expiration_date', 'is', null)
    .order('lease_expiration_date', { ascending: true });
  return (data ?? []) as LeaseClient[];
}

/** True when a lease has entered its renewal-outreach window (and hasn't long lapsed). */
export function inWindow(c: LeaseClient, today = todayISO()): boolean {
  const lead = typeof c.lxp_follow_up_days === 'number' && c.lxp_follow_up_days > 0 ? c.lxp_follow_up_days : DEFAULT_LEAD_DAYS;
  return today >= shiftDays(c.lease_expiration_date, -lead) && c.lease_expiration_date >= shiftDays(today, -30);
}

export interface LeaseProspectResult { created: number; clientIds: string[] }

/**
 * Create a "🔑 Lease renewal" call task (due today, so it lands in the Call Queue)
 * for each tenant that has entered its outreach window and hasn't been prospected
 * for the current lease term. Idempotent via crm_clients.lxp_prospected_for — a
 * renewal (new expiration date) naturally re-arms it.
 *
 * @param opts.clientIds  when given, create for exactly these contacts regardless of
 *                        the window (the per-row "add call" action); still deduped.
 * @param opts.assignTo   agent to own tasks whose contact has no agent_id (the caller).
 */
export async function runLeaseProspecting(
  businessUnit: string,
  opts: { clientIds?: string[]; assignTo?: string; commit?: boolean } = {},
): Promise<LeaseProspectResult> {
  const commit = opts.commit ?? true;
  const today = todayISO();
  const supabase = adminClient();

  let q = supabase.from('crm_clients').select(SELECT)
    .eq('business_unit', businessUnit)
    .not('lease_expiration_date', 'is', null);
  if (opts.clientIds?.length) q = q.in('id', opts.clientIds);
  const rows = ((await q).data ?? []) as LeaseClient[];

  const explicit = !!opts.clientIds?.length;
  const toCreate = rows.filter(c =>
    c.lease_expiration_date
    && c.lxp_prospected_for !== c.lease_expiration_date   // not already prospected this term
    && (explicit || inWindow(c, today)));

  if (!commit || toCreate.length === 0) return { created: 0, clientIds: toCreate.map(c => c.id) };

  const tasks = toCreate.map(c => {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.business_name || 'Tenant';
    const exp = new Date(c.lease_expiration_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return {
      client_id: c.id,
      agent_id: c.agent_id || opts.assignTo || null,
      created_by: opts.assignTo || c.agent_id || null,
      type: 'call',
      title: `🔑 Lease renewal — ${name} (expires ${exp})`,
      notes: `Lease expires ${c.lease_expiration_date}. Auto-created renewal outreach.`,
      due_date: today,
      status: 'open',
      business_unit: businessUnit,
    };
  });

  const { error } = await supabase.from('crm_tasks').insert(tasks);
  if (error) { console.error('[lease-prospecting] insert', error); return { created: 0, clientIds: [] }; }

  await Promise.all(toCreate.map(c =>
    supabase.from('crm_clients').update({ lxp_prospected_for: c.lease_expiration_date }).eq('id', c.id)));

  return { created: toCreate.length, clientIds: toCreate.map(c => c.id) };
}

/**
 * Renewal outreach for leases that live on the RENT ROLL.
 *
 * runLeaseProspecting only reads contacts' own lease_expiration_date, so a tenant who is on the rent roll but has no
 * contact — or a contact whose date was never filled in, or no longer matches the roll — never got a renewal task
 * (Vantage 130D, expiring in five weeks, had nothing). This covers those rows, once per lease term, via
 * crm_property_tenants.lxp_prospected_for. A row whose linked contact already carries the SAME expiration date is left to
 * the contact job, so nobody gets two tasks; backup/prospective tenants and leases marked renewed are skipped.
 */
export async function runRentRollProspecting(
  businessUnit: string,
  opts: { commit?: boolean } = {},
): Promise<{ created: number; rows: string[] }> {
  const commit = opts.commit ?? true;
  const today = todayISO();
  const supabase = adminClient();
  const { data } = await supabase.from('crm_property_tenants')
    .select('id, listing_id, suite, tenant_name, lease_expiration, lxp_prospected_for, renewal_status, contact_id, is_backup')
    .eq('business_unit', businessUnit)
    .not('lease_expiration', 'is', null)
    .gte('lease_expiration', shiftDays(today, -30))
    .lte('lease_expiration', shiftDays(today, DEFAULT_LEAD_DAYS));
  const rows = (data ?? []).filter(r =>
    !r.is_backup
    && r.lxp_prospected_for !== r.lease_expiration
    && String(r.tenant_name ?? '').trim() && !/^vacant$/i.test(String(r.tenant_name).trim())
    && !/renew/i.test(String(r.renewal_status ?? '')));
  if (!rows.length) return { created: 0, rows: [] };

  const contactIds = Array.from(new Set(rows.map(r => r.contact_id).filter(Boolean))) as string[];
  const contacts = new Map<string, { lease_expiration_date: string | null; agent_id: string | null }>();
  if (contactIds.length) {
    const { data: cs } = await supabase.from('crm_clients').select('id, lease_expiration_date, agent_id').in('id', contactIds);
    for (const c of cs ?? []) contacts.set(c.id as string, { lease_expiration_date: c.lease_expiration_date as string | null, agent_id: c.agent_id as string | null });
  }
  const todo = rows.filter(r => {
    const c = r.contact_id ? contacts.get(r.contact_id as string) : null;
    return !(c && c.lease_expiration_date && String(c.lease_expiration_date).slice(0, 10) === String(r.lease_expiration).slice(0, 10));
  });
  if (!todo.length) return { created: 0, rows: [] };

  const { data: ls } = await supabase.from('crm_listings').select('id, name, address, listing_agent_id').in('id', Array.from(new Set(todo.map(r => r.listing_id as string))));
  const listing = new Map((ls ?? []).map(l => [l.id as string, l]));
  const label = todo.map(r => `${r.tenant_name} (${r.suite ?? '?'})`);
  if (!commit) return { created: 0, rows: label };

  const tasks = todo.map(r => {
    const l = listing.get(r.listing_id as string);
    const c = r.contact_id ? contacts.get(r.contact_id as string) : null;
    const exp = new Date(String(r.lease_expiration).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const owner = (l?.listing_agent_id as string | null) ?? c?.agent_id ?? null;
    return {
      client_id: (r.contact_id as string | null) ?? null,
      agent_id: owner, assigned_to: owner, created_by: owner,
      type: 'call', priority: 'normal', status: 'open', business_unit: businessUnit,
      title: `🔑 Lease renewal — ${r.tenant_name}, ${l?.name || l?.address || 'property'}${r.suite ? ` suite ${r.suite}` : ''} (expires ${exp})`,
      notes: `Lease expires ${String(r.lease_expiration).slice(0, 10)} per the Rent Roll. Auto-created renewal outreach.`
        + (r.contact_id ? '' : ' There is no contact on this Rent Roll row — find who to call and add them as the suite Contact.'),
      due_date: today,
    };
  });
  const { error } = await supabase.from('crm_tasks').insert(tasks);
  if (error) { console.error('[lease-prospecting] rent-roll insert', error); return { created: 0, rows: [] }; }
  await Promise.all(todo.map(r => supabase.from('crm_property_tenants').update({ lxp_prospected_for: String(r.lease_expiration).slice(0, 10) }).eq('id', r.id as string)));
  return { created: todo.length, rows: label };
}
