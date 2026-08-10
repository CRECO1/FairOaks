import { adminClient } from '@/lib/supabase-admin';

// Renewal outreach starts this many days before a lease expires when the contact
// doesn't specify its own lead time (lxp_follow_up_days). ~4 months.
export const DEFAULT_LEAD_DAYS = 120;

function todayISO() { return new Date().toISOString().slice(0, 10); }
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
