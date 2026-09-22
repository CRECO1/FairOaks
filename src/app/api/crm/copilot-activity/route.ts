import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Super-admin-only oversight feed for the CRECO Copilot. Agents never see it.
//
// Two sources, merged newest-first:
//   - audit_logs action='copilot_tool' — one row per TOOL CALL, reads included, plus
//     the ones that errored or are still waiting on the agent's confirmation. This is
//     the complete record of what an agent had the copilot do.
//   - crm_activity type='copilot' — the older write-only trail, kept so history from
//     before per-tool logging existed doesn't disappear from the feed.
//
// Tool CALLS only: chat text is never stored, and free-text arguments arrive here
// already reduced to field names and lengths by the assistant route.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (ctx.role !== 'super_admin') return forbidden('Super admin only');

  const db = adminClient();
  const url = new URL(req.url);
  const agentFilter = url.searchParams.get('agent_id');

  let q = db.from('crm_activity')
    .select('id, agent_id, notes, business_unit, created_at, client_id')
    .eq('type', 'copilot')
    .order('created_at', { ascending: false })
    .limit(300);
  if (agentFilter) q = q.eq('agent_id', agentFilter);

  let tq = db.from('audit_logs')
    .select('id, actor_id, target_type, target_id, metadata, created_at')
    .eq('action', 'copilot_tool')
    .order('created_at', { ascending: false })
    .limit(300);
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
        action: describeTool(r.target_type, m),
        contact: contactId ? (clientMap[contactId] ?? '') : '',
        business_unit: (m.business_unit as string) ?? null,
        when: r.created_at,
        tool: r.target_type,
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
