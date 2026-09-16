// Tool definitions + handlers for the CRM copilot. Each tool maps to a CRM operation and
// runs server-side as the signed-in agent, scoped to their business unit (super_admins,
// who have no unit, see everything). Read tools run automatically; WRITE_TOOLS mutate data
// and are gated behind an explicit confirmation in the API route.
import type Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AgentCtx { userId: string; role: string | null; businessUnit: string | null; }

function admin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
const DEAL_STAGES = ['Prospect', 'Active', 'LOI', 'In Contract', 'Closed', 'Lost'];

// Scope a query to the agent's business unit (a super_admin with no unit sees all).
function scoped<T>(q: T, ctx: AgentCtx): T {
  return ctx.businessUnit ? (q as any).eq('business_unit', ctx.businessUnit) : q;
}

export const WRITE_TOOLS = new Set(['create_task', 'complete_task', 'add_note', 'update_deal_stage']);

export const TOOLS: Anthropic.Tool[] = [
  { name: 'search_contacts', description: 'Search the CRM for contacts (people/companies) by name, email, or business name. Returns up to 10 matches with their id, name, type, and email.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Name, email, or business to search for' } }, required: ['query'] } },
  { name: 'get_contact', description: "Get a contact's full details — including type, tags, notes, contact info, and their deals — by contact id.",
    input_schema: { type: 'object', properties: { contact_id: { type: 'string' } }, required: ['contact_id'] } },
  { name: 'list_tasks', description: 'List tasks. Defaults to open tasks assigned to the current agent. Use scope="all" to include the whole team, status="completed" or "all" to change status filter.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'completed', 'all'] }, scope: { type: 'string', enum: ['mine', 'all'] } } } },
  { name: 'list_deals', description: 'List deals, newest first. Optionally filter by stage. Returns client, property, value, and stage.',
    input_schema: { type: 'object', properties: { stage: { type: 'string', enum: DEAL_STAGES }, scope: { type: 'string', enum: ['mine', 'all'] } } } },
  { name: 'get_deal', description: 'Get a deal\'s full details by id.',
    input_schema: { type: 'object', properties: { deal_id: { type: 'string' } }, required: ['deal_id'] } },
  { name: 'create_task', description: 'Create a task/reminder. WRITE — confirm the details with the agent first.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string' }, contact_id: { type: 'string' }, deal_id: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['title'] } },
  { name: 'complete_task', description: 'Mark a task complete by id. WRITE.',
    input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] } },
  { name: 'add_note', description: "Append a timestamped note to a contact's record. WRITE — confirm wording with the agent first.",
    input_schema: { type: 'object', properties: { contact_id: { type: 'string' }, note: { type: 'string' } }, required: ['contact_id', 'note'] } },
  { name: 'update_deal_stage', description: `Move a deal to a new stage (${DEAL_STAGES.join(', ')}). WRITE — confirm with the agent first.`,
    input_schema: { type: 'object', properties: { deal_id: { type: 'string' }, stage: { type: 'string', enum: DEAL_STAGES } }, required: ['deal_id', 'stage'] } },
];

const j = (o: unknown) => JSON.stringify(o);

export async function runTool(name: string, input: Record<string, any>, ctx: AgentCtx): Promise<string> {
  const db = admin();
  try {
    switch (name) {
      case 'search_contacts': {
        const term = `%${(input.query || '').replace(/[%_]/g, '')}%`;
        let q = db.from('crm_clients').select('id, first_name, last_name, business_name, email, type').or(`first_name.ilike.${term},last_name.ilike.${term},business_name.ilike.${term},email.ilike.${term}`).limit(10);
        q = scoped(q, ctx);
        const { data, error } = await q;
        if (error) return j({ error: error.message });
        return j((data ?? []).map(c => ({ id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name, business: c.business_name, email: c.email, type: c.type })));
      }
      case 'get_contact': {
        const { data: c } = await db.from('crm_clients').select('id, first_name, last_name, business_name, email, phone, cell_phone, type, tags, notes, lead_source, business_unit, lease_expiration_date').eq('id', input.contact_id).single();
        if (!c) return j({ error: 'Contact not found' });
        if (ctx.businessUnit && c.business_unit !== ctx.businessUnit) return j({ error: 'Contact is in a different workspace' });
        const { data: deals } = await db.from('crm_deals').select('id, property, value, stage, type').eq('client_id', input.contact_id).limit(10);
        return j({ ...c, deals: deals ?? [] });
      }
      case 'list_tasks': {
        const status = input.status ?? 'open';
        let q = db.from('crm_tasks').select('id, title, due_date, status, priority, client_id, deal_id, assigned_to').order('due_date', { ascending: true, nullsFirst: false }).limit(30);
        q = scoped(q, ctx);
        if (status !== 'all') q = q.eq('status', status === 'completed' ? 'completed' : 'open');
        if ((input.scope ?? 'mine') === 'mine') q = q.eq('assigned_to', ctx.userId);
        const { data, error } = await q;
        if (error) return j({ error: error.message });
        return j(data ?? []);
      }
      case 'list_deals': {
        let q = db.from('crm_deals').select('id, client, property, value, stage, type, last_touch').order('created_at', { ascending: false }).limit(30);
        q = scoped(q, ctx);
        if (input.stage) q = q.eq('stage', input.stage);
        if ((input.scope ?? 'all') === 'mine') q = q.eq('agent_id', ctx.userId);
        const { data, error } = await q;
        if (error) return j({ error: error.message });
        return j(data ?? []);
      }
      case 'get_deal': {
        const { data: d } = await db.from('crm_deals').select('*').eq('id', input.deal_id).single();
        if (!d) return j({ error: 'Deal not found' });
        if (ctx.businessUnit && d.business_unit !== ctx.businessUnit) return j({ error: 'Deal is in a different workspace' });
        return j(d);
      }
      case 'create_task': {
        const row: Record<string, any> = { title: input.title, status: 'open', created_by: ctx.userId, assigned_to: ctx.userId, agent_id: ctx.userId, business_unit: ctx.businessUnit ?? 'commercial' };
        if (input.due_date) row.due_date = input.due_date;
        if (input.notes) row.description = input.notes;
        if (input.contact_id) row.client_id = input.contact_id;
        if (input.deal_id) row.deal_id = input.deal_id;
        if (input.priority) row.priority = input.priority;
        const { data, error } = await db.from('crm_tasks').insert(row).select('id, title, due_date').single();
        if (error) return j({ error: error.message });
        return j({ ok: true, created: data });
      }
      case 'complete_task': {
        const { error } = await db.from('crm_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', input.task_id);
        return error ? j({ error: error.message }) : j({ ok: true });
      }
      case 'add_note': {
        const { data: c } = await db.from('crm_clients').select('notes').eq('id', input.contact_id).single();
        const stamp = new Date().toLocaleDateString('en-US');
        const merged = `${c?.notes ? c.notes + '\n\n' : ''}[${stamp}] ${input.note}`;
        const { error } = await db.from('crm_clients').update({ notes: merged }).eq('id', input.contact_id);
        return error ? j({ error: error.message }) : j({ ok: true });
      }
      case 'update_deal_stage': {
        if (!DEAL_STAGES.includes(input.stage)) return j({ error: `stage must be one of: ${DEAL_STAGES.join(', ')}` });
        const { error } = await db.from('crm_deals').update({ stage: input.stage, last_touch: new Date().toISOString().slice(0, 10) }).eq('id', input.deal_id);
        return error ? j({ error: error.message }) : j({ ok: true, stage: input.stage });
      }
      default:
        return j({ error: `Unknown tool: ${name}` });
    }
  } catch (e) {
    return j({ error: (e as Error).message });
  }
}

// A short human-readable summary of a proposed write, for the confirmation prompt.
export function describeWrite(name: string, input: Record<string, any>): string {
  switch (name) {
    case 'create_task': return `Create task “${input.title}”${input.due_date ? ` due ${input.due_date}` : ''}`;
    case 'complete_task': return `Mark task complete`;
    case 'add_note': return `Add a note to the contact: “${input.note}”`;
    case 'update_deal_stage': return `Move the deal to “${input.stage}”`;
    default: return name;
  }
}
