import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isSuperAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

/**
 * Agent activity feed — Copilot actions and account actions.
 *
 * SCOPE. The account OWNER (super_admin) alone sees every agent's activity and
 * can filter to one of them. Everyone else — including an `admin` — sees only
 * their own rows, and cannot reach anyone else's by passing an agent_id.
 *
 * Deliberately narrower than admin. This feed carries the owner's own export
 * activity and the anti-scrape alerts, so letting a broker-level admin read it
 * would hand them oversight of the owner rather than of their team. Reviewing
 * the team is the owner's job here; an admin gets their own trail like anyone
 * else. Enforced here rather than by hiding the control, so calling the endpoint
 * directly gets the same answer as using the app.
 *
 * WHAT IT SHOWS. Two sources, merged newest-first:
 *   - audit_logs — one row per recorded action. action='copilot_tool' is a Copilot
 *     tool call (reads included, plus ones that errored or are awaiting the
 *     agent's confirmation); the rest are account actions: export requests and
 *     refusals, approvals and denials, completed exports, password resets, and
 *     bulk-read alerts from the anti-scrape guard.
 *   - crm_activity type='copilot' — the older write-only Copilot trail, kept so
 *     earlier history doesn't vanish from the feed.
 *
 * Why the default widened: the feed used to filter to action='copilot_tool'
 * alone. Zack asked why he only ever saw his own name — the answer was that he
 * is the only person who has used the Copilot so far, AND the actions where
 * other agents DO appear (Brian's export request and its refusal) were being
 * filtered out. `?view=copilot` keeps the narrow Copilot-only feed.
 *
 * Tool CALLS only: chat text is never stored, and free-text arguments arrive
 * already reduced to field names and lengths by the assistant route.
 */
/**
 * Which actors a requester is allowed to see, BEFORE the owner-exclusion floor.
 *
 * `null` means "no restriction by actor" and is reachable only by the owner.
 * Everyone else gets an explicit list, which today is just themselves.
 *
 * FUTURE — a manager role. When one exists, this is the single place it hooks
 * in: return the manager's team ids here and the rest of the route needs no
 * change, because hiddenActorIds() is applied on top of whatever this returns.
 * A manager would therefore see their team MINUS the owner, automatically,
 * without anyone having to remember the rule.
 *
 * Rolling one out needs three things that do not exist yet, and none of them
 * should be faked in the meantime: 'manager' added to the crm_profiles role
 * CHECK constraint (today it permits only admin/agent/super_admin), a
 * manager→agents assignment (a manager_id column on crm_profiles, or a teams
 * table), and a decision on whether a manager sees peer managers. Until then
 * every non-owner is correctly confined to themselves.
 */
function visibleActorIds(ctx: { userId: string; role: string | null }): string[] | null {
  if (isSuperAdminRole(ctx.role)) return null;          // the owner sees everyone
  // if (isManagerRole(ctx.role)) return await teamOf(ctx.userId);   // ← future
  return [ctx.userId];                                   // everyone else: themselves
}

/**
 * The permanent floor: actor ids that must never appear in anyone else's feed.
 *
 * The owner's activity is visible to the owner alone — this carries their export
 * history and every anti-scrape alert. Keyed on whether the REQUESTER is that
 * person, never on the requester's role, so promoting someone to admin, manager
 * or anything invented later cannot widen it. Applied to the queries themselves,
 * so it holds for a direct API call exactly as it does in the app.
 *
 * Other super_admins are excluded too, should a second one ever exist: each
 * owner sees their own rows and no other owner's.
 */
async function hiddenActorIds(db: ReturnType<typeof adminClient>, requesterId: string): Promise<string[]> {
  const { data } = await db.from('crm_profiles').select('id').eq('role', 'super_admin');
  return (data ?? []).map(r => r.id as string).filter(id => id !== requesterId);
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const url = new URL(req.url);
  const isOwner = isSuperAdminRole(ctx.role);
  const copilotOnly = url.searchParams.get('view') === 'copilot';

  const db = adminClient();

  // Allowed set, then the floor subtracted from it.
  const allowed = visibleActorIds(ctx);
  const hidden = await hiddenActorIds(db, ctx.userId);
  const hiddenList = `(${hidden.join(',')})`;

  // A requester may narrow to one agent, but only within what they can already
  // see — asking for someone outside the allowed set gets their own rows, not a
  // refusal, so the endpoint never confirms whose activity exists.
  const requested = url.searchParams.get('agent_id');
  const agentFilter =
    allowed === null
      // Owner: may narrow to anyone, except a hidden actor (another owner).
      ? (requested && !hidden.includes(requested) ? requested : null)
      // Everyone else: narrowing is honoured only inside their allowed set;
      // anything else silently falls back to their own rows.
      : (requested && allowed.includes(requested) ? requested : allowed[0]);

  let q = db.from('crm_activity')
    .select('id, agent_id, notes, business_unit, created_at, client_id')
    .eq('type', 'copilot')
    .order('created_at', { ascending: false })
    .limit(300);
  if (agentFilter) q = q.eq('agent_id', agentFilter);
  if (hidden.length) q = q.not('agent_id', 'in', hiddenList);

  let tq = db.from('audit_logs')
    .select('id, actor_id, action, target_type, target_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (copilotOnly) tq = tq.eq('action', 'copilot_tool');
  if (hidden.length) tq = tq.not('actor_id', 'in', hiddenList);
  if (agentFilter) tq = tq.eq('actor_id', agentFilter);

  const [{ data, error }, { data: toolData, error: toolError }] = await Promise.all([q, tq]);
  if (error) { console.error('[copilot-activity]', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  if (toolError) console.error('[copilot-activity] tool log', toolError);

  const rows = data ?? [];
  const toolRows = toolData ?? [];
  const agentIds = [...new Set([...rows.map(r => r.agent_id), ...toolRows.map(r => r.actor_id)].filter(Boolean))] as string[];
  const clientIds = [...new Set([...rows.map(r => r.client_id), ...toolRows.map(r => (r.metadata as any)?.args?.contact_id)].filter(Boolean))] as string[];
  const [{ data: agents }, { data: clients }] = await Promise.all([
    agentIds.length ? db.from('crm_profiles').select('id, first_name, last_name').in('id', agentIds) : Promise.resolve({ data: [] as any[] }),
    clientIds.length ? db.from('crm_clients').select('id, first_name, last_name, business_name').in('id', clientIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const agentMap = Object.fromEntries((agents ?? []).map(a => [a.id, `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'Unknown']));
  const clientMap = Object.fromEntries((clients ?? []).map(c => [c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || '']));

  const merged = [
    ...toolRows.map(r => {
      const m = (r.metadata ?? {}) as Record<string, any>;
      const contactId = m.args?.contact_id as string | undefined;
      return {
        id: r.id,
        agent: r.actor_id ? (agentMap[r.actor_id] ?? 'Unknown') : 'Unknown',
        action: r.action === 'copilot_tool' ? describeTool(r.target_type, m) : describeAccountAction(r.action, m),
        kind: r.action === 'copilot_tool' ? 'copilot' : 'account',
        contact: contactId ? (clientMap[contactId] ?? '') : '',
        business_unit: (m.business_unit as string) ?? m.unit ?? null,
        when: r.created_at,
        tool: r.action === 'copilot_tool' ? r.target_type : r.action,
        outcome: m.outcome as string | undefined,
        write: !!m.write,
        ok: m.ok as boolean | undefined,
        error: m.error as string | undefined,
        args: m.args ?? {},
      };
    }),
    ...rows.map(r => ({
      id: r.id,
      agent: r.agent_id ? (agentMap[r.agent_id] ?? 'Unknown') : 'Unknown',
      action: (r.notes ?? '').replace(/^\[Copilot\]\s*/, ''),
      kind: 'copilot' as const,
      contact: r.client_id ? (clientMap[r.client_id] ?? '') : '',
      business_unit: r.business_unit,
      when: r.created_at,
      tool: undefined as string | undefined,
      outcome: undefined as string | undefined,
      write: true,
      ok: true as boolean | undefined,
      error: undefined as string | undefined,
      args: {} as Record<string, unknown>,
    })),
  ].sort((a, b) => String(b.when).localeCompare(String(a.when)));

  return NextResponse.json({
    rows: merged,
    agents: (agents ?? []).map(a => ({ id: a.id, name: `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() })),
  });
}

/** One readable line per tool call for the oversight feed. */
function describeTool(tool: string | null, m: Record<string, any>): string {
  const a = (m.args ?? {}) as Record<string, any>;
  const label: Record<string, string> = {
    search_contacts: 'Searched contacts', get_contact: 'Opened a contact', list_tasks: 'Listed tasks',
    list_deals: 'Listed deals', get_deal: 'Opened a deal', find_property: 'Searched properties',
    list_properties: 'Listed properties', get_property: 'Opened a property', list_forms: 'Listed form templates',
    read_document: 'Read a document', create_task: 'Created a task', complete_task: 'Completed a task',
    add_note: 'Added a note', update_deal_stage: 'Moved a deal stage', create_contact: 'Added a contact',
    update_contact: 'Updated a contact', create_property: 'Added a property', fill_document: 'Filled in a document',
    draft_campaign: 'Drafted a campaign', draft_lease: 'Drafted a lease', generate_lease: 'Generated a lease',
    start_form: 'Started a form', send_for_signature: 'Sent for e-signature', send_email: 'Sent an email',
    schedule_event: 'Scheduled an event',
  };
  const base = label[tool ?? ''] ?? `Ran ${tool ?? 'a tool'}`;
  const detail = a.query ? ` — "${a.query}"` : a.title ? ` — "${a.title}"` : a.name ? ` — "${a.name}"` : a.stage ? ` — ${a.stage}` : '';
  const state = m.outcome === 'queued_for_confirmation' ? ' (awaiting confirmation)'
    : m.ok === false ? ` (failed: ${m.error ?? 'error'})` : '';
  return `${base}${detail}${state}`;
}

/** One readable line for the non-Copilot actions recorded in audit_logs. */
function describeAccountAction(action: string | null, m: Record<string, any>): string {
  const who = m.requester ? ` — ${m.requester}` : '';
  const scope = m.scope_label ? ` (${m.scope_label})` : '';
  switch (action) {
    case 'export_requested':   return `Asked to export${scope}`;
    case 'export_approved':    return `Export approved${who}${scope}`;
    case 'export_denied':      return `Export denied${who}${scope}`;
    case 'export_blocked':     return `Export refused — ${m.reason === 'not_owner' ? 'not the account owner' : (m.status ?? 'no approval')}`;
    case 'export_contacts':    return `Exported ${m.count ?? '?'} record${m.count === 1 ? '' : 's'}${m.unit ? ` (${m.unit})` : ''}`;
    case 'bulk_read_detected': return `Unusual read volume — ${m.rows ?? m.rows_this_hour ?? '?'} records from ${m.resource ?? 'the CRM'}`;
    case 'invite_agent':       return 'Invited an agent';
    case 'delete_agent':       return 'Removed an agent';
    case 'reset_password':     return 'Reset a password';
    case 'update_profile':     return 'Updated a profile';
    case 'update_commission':  return 'Updated a commission';
    case 'delete_deal':        return 'Deleted a deal';
    default:                   return (action ?? 'activity').replace(/_/g, ' ');
  }
}
