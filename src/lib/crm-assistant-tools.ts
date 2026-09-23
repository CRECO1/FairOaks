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

// Guard a by-id WRITE: the service-role client bypasses RLS, so every direct mutation
// must confirm the target row lives in the agent's workspace. Returns an error string to
// return to the model, or null when the row is in-workspace (or the agent is unit-less).
async function outOfWorkspace(db: SupabaseClient, ctx: AgentCtx, table: string, id: string, label: string): Promise<string | null> {
  if (!ctx.businessUnit || !id) return null;
  const { data } = await db.from(table).select('business_unit').eq('id', id).maybeSingle();
  if (!data) return JSON.stringify({ error: `${label} not found` });
  if (data.business_unit !== ctx.businessUnit) return JSON.stringify({ error: `${label} is in a different workspace` });
  return null;
}

// Strip PostgREST filter metacharacters (commas and parens split .or() conditions; %/_ are
// LIKE wildcards) so a search term can't inject extra filter clauses.
const safeTerm = (v: unknown) => `%${String(v ?? '').replace(/[%_,()*]/g, ' ').trim()}%`;

// Typo-tolerant name matching without a DB extension: trigram (Dice) similarity, used as a
// fallback when the exact/substring search finds nothing so a misspelled or near name — the
// common case when an agent guesses a spelling — still surfaces. Kept in-process because
// PostgREST can't run pg_trgm and a workspace fits in a few paged reads (low thousands of rows).
function trigramSet(s: string): Set<string> {
  const t = ` ${String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}
function trigramSim(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = trigramSet(a), B = trigramSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// Columns the copilot may read off a listing. Deliberately excludes nothing sensitive
// on its own, but rent-roll/suite tables are NOT reachable from any copilot tool.
const LISTING_COLS = 'id, name, address, city, state, zip, type, status, asking_price, sq_ft, lot_size, zoning, business_unit, listing_agent_id, assigned_agent_ids, is_restricted, created_at';

// Mirrors assertCanAccessListing() in lib/listing-files-access: admins see the
// workspace; everyone else must additionally be the listing agent or an assigned
// agent on any listing flagged Restricted. The copilot runs on the service-role key,
// which bypasses RLS, so this check has to happen here or the Restricted flag would
// simply not apply to anything the copilot reads.
function canSeeListing(l: Record<string, any>, ctx: AgentCtx): boolean {
  if (isAdminCtx(ctx)) return true;
  if (!l.is_restricted) return true;
  const assigned = Array.isArray(l.assigned_agent_ids) && (l.assigned_agent_ids as string[]).includes(ctx.userId);
  return l.listing_agent_id === ctx.userId || assigned;
}
const isAdminCtx = (ctx: AgentCtx) => ctx.role === 'admin' || ctx.role === 'super_admin';
function visibleListings(rows: any[] | null, ctx: AgentCtx): any[] {
  return (rows ?? []).filter(l => canSeeListing(l, ctx)).map(({ is_restricted, listing_agent_id, assigned_agent_ids, ...rest }) => rest);
}

/* ── UI navigation ────────────────────────────────────────────────────────────
 * The copilot can move the agent around the CRM. This is the one tool family that
 * does NOT run server-side: there is nothing to query or mutate, only React state
 * to set in the browser, so the route intercepts these before runTool and hands the
 * directive back to the client instead of executing anything.
 *
 * Destinations are a CLOSED set mapping to the app's real state, because the app's
 * routing is not what a model would guess. "Property DB" is not a page — it is
 * page='properties' with propertiesTab='propertydb', and a setPage('propertydb')
 * would fail the VALID_PAGES guard and silently no-op while the copilot cheerfully
 * reported success. An open string parameter here produces exactly that failure.
 */
export interface NavTarget { page: string; tab?: string; label: string; adminOnly?: boolean }

export const NAV_DESTINATIONS: Record<string, NavTarget> = {
  dashboard:        { page: 'dashboard',        label: 'Dashboard' },
  deals:            { page: 'deals',            label: 'Deal Flow' },
  contacts:         { page: 'contacts',         label: 'Contacts' },
  tasks:            { page: 'tasks',            label: 'Tasks' },
  calendar:         { page: 'calendar',         label: 'Calendar' },
  campaigns:        { page: 'campaigns',        label: 'Marketing campaigns' },
  action_plans:     { page: 'action-plans',     label: 'Action Plans' },
  social:           { page: 'social',           label: 'Social' },
  transaction_docs: { page: 'transaction-docs', label: 'Transaction Docs' },
  esign:            { page: 'esign',            label: 'E-Sign' },
  calls:            { page: 'calls',            label: 'Calls' },
  activity:         { page: 'activity',         label: 'Activity' },
  // Properties is a page with sub-tabs; each needs both setters.
  properties:       { page: 'properties', tab: 'propertydb', label: 'Properties' },
  property_db:      { page: 'properties', tab: 'propertydb', label: 'Property DB' },
  listings:         { page: 'properties', tab: 'listings',   label: 'Listings' },
  floor_plan:       { page: 'properties', tab: 'floorplan',  label: 'Floor Plan' },
  matchmaker:       { page: 'properties', tab: 'matchmaker', label: 'Matchmaker' },
  // Admin-only areas. The pages already gate their own content on isAdmin, so this
  // is defence in depth rather than the only check — but it means an agent gets a
  // straight "that's broker-level" instead of being dropped on a blank screen.
  agents:           { page: 'agents',      label: 'Broker / Agents', adminOnly: true },
  commissions:      { page: 'commissions', label: 'Commissions',     adminOnly: true },
};

/** Tools handled in the browser, not by runTool. */
export const CLIENT_TOOLS = new Set(['open_page']);

/**
 * Resolve a requested destination for this agent. Returns the directive to send to
 * the client, or an error string for the model.
 */
export function resolveNav(dest: string, ctx: AgentCtx): { target: NavTarget } | { error: string } {
  const target = NAV_DESTINATIONS[dest];
  if (!target) return { error: `Unknown destination. Valid options: ${Object.keys(NAV_DESTINATIONS).join(', ')}` };
  if (target.adminOnly && !(ctx.role === 'admin' || ctx.role === 'super_admin')) {
    return { error: `${target.label} is broker-level — it isn't available on this account.` };
  }
  return { target };
}

export const WRITE_TOOLS = new Set(['create_task', 'complete_task', 'add_note', 'update_deal_stage', 'generate_lease', 'start_form', 'send_for_signature', 'send_email', 'schedule_event',
  'create_contact', 'update_contact', 'create_property', 'fill_document', 'draft_campaign']);

// Contact types the CRM actually uses — kept closed so the copilot can't invent one.
const CONTACT_TYPES = ['Tenant', 'Buyer', 'Seller', 'Landlord/Investor', 'Broker', 'Agent'];

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
  { name: 'find_property', description: "Find a property/listing in the CRM by name or address. Returns id, name, address, type, status, asking price and size. Listings are SEPARATE from deals — a property the brokerage is marketing (with an asking price) lives here, not in the deals pipeline, so search here too whenever the agent asks about a property, an address, or a dollar figure you couldn't find in deals. Also the first step before drafting a lease (use the id as listing_id).",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Property name or street address' } }, required: ['query'] } },
  { name: 'list_properties', description: 'List the properties/listings in the agent\'s workspace, newest first — id, name, address, type, status, asking price, size. Use this for "what listings/properties do I have", or to find one by price when you don\'t know its name.',
    input_schema: { type: 'object', properties: { status: { type: 'string', description: 'Optional status filter, e.g. "active"' } } } },
  { name: 'get_property', description: 'Get a property/listing\'s full details by id — including asking price, size, zoning, description and highlights.',
    input_schema: { type: 'object', properties: { listing_id: { type: 'string' } }, required: ['listing_id'] } },
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

  // ── Records & documents (Layer 4) ─────────────────────────────────────────
  { name: 'create_contact', description: `Add a new contact to the CRM. Search first with search_contacts so you don't create a duplicate. Type must be one of: ${CONTACT_TYPES.join(', ')}. WRITE — confirm the details with the agent first.`,
    input_schema: { type: 'object', properties: { first_name: { type: 'string' }, last_name: { type: 'string' }, business_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, cell_phone: { type: 'string' }, type: { type: 'string', enum: CONTACT_TYPES }, brokerage: { type: 'string' }, notes: { type: 'string' }, lead_source: { type: 'string' } }, required: ['type'] } },
  { name: 'update_contact', description: "Update an existing contact's details (name, business, email, phone, type, brokerage). Only the fields you pass are changed. To append to their notes use add_note instead. WRITE — confirm with the agent first.",
    input_schema: { type: 'object', properties: { contact_id: { type: 'string' }, first_name: { type: 'string' }, last_name: { type: 'string' }, business_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, cell_phone: { type: 'string' }, type: { type: 'string', enum: CONTACT_TYPES }, brokerage: { type: 'string' } }, required: ['contact_id'] } },
  { name: 'create_property', description: 'Add a property/listing to the CRM. Check find_property first so you don\'t duplicate one. WRITE — confirm the details with the agent first.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, zip: { type: 'string' }, type: { type: 'string', description: 'e.g. Industrial, Retail, Office, Land' }, status: { type: 'string', description: 'e.g. active, pending' }, asking_price: { type: 'number' }, sq_ft: { type: 'number' }, lot_size: { type: 'string' }, zoning: { type: 'string' }, description: { type: 'string' }, highlights: { type: 'string' } }, required: ['name'] } },
  { name: 'read_document', description: 'Read a saved contract/form document (a form submission) — its title, status and the field values currently filled in. Use before fill_document so you edit against what is actually there. Pass deal_id or listing_id to list the documents on that deal/property.',
    input_schema: { type: 'object', properties: { submission_id: { type: 'string' }, deal_id: { type: 'string' }, listing_id: { type: 'string' } } } },
  { name: 'fill_document', description: "Fill in or edit fields on a contract/form document — e.g. dropping a contact's name, company, email and phone into the right blanks. Pass only the fields you're setting; everything else is left alone. Read it with read_document first. WRITE — confirm with the agent first. This edits the draft only; it does not send or sign anything.",
    input_schema: { type: 'object', properties: { submission_id: { type: 'string' }, fields: { type: 'object', description: 'Field label or id → value, e.g. {"Tenant Name": "Acme LLC", "Email": "a@b.com"}' }, contact_id: { type: 'string', description: "Optional: pull this contact's name/company/email/phone in automatically, then apply `fields` on top." }, title: { type: 'string' } }, required: ['submission_id'] } },
  { name: 'open_page', description: `Switch the agent's CRM screen to a section — use it when they ask you to open, show, go to or pull up part of the app. It changes what is on their screen immediately; it does not read or change any data, so just call it. Destinations: ${Object.keys(NAV_DESTINATIONS).join(', ')}.`,
    input_schema: { type: 'object', properties: { destination: { type: 'string', enum: Object.keys(NAV_DESTINATIONS), description: 'Which section to open' } }, required: ['destination'] } },
  { name: 'draft_campaign', description: "Build a marketing campaign and save it as a DRAFT — name, subject and full email body. It is saved unsent and unscheduled; the agent reviews and sends it themselves from the Marketing tab. You cannot send campaigns. Write the real body, no placeholder text. WRITE — confirm with the agent first.",
    input_schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, email_subject: { type: 'string' }, email_body: { type: 'string', description: 'The complete email body — plain text or simple HTML. No placeholders.' } }, required: ['name', 'email_subject', 'email_body'] } },
];

const j = (o: unknown) => JSON.stringify(o);

/* ── contract/form field helpers ──────────────────────────────────────────────
 * crm_form_submissions.values is a flat overlay array of placed fields
 * ({ id, type, value, label, fieldKey }), the same shape the document editor
 * writes. A field that wraps across lines is stored as key_l0 / key_l1, so match
 * on the base key and fill the first line. Signature/initial/date placeholders are
 * stamped at signing and are never touched here.
 */
interface OverlayField { id?: string; type?: string; value?: string; label?: string; fieldKey?: string }

const drop = (v: unknown) => v === undefined || v === null || v === '';
const prune = (o: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => !drop(v)).map(([k, v]) => [k.toLowerCase(), String(v)]));

const typedField = (f: OverlayField) => !f.type || f.type === 'text' || f.type === 'check';
const fieldName = (f: OverlayField): string =>
  (f.label || (f.fieldKey || '').replace(/_l\d+$/, '') || '').replace(/\s*[:#]$/, '').trim();
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** What's on a document right now, for read_document. */
function summarizeFields(values: unknown): { name: string; value: string }[] {
  const list = Array.isArray(values) ? (values as OverlayField[]) : [];
  const seen = new Set<string>();
  const out: { name: string; value: string }[] = [];
  for (const f of list) {
    if (!typedField(f)) continue;
    const name = fieldName(f);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, value: (f.value ?? '').trim() });
  }
  return out.slice(0, 80);
}

/**
 * Apply `wanted` (normalised field name → value) to the overlay, returning a new
 * array plus what matched and what didn't. Exact name match first, then a
 * contains match, so "Tenant Name" is reachable as "tenant". Each target field is
 * written at most once.
 */
function applyFields(values: unknown, wanted: Record<string, string>)
  : { values: OverlayField[]; applied: string[]; unmatched: string[] } {
  const list: OverlayField[] = Array.isArray(values) ? (values as OverlayField[]).map(f => ({ ...f })) : [];
  const applied: string[] = [], unmatched: string[] = [];
  const used = new Set<number>();

  for (const [rawKey, val] of Object.entries(wanted)) {
    const key = normName(rawKey);
    let idx = list.findIndex((f, i) => !used.has(i) && typedField(f) && normName(fieldName(f)) === key);
    if (idx === -1) {
      idx = list.findIndex((f, i) => {
        if (used.has(i) || !typedField(f)) return false;
        const n = normName(fieldName(f));
        return !!n && (n.includes(key) || key.includes(n));
      });
    }
    if (idx === -1) { unmatched.push(rawKey); continue; }
    used.add(idx);
    list[idx].value = val;
    applied.push(`${fieldName(list[idx])} = ${val}`);
  }
  return { values: list, applied, unmatched };
}


export async function runTool(name: string, input: Record<string, any>, ctx: AgentCtx): Promise<string> {
  const db = admin();
  try {
    switch (name) {
      case 'search_contacts': {
        // Split the query on whitespace and require every token to appear in some searchable
        // field: OR across fields, AND across tokens (chained .or() calls are ANDed by
        // PostgREST). Without this a natural "First Last" query can't match a row whose name is
        // split across first_name/last_name — e.g. %Chris Maxwell% matches neither column, so
        // the contact looks missing even though searching just "Maxwell" would find it.
        const tokens = String(input.query ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
        let q = db.from('crm_clients').select('id, first_name, last_name, business_name, email, type').limit(10);
        for (const tok of (tokens.length ? tokens : [''])) {
          const t = safeTerm(tok);
          q = q.or(`first_name.ilike.${t},last_name.ilike.${t},business_name.ilike.${t},email.ilike.${t}`);
        }
        q = scoped(q, ctx);
        if (ctx.role === 'agent') q = q.or(`agent_id.eq.${ctx.userId},assigned_agent_ids.cs.{${ctx.userId}}`); // agents: own contacts only
        const { data, error } = await q;
        if (error) return j({ error: error.message });

        let rows: Array<Record<string, any>> = data ?? [];
        // Typo rescue: when the exact/substring search finds nothing, fall back to fuzzy
        // trigram matching over the (paged) workspace so a misspelled or near name still
        // surfaces — the model can then confirm "did you mean…". Only fires on a miss, so a
        // correctly spelled search is unaffected.
        const raw = String(input.query ?? '').trim();
        if (rows.length === 0 && raw.length >= 3) {
          const cand: Array<Record<string, any>> = [];
          for (let page = 0; page < 4; page++) { // PostgREST caps a page at 1000 rows
            let cq = db.from('crm_clients').select('id, first_name, last_name, business_name, email, type').order('created_at', { ascending: false }).range(page * 1000, page * 1000 + 999);
            cq = scoped(cq, ctx);
            if (ctx.role === 'agent') cq = cq.or(`agent_id.eq.${ctx.userId},assigned_agent_ids.cs.{${ctx.userId}}`);
            const { data: pageData } = await cq;
            if (!pageData?.length) break;
            cand.push(...pageData);
            if (pageData.length < 1000) break;
          }
          rows = cand
            .map(c => ({
              c,
              score: Math.max(
                trigramSim(raw, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()),
                trigramSim(raw, `${c.last_name ?? ''} ${c.first_name ?? ''}`.trim()),
                trigramSim(raw, c.first_name ?? ''),
                trigramSim(raw, c.last_name ?? ''),
                trigramSim(raw, c.business_name ?? ''),
                trigramSim(raw, String(c.email ?? '').split('@')[0]),
              ),
            }))
            .filter(x => x.score >= 0.34)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
            .map(x => x.c);
        }
        return j(rows.map(c => ({ id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name, business: c.business_name, email: c.email, type: c.type })));
      }
      case 'get_contact': {
        const { data: c } = await db.from('crm_clients').select('id, first_name, last_name, business_name, email, phone, cell_phone, type, tags, notes, lead_source, business_unit, lease_expiration_date, agent_id, assigned_agent_ids').eq('id', input.contact_id).single();
        if (!c) return j({ error: 'Contact not found' });
        if (ctx.businessUnit && c.business_unit !== ctx.businessUnit) return j({ error: 'Contact is in a different workspace' });
        if (ctx.role === 'agent' && c.agent_id !== ctx.userId && !((c.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId)) return j({ error: "That contact isn't assigned to you" });
        const { data: deals } = await db.from('crm_deals').select('id, property, value, stage, type').eq('client_id', input.contact_id).limit(10);
        return j({ ...c, deals: deals ?? [] });
      }
      case 'list_tasks': {
        const status = input.status ?? 'open';
        let q = db.from('crm_tasks').select('id, title, due_date, status, priority, client_id, deal_id, assigned_to').order('due_date', { ascending: true, nullsFirst: false }).limit(30);
        q = scoped(q, ctx);
        if (status !== 'all') q = q.eq('status', status === 'completed' ? 'completed' : 'open');
        // Agents see only their own tasks; admins can widen with scope="all".
        if (ctx.role === 'agent') q = q.or(`assigned_to.eq.${ctx.userId},agent_id.eq.${ctx.userId}`);
        else if ((input.scope ?? 'mine') === 'mine') q = q.eq('assigned_to', ctx.userId);
        const { data, error } = await q;
        if (error) return j({ error: error.message });
        return j(data ?? []);
      }
      case 'list_deals': {
        let q = db.from('crm_deals').select('id, client, property, value, stage, type, last_touch').order('created_at', { ascending: false }).limit(30);
        q = scoped(q, ctx);
        if (input.stage) q = q.eq('stage', input.stage);
        // Agents see only deals they own/are assigned to; admins see the workspace.
        if (ctx.role === 'agent') q = q.or(`agent_id.eq.${ctx.userId},assigned_agent_ids.cs.{${ctx.userId}}`);
        else if (input.scope === 'mine') q = q.eq('agent_id', ctx.userId);
        const { data, error } = await q;
        if (error) return j({ error: error.message });
        return j(data ?? []);
      }
      case 'get_deal': {
        const { data: d } = await db.from('crm_deals').select('*').eq('id', input.deal_id).single();
        if (!d) return j({ error: 'Deal not found' });
        if (ctx.businessUnit && d.business_unit !== ctx.businessUnit) return j({ error: 'Deal is in a different workspace' });
        if (ctx.role === 'agent' && d.agent_id !== ctx.userId && !((d.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId)) return j({ error: "That deal isn't assigned to you" });
        return j(d);
      }
      case 'create_task': {
        // Don't let a task link to a contact/deal in another workspace.
        if (input.contact_id) { const bad = await outOfWorkspace(db, ctx, 'crm_clients', input.contact_id, 'Contact'); if (bad) return bad; }
        if (input.deal_id) { const bad = await outOfWorkspace(db, ctx, 'crm_deals', input.deal_id, 'Deal'); if (bad) return bad; }
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
        const bad = await outOfWorkspace(db, ctx, 'crm_tasks', input.task_id, 'Task'); if (bad) return bad;
        const { error } = await db.from('crm_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', input.task_id);
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, 'Completed a task');
        return j({ ok: true });
      }
      case 'add_note': {
        const { data: c } = await db.from('crm_clients').select('notes, business_unit').eq('id', input.contact_id).single();
        if (!c) return j({ error: 'Contact not found' });
        if (ctx.businessUnit && c.business_unit !== ctx.businessUnit) return j({ error: 'Contact is in a different workspace' });
        const stamp = new Date().toLocaleDateString('en-US');
        const merged = `${c?.notes ? c.notes + '\n\n' : ''}[${stamp}] ${input.note}`;
        const { error } = await db.from('crm_clients').update({ notes: merged }).eq('id', input.contact_id);
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Added a note`, input.contact_id);
        return j({ ok: true });
      }
      case 'update_deal_stage': {
        if (!DEAL_STAGES.includes(input.stage)) return j({ error: `stage must be one of: ${DEAL_STAGES.join(', ')}` });
        const { data: deal } = await db.from('crm_deals').select('client_id, business_unit').eq('id', input.deal_id).maybeSingle();
        if (!deal) return j({ error: 'Deal not found' });
        if (ctx.businessUnit && deal.business_unit !== ctx.businessUnit) return j({ error: 'That deal is in a different workspace' });
        const { error } = await db.from('crm_deals').update({ stage: input.stage, last_touch: new Date().toISOString().slice(0, 10) }).eq('id', input.deal_id);
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Moved a deal to “${input.stage}”`, deal?.client_id);
        return j({ ok: true, stage: input.stage });
      }

      // ── Layer 2: leases, forms & e-sign ────────────────────────────────────
      case 'find_property': {
        // Same whitespace-tokenised match as search_contacts: every token must appear in the
        // name or address, so "1742 Paradise Parkway" matches regardless of word order or an
        // extra word. (Abbreviations like Pkwy vs Parkway are still a separate miss.)
        const tokens = String(input.query ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
        let q = db.from('crm_listings').select(LISTING_COLS).limit(10);
        for (const tok of (tokens.length ? tokens : [''])) {
          const t = safeTerm(tok);
          q = q.or(`name.ilike.${t},address.ilike.${t}`);
        }
        q = scoped(q, ctx);
        const { data, error } = await q;
        return error ? j({ error: error.message }) : j(visibleListings(data, ctx));
      }
      case 'list_properties': {
        let q = db.from('crm_listings').select(LISTING_COLS).order('created_at', { ascending: false }).limit(30);
        q = scoped(q, ctx);
        if (input.status) q = q.eq('status', input.status);
        const { data, error } = await q;
        return error ? j({ error: error.message }) : j(visibleListings(data, ctx));
      }
      case 'get_property': {
        const { data: l } = await db.from('crm_listings').select('*').eq('id', input.listing_id).maybeSingle();
        if (!l) return j({ error: 'Property not found' });
        if (ctx.businessUnit && l.business_unit !== ctx.businessUnit) return j({ error: 'Property is in a different workspace' });
        if (!canSeeListing(l, ctx)) return j({ error: 'Property not found' });
        return j(l);
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

      // ── Layer 4: records & documents ───────────────────────────────────────
      case 'create_contact': {
        if (!CONTACT_TYPES.includes(input.type)) return j({ error: `type must be one of: ${CONTACT_TYPES.join(', ')}` });
        if (!input.first_name && !input.last_name && !input.business_name) return j({ error: 'Give the contact a name or a business name.' });
        const row: Record<string, any> = {
          type: input.type, business_unit: ctx.businessUnit ?? 'commercial', agent_id: ctx.userId,
          last_touched_at: new Date().toISOString(),
        };
        for (const f of ['first_name', 'last_name', 'business_name', 'email', 'phone', 'cell_phone', 'brokerage', 'notes', 'lead_source']) {
          if (input[f]) row[f] = String(input[f]).trim();
        }
        const { data, error } = await db.from('crm_clients').insert(row).select('id, first_name, last_name, business_name, email, type').single();
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Added contact “${data.business_name || `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim()}”`, data.id);
        return j({ ok: true, created: data });
      }
      case 'update_contact': {
        const bad = await outOfWorkspace(db, ctx, 'crm_clients', input.contact_id, 'Contact'); if (bad) return bad;
        const { data: c } = await db.from('crm_clients').select('agent_id, assigned_agent_ids').eq('id', input.contact_id).maybeSingle();
        if (!c) return j({ error: 'Contact not found' });
        if (ctx.role === 'agent' && c.agent_id !== ctx.userId && !((c.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId)) return j({ error: "That contact isn't assigned to you" });
        if (input.type && !CONTACT_TYPES.includes(input.type)) return j({ error: `type must be one of: ${CONTACT_TYPES.join(', ')}` });
        const patch: Record<string, any> = {};
        for (const f of ['first_name', 'last_name', 'business_name', 'email', 'phone', 'cell_phone', 'brokerage', 'type']) {
          if (input[f] !== undefined) patch[f] = input[f] === null ? null : String(input[f]).trim();
        }
        if (Object.keys(patch).length === 0) return j({ error: 'Nothing to update' });
        patch.last_touched_at = new Date().toISOString();
        const { data, error } = await db.from('crm_clients').update(patch).eq('id', input.contact_id).select('id, first_name, last_name, business_name, email, phone, type').single();
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Updated contact details (${Object.keys(patch).filter(k => k !== 'last_touched_at').join(', ')})`, input.contact_id);
        return j({ ok: true, updated: data });
      }
      case 'create_property': {
        const row: Record<string, any> = {
          name: String(input.name).trim(), business_unit: ctx.businessUnit ?? 'commercial',
          listing_agent_id: ctx.userId, status: input.status || 'active', flyer_type: 'sale',
        };
        for (const f of ['address', 'city', 'state', 'zip', 'type', 'lot_size', 'zoning', 'description', 'highlights']) {
          if (input[f]) row[f] = String(input[f]).trim();
        }
        if (input.asking_price != null && input.asking_price !== '') row.asking_price = Number(input.asking_price);
        if (input.sq_ft != null && input.sq_ft !== '') row.sq_ft = Number(input.sq_ft);
        const { data, error } = await db.from('crm_listings').insert(row).select('id, name, address, city, state, type, status, asking_price, sq_ft').single();
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Added property “${data.name}”`);
        return j({ ok: true, created: data });
      }
      case 'read_document': {
        if (input.submission_id) {
          const { data: sub } = await db.from('crm_form_submissions').select('id, title, status, values, deal_id, listing_id, client_id, business_unit, created_by').eq('id', input.submission_id).maybeSingle();
          if (!sub) return j({ error: 'Document not found' });
          if (ctx.businessUnit && sub.business_unit !== ctx.businessUnit) return j({ error: 'Document is in a different workspace' });
          return j({ id: sub.id, title: sub.title, status: sub.status, deal_id: sub.deal_id, listing_id: sub.listing_id, fields: summarizeFields(sub.values) });
        }
        let q = db.from('crm_form_submissions').select('id, title, status, deal_id, listing_id, updated_at').order('updated_at', { ascending: false }).limit(25);
        q = scoped(q, ctx);
        if (input.deal_id) q = q.eq('deal_id', input.deal_id);
        if (input.listing_id) q = q.eq('listing_id', input.listing_id);
        const { data, error } = await q;
        return error ? j({ error: error.message }) : j(data ?? []);
      }
      case 'fill_document': {
        const { data: sub } = await db.from('crm_form_submissions').select('id, title, values, business_unit, status').eq('id', input.submission_id).maybeSingle();
        if (!sub) return j({ error: 'Document not found' });
        if (ctx.businessUnit && sub.business_unit !== ctx.businessUnit) return j({ error: 'Document is in a different workspace' });
        // A document that has already been executed is a signed record, not a draft.
        if (sub.status === 'executed' || sub.status === 'completed') return j({ error: 'That document is already executed — it can no longer be edited.' });

        const wanted: Record<string, string> = {};
        if (input.contact_id) {
          const badC = await outOfWorkspace(db, ctx, 'crm_clients', input.contact_id, 'Contact'); if (badC) return badC;
          const { data: c } = await db.from('crm_clients').select('first_name, last_name, business_name, email, phone, cell_phone, address, city, state, zip').eq('id', input.contact_id).maybeSingle();
          if (c) {
            const full = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
            Object.assign(wanted, prune({
              name: full || c.business_name, 'full name': full || c.business_name, tenant: c.business_name || full,
              'tenant name': c.business_name || full, company: c.business_name, business: c.business_name,
              email: c.email, phone: c.phone || c.cell_phone, address: c.address, city: c.city, state: c.state, zip: c.zip,
            }));
          }
        }
        for (const [k, v] of Object.entries((input.fields ?? {}) as Record<string, unknown>)) {
          if (v != null && v !== '') wanted[String(k).trim().toLowerCase()] = String(v);
        }
        if (Object.keys(wanted).length === 0 && !input.title) return j({ error: 'Nothing to fill — pass fields, a contact_id, or a title.' });

        const { values, applied, unmatched } = applyFields(sub.values, wanted);
        const patch: Record<string, any> = { updated_at: new Date().toISOString() };
        if (applied.length) patch.values = values;
        if (input.title) patch.title = String(input.title).trim();
        const { error } = await db.from('crm_form_submissions').update(patch).eq('id', input.submission_id);
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Filled ${applied.length} field${applied.length === 1 ? '' : 's'} on “${sub.title ?? 'a document'}”`);
        return j({ ok: true, applied, unmatched, note: unmatched.length ? 'Those field names are not on this document — read_document lists the real ones.' : undefined });
      }
      case 'draft_campaign': {
        // status is hard-coded 'draft'. The send cron only picks up 'active', so
        // nothing the copilot creates can go out until a person activates it.
        const { data, error } = await db.from('crm_campaigns').insert({
          name: String(input.name).trim(), description: input.description ?? null,
          type: 'email', frequency: 'one-time', status: 'draft',
          email_subject: String(input.email_subject).trim(), email_body: String(input.email_body),
          business_unit: ctx.businessUnit ?? 'commercial', created_by: ctx.userId, sender_agent_id: ctx.userId,
        }).select('id, name, status, email_subject').single();
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Drafted campaign “${data.name}” (unsent draft)`);
        return j({ ok: true, campaign: data, note: 'Saved as an unsent draft with no audience. Review and send it from the Marketing tab.' });
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
    case 'create_contact': return `Add contact ${input.business_name || `${input.first_name ?? ''} ${input.last_name ?? ''}`.trim()} (${input.type})`;
    case 'update_contact': return `Update this contact's ${Object.keys(input).filter(k => k !== 'contact_id').join(', ') || 'details'}`;
    case 'create_property': return `Add property “${input.name}”${input.address ? ` — ${input.address}` : ''}${input.asking_price ? ` at $${Number(input.asking_price).toLocaleString()}` : ''}`;
    case 'fill_document': return `Fill in ${Object.keys(input.fields ?? {}).length || 'the'} field${Object.keys(input.fields ?? {}).length === 1 ? '' : 's'} on this document${input.contact_id ? " from the contact's details" : ''}`;
    case 'draft_campaign': return `Save “${input.name}” as an UNSENT draft campaign — nothing is emailed`;
    default: return name;
  }
}
