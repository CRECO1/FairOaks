// Tool definitions + handlers for the CRM copilot. Each tool maps to a CRM operation and
// runs server-side as the signed-in agent, scoped to their business unit (super_admins,
// who have no unit, see everything). Read tools run automatically; WRITE_TOOLS mutate data
// and are gated behind an explicit confirmation in the API route.
import type Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// token + origin let tools reuse the CRM's own HTTP endpoints (lease-draft, envelopes,
// form-submissions) as the agent, so the copilot goes through the exact same auth, RBAC
// and generation logic the manual UI does.
export interface AgentCtx { userId: string; role: string | null; businessUnit: string | null; token?: string; origin?: string; }

function admin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
const DEAL_STAGES = ['Prospect', 'Active', 'LOI', 'In Contract', 'Closed', 'Lost'];

// Call a CRM API route as the agent (same auth + RBAC as the UI).
async function crmFetch(ctx: AgentCtx, path: string, method: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${ctx.origin ?? 'https://www.fairoaksrealtygroup.com'}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}) }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Timestamped, agent-attributed audit trail for every action the copilot takes — the
// same crm_activity log the rest of the CRM writes to, so copilot moves are tracked
// exactly like every other agent movement.
async function logCopilot(db: SupabaseClient, ctx: AgentCtx, action: string, clientId?: string | null) {
  try {
    await db.from('crm_activity').insert({
      agent_id: ctx.userId, type: 'copilot', notes: `[Copilot] ${action}`,
      business_unit: ctx.businessUnit ?? 'commercial', ...(clientId ? { client_id: clientId } : {}),
    });
  } catch { /* audit is best-effort, never blocks the action */ }
}

// Scope a query to the agent's business unit (a super_admin with no unit sees all).
function scoped<T>(q: T, ctx: AgentCtx): T {
  return ctx.businessUnit ? (q as any).eq('business_unit', ctx.businessUnit) : q;
}

export const WRITE_TOOLS = new Set(['create_task', 'complete_task', 'add_note', 'update_deal_stage', 'generate_lease', 'start_form', 'send_for_signature', 'send_email', 'schedule_event']);

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

  // ── Leases, forms & e-sign (Layer 2) ──────────────────────────────────────
  { name: 'find_property', description: 'Find a property/listing by name or address. Returns id, name, address. Needed before drafting a lease (use the id as listing_id).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'list_forms', description: 'List the available transaction-doc form templates (leases, contracts, addenda, etc.) — name, form_code, category.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'draft_lease', description: "Draft lease values from a plain-English description of the deal, using the property's rent roll (e.g. '24 months for Acme in suite 3101, $808/mo, no deposit'). Returns proposed values + notes to review. This DRAFTS only — it creates nothing.",
    input_schema: { type: 'object', properties: { listing_id: { type: 'string', description: 'The property id from find_property' }, prompt: { type: 'string', description: 'The deal described in plain English' } }, required: ['listing_id', 'prompt'] } },
  { name: 'generate_lease', description: 'Generate and file the lease document from approved draft values (from draft_lease). WRITE — creates the lease PDF on the property/contact. Confirm the key terms with the agent first.',
    input_schema: { type: 'object', properties: { listing_id: { type: 'string' }, values: { type: 'object', description: 'The values object returned by draft_lease (tenant_name, suite, rent, dates, etc.)' } }, required: ['listing_id', 'values'] } },
  { name: 'start_form', description: 'Start a new blank form document from a template (form id from list_forms), optionally linked to a deal. WRITE — creates a document the agent then fills in the editor.',
    input_schema: { type: 'object', properties: { form_id: { type: 'string' }, deal_id: { type: 'string' } }, required: ['form_id'] } },
  { name: 'send_for_signature', description: 'Send an existing saved document (a lease/form submission with a saved PDF) out for e-signature to one or more signers. WRITE + OUTWARD — this emails real people. Confirm the document and every recipient with the agent first.',
    input_schema: { type: 'object', properties: { submission_id: { type: 'string' }, signers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' } }, required: ['name', 'email'] } }, message: { type: 'string' } }, required: ['submission_id', 'signers'] } },

  // ── Comms & scheduling (Layer 3) ──────────────────────────────────────────
  { name: 'send_email', description: "Send an email to a contact from the agent's own Gmail. Write the full email yourself (draft it in the chat first so the agent can see it). WRITE + OUTWARD — this emails a real person. Confirm the recipient, subject and body with the agent before sending.",
    input_schema: { type: 'object', properties: { contact_id: { type: 'string', description: 'The contact to email (their email is looked up)' }, subject: { type: 'string' }, body: { type: 'string', description: 'The complete email body — write it in full, no placeholders. Plain text or simple HTML.' } }, required: ['contact_id', 'subject', 'body'] } },
  { name: 'schedule_event', description: "Add an event to the agent's Google Calendar on a given date (all-day). WRITE. Optionally tie it to a contact.",
    input_schema: { type: 'object', properties: { title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string' }, contact_id: { type: 'string' } }, required: ['title', 'date'] } },
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
        await logCopilot(db, ctx, `Created task “${input.title}”${input.due_date ? ` (due ${input.due_date})` : ''}`, input.contact_id);
        return j({ ok: true, created: data });
      }
      case 'complete_task': {
        const { error } = await db.from('crm_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', input.task_id);
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, 'Completed a task');
        return j({ ok: true });
      }
      case 'add_note': {
        const { data: c } = await db.from('crm_clients').select('notes').eq('id', input.contact_id).single();
        const stamp = new Date().toLocaleDateString('en-US');
        const merged = `${c?.notes ? c.notes + '\n\n' : ''}[${stamp}] ${input.note}`;
        const { error } = await db.from('crm_clients').update({ notes: merged }).eq('id', input.contact_id);
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Added a note`, input.contact_id);
        return j({ ok: true });
      }
      case 'update_deal_stage': {
        if (!DEAL_STAGES.includes(input.stage)) return j({ error: `stage must be one of: ${DEAL_STAGES.join(', ')}` });
        const { data: deal } = await db.from('crm_deals').select('client_id').eq('id', input.deal_id).maybeSingle();
        const { error } = await db.from('crm_deals').update({ stage: input.stage, last_touch: new Date().toISOString().slice(0, 10) }).eq('id', input.deal_id);
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Moved a deal to “${input.stage}”`, deal?.client_id);
        return j({ ok: true, stage: input.stage });
      }

      // ── Layer 2: leases, forms & e-sign ────────────────────────────────────
      case 'find_property': {
        const term = `%${(input.query || '').replace(/[%_]/g, '')}%`;
        let q = db.from('crm_listings').select('id, name, address, city, state, type, status').or(`name.ilike.${term},address.ilike.${term}`).limit(10);
        q = scoped(q, ctx);
        const { data, error } = await q;
        return error ? j({ error: error.message }) : j(data ?? []);
      }
      case 'list_forms': {
        let q = db.from('crm_forms').select('id, name, form_code, category').order('category', { ascending: true }).limit(60);
        q = scoped(q, ctx);
        const { data, error } = await q;
        return error ? j({ error: error.message }) : j(data ?? []);
      }
      case 'draft_lease': {
        const r = await crmFetch(ctx, '/api/crm/lease-draft', 'POST', { listing_id: input.listing_id, prompt: input.prompt });
        if (!r.ok) return j({ error: r.data?.error || 'Could not draft the lease' });
        return j({ values: r.data.values, matched_suite: r.data.matched_suite, notes: r.data.notes });
      }
      case 'generate_lease': {
        const r = await crmFetch(ctx, '/api/crm/lease-draft', 'PUT', { listing_id: input.listing_id, values: input.values });
        if (!r.ok) return j({ error: r.data?.error || 'Could not generate the lease' });
        await logCopilot(db, ctx, `Generated lease document “${r.data.submission?.title ?? ''}”`, r.data.submission?.client_id);
        return j({ ok: true, submission: r.data.submission });
      }
      case 'start_form': {
        const { data: form } = await db.from('crm_forms').select('name').eq('id', input.form_id).single();
        const r = await crmFetch(ctx, '/api/crm/form-submissions', 'POST', { form_id: input.form_id, deal_id: input.deal_id ?? null, business_unit: ctx.businessUnit ?? 'commercial', title: form?.name ?? 'Form', values: [] });
        if (!r.ok) return j({ error: r.data?.error || 'Could not start the form' });
        await logCopilot(db, ctx, `Started form document “${form?.name ?? 'Form'}”`);
        return j({ ok: true, submission: r.data.submission ?? r.data });
      }
      case 'send_for_signature': {
        const signers = Array.isArray(input.signers) ? input.signers : [];
        const r = await crmFetch(ctx, '/api/crm/envelopes', 'POST', {
          submission_id: input.submission_id, message: input.message,
          signers: signers.map((s: any, i: number) => ({ signer_role: s.role || 'client', name: s.name, email: s.email, signing_order: i + 1 })),
        });
        if (!r.ok) return j({ error: r.data?.error || 'Could not send for signature' });
        await logCopilot(db, ctx, `Sent a document for e-signature to ${signers.map((s: any) => s.email).join(', ')}`);
        return j({ ok: true, sent: true, envelope: r.data });
      }

      // ── Layer 3: comms & scheduling ────────────────────────────────────────
      case 'send_email': {
        const { data: c } = await db.from('crm_clients').select('first_name, last_name, business_name, email, business_unit').eq('id', input.contact_id).single();
        if (!c) return j({ error: 'Contact not found' });
        if (!c.email) return j({ error: 'That contact has no email address on file.' });
        if (ctx.businessUnit && c.business_unit !== ctx.businessUnit) return j({ error: 'Contact is in a different workspace' });
        const { data: agent } = await db.from('crm_profiles').select('first_name, last_name').eq('id', ctx.userId).single();
        const agentName = `${agent?.first_name ?? ''} ${agent?.last_name ?? ''}`.trim();
        const r = await crmFetch(ctx, '/api/gmail/send', 'POST', { userId: ctx.userId, clientId: input.contact_id, to: c.email, subject: input.subject, body: input.body, agentName });
        if (!r.ok) return j({ error: r.data?.error || 'Could not send the email — the agent may need to connect Gmail in Settings.' });
        await logCopilot(db, ctx, `Emailed ${c.email} — “${input.subject}”`, input.contact_id);
        return j({ ok: true, sent: true, to: c.email });
      }
      case 'schedule_event': {
        let clientName: string | undefined;
        if (input.contact_id) {
          const { data: c } = await db.from('crm_clients').select('first_name, last_name, business_name').eq('id', input.contact_id).single();
          if (c) clientName = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || undefined;
        }
        const r = await crmFetch(ctx, '/api/calendar/create', 'POST', { title: input.title, due_date: input.date, notes: input.notes, client_name: clientName, userId: ctx.userId });
        if (!r.ok) return j({ error: r.data?.error || 'Could not create the event — the agent may need to connect Google Calendar in Settings.' });
        await logCopilot(db, ctx, `Scheduled “${input.title}” on ${input.date}`, input.contact_id);
        return j({ ok: true, scheduled: true, event: r.data });
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
    case 'generate_lease': return `Generate & file the lease${input.values?.tenant_name ? ` for ${input.values.tenant_name}${input.values.suite ? `, suite ${input.values.suite}` : ''}` : ''}`;
    case 'start_form': return `Start a new form document`;
    case 'send_for_signature': return `📧 Send for e-signature to ${(input.signers || []).map((s: any) => s.name || s.email).join(', ')} — this emails them the document`;
    case 'send_email': return `📧 Send the email “${input.subject}” from your Gmail — this emails the contact`;
    case 'schedule_event': return `📅 Add “${input.title}” to your calendar on ${input.date}`;
    default: return name;
  }
}
