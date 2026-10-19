// Tool definitions + handlers for the CRM copilot. Each tool maps to a CRM operation and
// runs server-side as the signed-in agent, scoped to their business unit (super_admins,
// who have no unit, see everything). Read tools run automatically; WRITE_TOOLS mutate data
// and are gated behind an explicit confirmation in the API route.
import { ATT_BUCKET, findAttachmentById } from '@/lib/copilot-attachments';
import { findIdenticalFile } from '@/lib/dup-files';
import { editDocx, editPdf } from '@/lib/doc-text-edit';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildLoiDraft, missingRequired } from '@/lib/loi-autofill';
import { generateLoi, editLoi, type LoiEdit } from '@/lib/loi-generate';
import { exhibitLetter, type LoiExhibit } from '@/lib/loi-spec';
import { liveEnvelope, logDocEdit, restampOverlay, OUT_FOR_SIGNATURE } from '@/lib/doc-edit';

// token + origin let tools reuse the CRM's own HTTP endpoints (lease-draft, envelopes,
// form-submissions) as the agent, so the copilot goes through the exact same auth, RBAC
// and generation logic the manual UI does.
export interface AgentCtx { userId: string; role: string | null; businessUnit: string | null; token?: string; origin?: string; }

function admin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
const DEAL_STAGES = ['Prospect', 'Active', 'LOI', 'In Contract', 'Closed', 'Lost'];
// Mirrors DEAL_TYPES in CRMApp and the crm_deals_representation_side_check constraint.
const DEAL_TYPES = ['Buyer Purchase', 'Tenant Lease', 'Seller Listing', 'Landlord Listing'];
const REPRESENTATION_SIDES = ['buyer', 'tenant', 'seller', 'landlord', 'intermediary', 'unknown'];

// Call a CRM API route as the agent (same auth + RBAC as the UI).
async function crmFetch(ctx: AgentCtx, path: string, method: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${ctx.origin ?? 'https://www.fairoaksrealtygroup.com'}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      // Server-to-server: middleware turns away non-browser clients on /api/crm,
      // so the copilot identifies itself with the shared secret.
      ...(process.env.CRON_SECRET ? { 'x-crm-internal': process.env.CRON_SECRET } : {}),
    },
    body: JSON.stringify(body),
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

const centralToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const contactLabel = (c: { first_name?: string | null; last_name?: string | null; business_name?: string | null }) =>
  `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || 'Contact';
const normText = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STREET_ABBR: Record<string, string> = { cir: 'circle', dr: 'drive', st: 'street', rd: 'road', pkwy: 'parkway', ln: 'lane', blvd: 'boulevard', ct: 'court', hwy: 'highway', trl: 'trail', ave: 'avenue', pl: 'place', fm: 'farm to market' };
/** Same property however it was typed: "2250 Chipley Cir" = "2250 Chipley Circle" = "2250 chipley". */
function samePropertyText(a: unknown, b: unknown): boolean {
  const expand = (s: unknown) => normText(s).split(' ').map(w => STREET_ABBR[w] ?? w).join(' ');
  const x = expand(a), y = expand(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const key = (s: string) => s.match(/^(\d+)\s+([a-z]+)/)?.slice(1, 3).join(' ') ?? '';   // street number + first street word
  return !!key(x) && key(x) === key(y);
}

/**
 * Load contacts for a deal write. Every one must exist, be in the agent's workspace and — for an agent —
 * be theirs (the same visibility search_contacts gives them). Returns the rows, or a ready-to-return
 * JSON error string.
 */
async function loadDealContacts(db: SupabaseClient, ctx: AgentCtx, ids: string[]): Promise<Array<Record<string, any>> | string> {
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return [];
  const { data } = await db.from('crm_clients').select('id, first_name, last_name, business_name, email, phone, cell_phone, type, business_unit, agent_id, assigned_agent_ids').in('id', want);
  const rows = data ?? [];
  for (const id of want) {
    const c = rows.find(r => r.id === id);
    if (!c) return JSON.stringify({ error: `Contact ${id} not found` });
    if (ctx.businessUnit && c.business_unit !== ctx.businessUnit) return JSON.stringify({ error: `${contactLabel(c)} is in a different workspace` });
    if (ctx.role === 'agent' && c.agent_id !== ctx.userId && !((c.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId)) return JSON.stringify({ error: `${contactLabel(c)} isn't assigned to you` });
  }
  return rows;
}

/** Load a deal for a write: in workspace, and for an agent one they own or are assigned to. */
async function loadDealForWrite(db: SupabaseClient, ctx: AgentCtx, dealId: string): Promise<Record<string, any> | string> {
  const { data: d } = await db.from('crm_deals').select('*').eq('id', dealId).maybeSingle();
  if (!d) return JSON.stringify({ error: 'Deal not found' });
  if (ctx.businessUnit && d.business_unit !== ctx.businessUnit) return JSON.stringify({ error: 'That deal is in a different workspace' });
  if (ctx.role === 'agent' && d.agent_id !== ctx.userId && !((d.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId)) return JSON.stringify({ error: "That deal isn't assigned to you" });
  return d;
}

/**
 * File a file's bytes onto a deal's Docs tab or a property's documents (the shared tail of save_attachment and edit_file).
 * Deals accept PDF/Word/JPG/PNG/WebP; properties also accept Excel/CSV/text. An identical file already there is refused.
 * Returns the tool's JSON result string.
 */
async function fileBytesOnto(db: SupabaseClient, ctx: AgentCtx, buf: Buffer, fileName: string, target: { deal_id?: string; listing_id?: string }): Promise<string> {
  const j = (v: unknown) => JSON.stringify(v);
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const MIME: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain' };
  const contentType = MIME[ext];
  if (!contentType) return j({ error: `.${ext} files can’t be filed here.` });

  if (target.deal_id) {
    const deal = await loadDealForWrite(db, ctx, target.deal_id);
    if (typeof deal === 'string') return deal;
    if (!['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) return j({ error: 'Deals accept PDF, Word and JPG/PNG/WebP files. Save this one to a property instead, or convert it.' });
    const storagePath = `${target.deal_id}/${Date.now()}_${safe}`;
    const { error: upErr } = await db.storage.from('deal-docs').upload(storagePath, buf, { contentType, upsert: false });
    if (upErr) return j({ error: upErr.message });
    // Same file already on the deal (any name): don't attach it twice.
    const { data: same } = await db.from('crm_deal_docs').select('*').eq('deal_id', target.deal_id).eq('file_size', buf.length).limit(6);
    const dup = same?.length ? await findIdenticalFile(db, 'deal-docs', storagePath, same) : null;
    if (dup) { await db.storage.from('deal-docs').remove([storagePath]); return j({ error: `Not saved — this exact file is already on the deal as “${dup.name}”.`, duplicate: true }); }
    const { error } = await db.from('crm_deal_docs').insert({ deal_id: target.deal_id, name: fileName, storage_path: storagePath, file_size: buf.length, file_type: contentType, uploaded_by: ctx.userId });
    if (error) { await db.storage.from('deal-docs').remove([storagePath]); return j({ error: error.message }); }
    await logCopilot(db, ctx, `Filed “${fileName}” on a deal`, deal.client_id);
    return j({ ok: true, saved: fileName, to: `the deal “${deal.client}${deal.property ? ` — ${deal.property}` : ''}” (Docs tab)` });
  }
  const { data: l } = await db.from('crm_listings').select('id, name, business_unit, is_restricted, listing_agent_id, assigned_agent_ids').eq('id', target.listing_id).maybeSingle();
  if (!l || !canSeeListing(l, ctx)) return j({ error: 'Property not found' });
  if (ctx.businessUnit && l.business_unit !== ctx.businessUnit) return j({ error: 'That property is in a different workspace' });
  const dest = `${l.id}/${Date.now()}_${safe}`;
  const { error: cpErr } = await db.storage.from(ATT_BUCKET).upload(dest, buf, { contentType, upsert: false });
  if (cpErr) return j({ error: cpErr.message });
  const { data: same } = await db.from('crm_listing_files').select('*').eq('listing_id', l.id).eq('file_size', buf.length).limit(6);
  const dup = same?.length ? await findIdenticalFile(db, ATT_BUCKET, dest, same) : null;
  if (dup) { await db.storage.from(ATT_BUCKET).remove([dest]); return j({ error: `Not saved — this exact file is already on the property as “${dup.name}”.`, duplicate: true }); }
  const category = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? 'photo' : 'document';
  const { error } = await db.from('crm_listing_files').insert({ listing_id: l.id, name: fileName, storage_path: dest, file_size: buf.length, file_type: contentType, category, uploaded_by: ctx.userId });
  if (error) { await db.storage.from(ATT_BUCKET).remove([dest]); return j({ error: error.message }); }
  await logCopilot(db, ctx, `Filed “${fileName}” on a property`);
  return j({ ok: true, saved: fileName, to: `the property “${l.name}”${category === 'photo' ? ' (Photos)' : ' (Documents)'}` });
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
  'create_contact', 'update_contact', 'create_property', 'fill_document', 'draft_campaign', 'complete_loi', 'edit_loi',
  'create_deal', 'add_contacts_to_deal', 'remove_contacts_from_deal', 'update_deal', 'save_attachment', 'attach_exhibit_to_loi', 'remove_exhibit_from_loi', 'edit_file']);

// Which screen data a confirmed write makes stale — the panel tells the CRM to reload it, so a deal the
// copilot just created shows up in the pipeline without a page refresh.
export const DEAL_WRITE_TOOLS = new Set(['create_deal', 'add_contacts_to_deal', 'remove_contacts_from_deal', 'update_deal', 'update_deal_stage']);
export const CONTACT_WRITE_TOOLS = new Set(['create_contact', 'update_contact', 'add_note']);

// Tools whose success changes a document the agent may have open on screen — the app is told
// to reload it so the edit shows up live instead of being overwritten by a stale save.
export const DOC_EDIT_TOOLS = new Set(['fill_document', 'edit_loi', 'attach_exhibit_to_loi', 'remove_exhibit_from_loi']);

// Contact types the CRM actually uses — kept closed so the copilot can't invent one.
const CONTACT_TYPES = ['Tenant', 'Buyer', 'Seller', 'Landlord/Investor', 'Broker', 'Agent'];

export const TOOLS: Anthropic.Tool[] = [
  { name: 'search_contacts', description: 'Search the CRM for contacts (people/companies) by name, email, or business name. Returns up to 10 matches with their id, name, type, and email.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Name, email, or business to search for' } }, required: ['query'] } },
  { name: 'get_contact', description: "Get a contact's full details — including type, tags, notes, contact info, and their deals — by contact id.",
    input_schema: { type: 'object', properties: { contact_id: { type: 'string' } }, required: ['contact_id'] } },
  { name: 'list_tasks', description: 'List tasks. Defaults to open tasks assigned to the current agent. Use scope="all" to include the whole team, status="completed" or "all" to change status filter. Every task comes back with a `bucket` (overdue / today / this_week / upcoming / no_date, in Central time) and `kind` (task or call_list). Use `due` to ask for one bucket — "due this week" means due="this_week", which already includes today. Call-list calls are carried over, not overdue: they come back as bucket "call_list".',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'completed', 'all'] }, scope: { type: 'string', enum: ['mine', 'all'] }, due: { type: 'string', enum: ['overdue', 'today', 'this_week', 'upcoming', 'call_list'], description: 'Only tasks in this bucket.' } } } },
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

  { name: 'create_deal', description: `Create a pipeline deal for a contact and (optionally) attach other contacts to it. WRITE — confirm with the agent first. Steps: find the contact with search_contacts (create_contact first, as its own step, if they aren't in the CRM); if a property is involved find it with find_property and pass its id as listing_id. The deal starts at stage Prospect unless told otherwise. Types: ${DEAL_TYPES.join(', ')}. If this contact already has an open deal for that property it is NOT created — you get the existing deal back; tell the agent and offer to add contacts to / update that one instead.`,
    input_schema: { type: 'object', properties: {
      contact_id: { type: 'string', description: "The deal's primary client (a contact id)." },
      type: { type: 'string', enum: DEAL_TYPES },
      property: { type: 'string', description: 'Address or property name as the agent said it (filled from the listing if listing_id is given).' },
      listing_id: { type: 'string', description: 'A property id from find_property, to link the deal to that building.' },
      value: { type: 'number', description: 'Deal value in dollars, only if the agent gave one.' },
      stage: { type: 'string', enum: DEAL_STAGES },
      representation_side: { type: 'string', enum: REPRESENTATION_SIDES, description: 'Which side we represent, only if the agent said.' },
      notes: { type: 'string' },
      also_contact_ids: { type: 'array', items: { type: 'string' }, description: 'Other contacts to tag onto the deal (co-buyer, landlord, attorney, lender…).' },
      force: { type: 'boolean', description: 'Create even though a similar open deal exists — ONLY when the agent explicitly says they want a second deal.' } },
      required: ['contact_id', 'type'] } },
  { name: 'edit_file', description: `Add, replace or remove TEXT in an uploaded Word (.docx) or PDF file — a file the agent attached to this chat (attachment_id) or one on a deal (deal_file_id from list_deal_files). The ORIGINAL IS NEVER CHANGED: the edited version is filed as a new file ("<name> (edited)") on the deal's Docs tab (or a property's documents), where the agent can click 👁 View. Do all the changes the agent asked for in ONE call (edits is an ordered list). Word edits are real: replace (every occurrence, even across formatting), delete_text, delete_paragraph (by a phrase it contains), insert_paragraph (after a paragraph containing a phrase, or at start/end). PDF edits: add_text (write text to the right of / below / above an anchor phrase, e.g. on the blank after 'Tenant Name:', or at x,y points from the top-left) — it refuses rather than print over existing words — and remove_text (find the words; page and all to disambiguate). IMPORTANT for PDFs: remove_text by default only COVERS the words with a white box — they stay in the file's text layer and can still be selected/copied. For anything confidential, a legal strike, or a file that will be sent out, pass permanent:true (the changed pages are rebuilt as images, so the words are truly gone) and say so. Always tell the agent exactly what changed, what couldn't be found, and which of the two removal modes you used. Our own LOIs use edit_loi and forms use fill_document, not this. WRITE — confirm with the agent first.`,
    input_schema: { type: 'object', properties: {
      attachment_id: { type: 'string' }, deal_file_id: { type: 'string' },
      edits: { type: 'array', maxItems: 20, items: { type: 'object', properties: {
        op: { type: 'string', enum: ['replace', 'delete_text', 'delete_paragraph', 'insert_paragraph', 'add_text', 'remove_text'] },
        find: { type: 'string', description: 'replace / delete_text / remove_text: the exact words to find' },
        replace: { type: 'string', description: 'replace: the new wording' },
        containing: { type: 'string', description: 'delete_paragraph: words the paragraph contains (enough to be unique)' },
        text: { type: 'string', description: 'insert_paragraph / add_text: the text to add (insert_paragraph: use \n for several paragraphs)' },
        after: { type: 'string', description: 'insert_paragraph: words in the paragraph to insert after' },
        position: { type: 'string', enum: ['start', 'end'], description: 'insert_paragraph without "after"' },
        anchor: { type: 'string', description: 'add_text: words on the page to place the text next to' },
        placement: { type: 'string', enum: ['right', 'below', 'above'] },
        page: { type: 'number', description: 'PDF page, 1-based' }, x: { type: 'number' }, y: { type: 'number' }, size: { type: 'number' },
        all: { type: 'boolean', description: 'apply to every match instead of requiring exactly one' },
        permanent: { type: 'boolean', description: 'remove_text on a PDF: truly remove (rebuild the page as an image) instead of just covering' },
        allow_overlap: { type: 'boolean' } }, required: ['op'] } },
      deal_id: { type: 'string', description: 'Where to file the edited copy (defaults to the deal the source file is on).' }, listing_id: { type: 'string', description: 'Or a property.' },
      name: { type: 'string', description: 'Optional name for the edited file (keep the extension).' } },
      required: ['edits'] } },
  { name: 'attach_exhibit_to_loi', description: "Staple a PDF or image INTO a Letter of Intent as a labelled exhibit (EXHIBIT A, B, … — a cover sheet followed by the file's pages) so the LOI, its signature page and the exhibit are ONE combined PDF, rebuilt on the spot. Use this when the agent says 'add this to the LOI', 'attach the floor plan as an exhibit', 'put the site plan on the letter'. The file is either something they attached to this chat (attachment_id, the 10-character id in the file's header) or a file already on the deal (deal_file_id from list_deal_files). Works on a draft letter only — not one already out for signature. Do NOT use save_attachment for this (that only files a separate copy on the deal). WRITE — confirm with the agent first.",
    input_schema: { type: 'object', properties: { submission_id: { type: 'string', description: 'The LOI (use the one on screen, or find it with read_document).' }, attachment_id: { type: 'string' }, deal_file_id: { type: 'string' }, title: { type: 'string', description: 'Exhibit title as it should read, e.g. "Suite 210 Floor Plan" (the EXHIBIT letter is added automatically).' } }, required: ['submission_id'] } },
  { name: 'remove_exhibit_from_loi', description: "Take an exhibit back off a Letter of Intent (by its id, its 'Exhibit B' label, or its title) and rebuild the PDF. Replacing an exhibit = remove, then attach_exhibit_to_loi. WRITE — confirm with the agent first.",
    input_schema: { type: 'object', properties: { submission_id: { type: 'string' }, exhibit: { type: 'string', description: "id, 'Exhibit A', or the title" } }, required: ['submission_id', 'exhibit'] } },
  { name: 'list_deal_files', description: "List the uploaded files on a deal's Docs tab (id, name, type, size) — to find a file to attach to a letter as an exhibit. Read-only.",
    input_schema: { type: 'object', properties: { deal_id: { type: 'string' } }, required: ['deal_id'] } },
  { name: 'save_attachment', description: "File a document the agent attached to this chat onto a DEAL's Docs tab or a PROPERTY's documents (use the attachment id shown as 'id …' next to the file in the conversation). Deals accept PDF, Word and JPG/PNG/WebP; properties accept those plus Excel, CSV and text. Skips it if the identical file is already there. WRITE — confirm with the agent first; pass exactly one of deal_id / listing_id.",
    input_schema: { type: 'object', properties: { attachment_id: { type: 'string', description: 'The 10-character id from the attachment header, e.g. 3fa9c1d20b' }, deal_id: { type: 'string' }, listing_id: { type: 'string' }, name: { type: 'string', description: 'Optional new file name (keep the extension).' } }, required: ['attachment_id'] } },
  { name: 'add_contacts_to_deal', description: "Pull one or more existing contacts onto a deal: they are tagged on it (the deal then shows on their record). Optionally make one of them the deal's primary client — the previous primary stays tagged, nothing is lost. WRITE — confirm with the agent first.",
    input_schema: { type: 'object', properties: { deal_id: { type: 'string' }, contact_ids: { type: 'array', items: { type: 'string' } }, make_primary_contact_id: { type: 'string', description: 'Optional: promote this contact to primary client.' } }, required: ['deal_id', 'contact_ids'] } },
  { name: 'remove_contacts_from_deal', description: "Take tagged contacts off a deal (not the primary client — promote someone else with add_contacts_to_deal first). WRITE.",
    input_schema: { type: 'object', properties: { deal_id: { type: 'string' }, contact_ids: { type: 'array', items: { type: 'string' } } }, required: ['deal_id', 'contact_ids'] } },
  { name: 'update_deal', description: `Change a deal's details: type, property text, linked property (listing_id, or null to unlink), value, which side we represent, or append a dated note. To move its stage use update_deal_stage. WRITE — confirm with the agent first.`,
    input_schema: { type: 'object', properties: { deal_id: { type: 'string' }, type: { type: 'string', enum: DEAL_TYPES }, property: { type: 'string' }, listing_id: { type: ['string', 'null'] }, value: { type: 'number' }, representation_side: { type: 'string', enum: REPRESENTATION_SIDES }, append_note: { type: 'string' } }, required: ['deal_id'] } },

  // ── Leases, forms & e-sign (Layer 2) ──────────────────────────────────────
  { name: 'find_property', description: "Find a property/listing in the CRM by name or address. Returns id, name, address, type, status, asking price and size. Listings are SEPARATE from deals — a property the brokerage is marketing (with an asking price) lives here, not in the deals pipeline, so search here too whenever the agent asks about a property, an address, or a dollar figure you couldn't find in deals. Also the first step before drafting a lease (use the id as listing_id).",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Property name or street address' } }, required: ['query'] } },
  { name: 'list_properties', description: 'List the properties/listings in the agent\'s workspace, newest first — id, name, address, type, status, asking price, size. Use this for "what listings/properties do I have", or to find one by price when you don\'t know its name.',
    input_schema: { type: 'object', properties: { status: { type: 'string', description: 'Optional status filter, e.g. "active"' } } } },
  { name: 'get_property', description: 'Get a property/listing\'s full details by id — including asking price, size, zoning, description and highlights.',
    input_schema: { type: 'object', properties: { listing_id: { type: 'string' } }, required: ['listing_id'] } },
  { name: 'list_forms', description: 'List the available transaction-doc form templates (leases, contracts, addenda, etc.) — name, form_code, category.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'autofill_loi', description: "Pre-fill a Letter of Intent and report what it could and could not fill, with where each value came from. READ-ONLY — it creates nothing. A deal is OPTIONAL: pass deal_id when there is one, or contact_id alone, or NEITHER and just let the agent's own details and today's date fill while they give you the rest. Always run this before complete_loi.",
    input_schema: { type: 'object', properties: {
      form_id: { type: 'string', description: 'The LOI form id from list_forms (Letters of Intent category).' },
      deal_id: { type: 'string', description: 'Optional. A deal to pull the client, property, price and side from.' },
      contact_id: { type: 'string', description: 'Optional. A contact to pull the party details from when there is no deal.' },
      side: { type: 'string', enum: ['buyer', 'tenant', 'seller', 'landlord'], description: "Optional. Which side WE represent, when the agent has said so. Only pass what they actually told you." },
      provided: { type: 'object', description: 'Optional. Values the agent has already given you, so the preview reflects them.', additionalProperties: { type: 'string' } },
    }, required: ['form_id'] } },
  { name: 'complete_loi', description: "Complete a Letter of Intent: fill it from the deal plus the values the agent gave you, generate the PDF and file it on the deal as a reviewable draft. WRITE — the app pauses it for the agent's one-click confirmation, and what gets stamped is exactly what they confirm. Run autofill_loi FIRST and tell the agent what is filled and what is missing; if any REQUIRED field is still blank this refuses, so ask the agent for those exact values and pass them in `provided`. `provided` keys are the slot names autofill_loi reported (e.g. 'addressee_name', or a term row label like 'Seller:' / 'Purchase Price:'). NEVER put a value in `provided` that the agent did not give you — not a party name, not a price, not a date. This files a DRAFT only; it never sends for signature.",
    input_schema: { type: 'object', properties: {
      form_id: { type: 'string', description: 'The LOI form id from list_forms.' },
      deal_id: { type: 'string', description: 'Optional. Files the draft on this deal and pulls from it.' },
      contact_id: { type: 'string', description: 'Optional. With no deal, files the draft on this contact and pulls their details.' },
      side: { type: 'string', enum: ['buyer', 'tenant', 'seller', 'landlord'], description: "Optional. Which side WE represent. Pass it only when the agent said so — never your own guess." },
      provided: { type: 'object', description: 'Slot name → value, for values the AGENT supplied. Omit anything they did not state.', additionalProperties: { type: 'string' } },
    }, required: ['form_id'] } },
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
  { name: 'read_document', description: 'Read a saved contract/form document (a form submission) — its title, status and the field values currently filled in. Use before fill_document so you edit against what is actually there. Pass deal_id or listing_id to list the documents on that deal/property, or `query` to find documents by title (e.g. "Chestnut") when you do not know the deal.',
    input_schema: { type: 'object', properties: { submission_id: { type: 'string' }, deal_id: { type: 'string' }, listing_id: { type: 'string' }, query: { type: 'string', description: 'Case-insensitive words from the document title.' } } } },
  { name: 'fill_document', description: "Fill in or edit fields on a contract/form document — e.g. dropping a contact's name, company, email and phone into the right blanks. Pass only the fields you're setting; everything else is left alone. Read it with read_document first. WRITE — confirm with the agent first. This edits the draft only; it does not send or sign anything.",
    input_schema: { type: 'object', properties: { submission_id: { type: 'string' }, fields: { type: 'object', description: 'Field label or id → value, e.g. {"Tenant Name": "Acme LLC", "Email": "a@b.com"}' }, contact_id: { type: 'string', description: "Optional: pull this contact's name/company/email/phone in automatically, then apply `fields` on top." }, title: { type: 'string' } }, required: ['submission_id'] } },
  { name: 'edit_loi', description: "Edit an EXISTING Letter of Intent (a saved LOI document) live: change term values, add or remove terms, or change the addressee / re line / date / additional terms / signers. It rebuilds the letter's PDF and refiles it, and the agent's open screen refreshes. Read it first with read_document (submission_id) — that lists the exact term labels. Pass only what changes. Never invent a legal value: use only what the agent told you in this conversation. Refuses an executed letter or one out for e-signature. WRITE — confirm with the agent first. It edits the draft only; it never sends or signs.",
    input_schema: { type: 'object', properties: {
      submission_id: { type: 'string', description: 'The LOI document id (from read_document / the open document).' },
      set_terms: { type: 'object', description: 'Existing term label → new value, e.g. {"Purchase Price": "$4,500,000", "Due Diligence Period": "45 days"}. Labels are matched case-insensitively; read_document shows them.' },
      add_terms: { type: 'array', description: 'New term rows to add', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' }, after: { type: 'string', description: 'Optional existing label to insert it after (default: the end).' } }, required: ['label', 'value'] } },
      remove_terms: { type: 'array', items: { type: 'string' }, description: 'Labels of terms to remove' },
      fields: { type: 'object', description: 'Letter-level fields: loiDate, addresseeName, addresseeAddr1, addresseeAddr2, reLine, additionalTerms, intro, subtitle, agentName, agentEmail, agentPhone.' },
      signers: { type: 'array', description: 'Acceptance blocks by position (first = first block)', items: { type: 'object', properties: { entity: { type: 'string' }, signatory: { type: 'string' } } } },
    }, required: ['submission_id'] } },
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
        let q = db.from('crm_tasks').select('id, title, due_date, status, priority, type, description, notes, client_id, deal_id, assigned_to, agent_id, completed_at').order('due_date', { ascending: true, nullsFirst: false }).limit(input.due ? 200 : 60);
        q = scoped(q, ctx);
        // "Open" is completed_at IS NULL, matching how the Tasks page itself
        // decides. Filtering on status='open' silently hid in_progress tasks, and
        // status='completed' matched nothing at all because the column holds
        // 'done' — asking for completed tasks always returned an empty list.
        if (status === 'open') q = q.is('completed_at', null);
        else if (status === 'completed') q = q.not('completed_at', 'is', null);

        // Ownership is agent_id OR assigned_to OR created_by, for EVERY role.
        // This used to filter admins on assigned_to alone, which is null on 52 of
        // the 70 tasks in the book — so the copilot told an admin holding 34 open
        // tasks that he had none. Telling someone their queue is empty when it
        // isn't is worse than any other failure this tool can have.
        if ((input.scope ?? 'mine') === 'mine' || ctx.role === 'agent') {
          q = q.or(`agent_id.eq.${ctx.userId},assigned_to.eq.${ctx.userId},created_by.eq.${ctx.userId}`);
        }
        const { data, error } = await q;
        if (error) return j({ error: error.message });

        // Bucket in Central time (the office's day), the way the Tasks page does it. The model was
        // left to compare dates itself and called 10 of 12 tasks "due this week"; and call-list
        // calls (type=call, "From:" line) are carried over, never "overdue".
        const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
        const todayStr = ymd(new Date());
        const [ty, tm, td] = todayStr.split('-').map(Number);
        const dow = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay();          // 0 = Sunday
        const weekEnd = new Date(Date.UTC(ty, tm - 1, td + (7 - dow) % 7)).toISOString().slice(0, 10);   // this Sunday
        const rows = (data ?? []).map(t => {
          const due = (t.due_date as string | null)?.slice(0, 10) ?? null;
          const listCall = t.type === 'call' && /(^|\n)From:\s*\S/.test(`${t.description ?? ''}\n${t.notes ?? ''}`);
          const bucket = listCall ? 'call_list' : !due ? 'no_date' : due < todayStr ? 'overdue' : due === todayStr ? 'today' : due <= weekEnd ? 'this_week' : 'upcoming';
          const { description: _d, notes: _n, type: _t, ...rest } = t as Record<string, unknown>;
          return { ...rest, due_date: due, bucket, kind: listCall ? 'call_list' : 'task' };
        });
        const want = input.due as string | undefined;
        const out = want ? rows.filter(r => want === 'this_week' ? (r.bucket === 'today' || r.bucket === 'this_week') : r.bucket === want) : rows;
        return j({ today: todayStr, week_ends: weekEnd, count: out.length, tasks: out.slice(0, 40) });
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
        // The deals/listings split is the single thing this copilot gets wrong
        // most often: asked "which deal is at 1.9M" it lists deals, finds nothing
        // and says so — when the 1.9M is a LISTING. A rule in the system prompt
        // was not enough; the reminder has to arrive at the moment of the
        // decision, in the result the model is reading.
        return j({
          deals: data ?? [],
          note: 'These are pipeline DEALS only. Properties/listings are a separate record type with their own asking prices. If you are looking for an address, a property name or a dollar figure and it is not in this list, call list_properties or find_property before telling the agent it does not exist.',
        });
      }
      case 'get_deal': {
        const { data: d } = await db.from('crm_deals').select('*').eq('id', input.deal_id).single();
        if (!d) return j({ error: 'Deal not found' });
        if (ctx.businessUnit && d.business_unit !== ctx.businessUnit) return j({ error: 'Deal is in a different workspace' });
        if (ctx.role === 'agent' && d.agent_id !== ctx.userId && !((d.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId)) return j({ error: "That deal isn't assigned to you" });
        // Ids alone are opaque: name the tagged contacts so "who's on this deal?" is answerable.
        const tagIds = ((d.tagged_contact_ids as string[] | null) ?? []);
        const { data: tagRows } = tagIds.length ? await db.from('crm_clients').select('id, first_name, last_name, business_name, type').in('id', tagIds) : { data: [] as any[] };
        return j({ ...d, tagged_contacts: (tagRows ?? []).map(c => ({ id: c.id, name: contactLabel(c), type: c.type })) });
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

      case 'create_deal': {
        if (!DEAL_TYPES.includes(input.type)) return j({ error: `type must be one of: ${DEAL_TYPES.join(', ')}` });
        const stage = input.stage ?? 'Prospect';
        if (!DEAL_STAGES.includes(stage)) return j({ error: `stage must be one of: ${DEAL_STAGES.join(', ')}` });
        if (input.representation_side && !REPRESENTATION_SIDES.includes(input.representation_side)) return j({ error: `representation_side must be one of: ${REPRESENTATION_SIDES.join(', ')}` });
        const extraIds = ((input.also_contact_ids ?? []) as string[]).filter(id => id && id !== input.contact_id);
        const people = await loadDealContacts(db, ctx, [input.contact_id, ...extraIds]);
        if (typeof people === 'string') return people;
        const primary = people.find(c => c.id === input.contact_id)!;

        let listing: Record<string, any> | null = null;
        if (input.listing_id) {
          const { data: l } = await db.from('crm_listings').select('id, name, address, business_unit, is_restricted, listing_agent_id, assigned_agent_ids').eq('id', input.listing_id).maybeSingle();
          if (!l || !canSeeListing(l, ctx)) return j({ error: 'Property not found' });
          if (ctx.businessUnit && l.business_unit !== ctx.businessUnit) return j({ error: 'That property is in a different workspace' });
          listing = l;
        }
        const property = String(input.property ?? '').trim() || listing?.name || '';

        // One open deal per contact per property. The copilot (like the New Deal form) will happily make a second one
        // if asked twice, and duplicates were exactly what agents kept having to clean up.
        const { data: open } = await db.from('crm_deals').select('id, property, stage, type, value, listing_id').eq('client_id', primary.id).not('stage', 'in', '("Closed","Lost")');
        const same = (open ?? []).filter(d => (listing && d.listing_id === listing.id) || (property && samePropertyText(d.property, property)) || (listing && samePropertyText(d.property, listing.address || listing.name)) || (!listing && !property && d.type === input.type));
        if (same.length && input.force !== true) {
          return j({ error: `Not created: ${contactLabel(primary)} already has an open deal${property ? ` for ${property}` : ''} (${same.map(d => `${d.stage}${d.property ? ` · ${d.property}` : ''}`).join('; ')}). Tell the agent, and offer to add contacts to or update that deal instead.`, duplicate: true, existing: same });
        }

        const row: Record<string, any> = {
          client_id: primary.id, client: contactLabel(primary), client_email: primary.email || '', client_phone: primary.phone || primary.cell_phone || '',
          type: input.type, property, value: Number(input.value) > 0 ? Number(input.value) : 0, notes: input.notes ? String(input.notes) : '',
          agent_id: ctx.userId, stage, last_touch: centralToday(), business_unit: ctx.businessUnit ?? primary.business_unit ?? 'commercial',
          listing_id: listing?.id ?? null, tagged_contact_ids: extraIds,
        };
        if (input.representation_side) row.representation_side = input.representation_side;
        const { data: created, error } = await db.from('crm_deals').insert(row).select('id, client, type, property, value, stage').single();
        if (error) return j({ error: error.message });
        const tagged = people.filter(c => c.id !== primary.id).map(contactLabel);
        await logCopilot(db, ctx, `Created ${input.type} deal${property ? ` for ${property}` : ''}${tagged.length ? ` and tagged ${tagged.join(', ')}` : ''}`, primary.id);
        return j({ ok: true, created, tagged_contacts: tagged, note: 'The deal is now in the Deal Flow pipeline at this stage.' });
      }
      case 'list_deal_files': {
        const deal = await loadDealForWrite(db, ctx, input.deal_id);   // same workspace + ownership rule as every deal read here
        if (typeof deal === 'string') return deal;
        const { data } = await db.from('crm_deal_docs').select('id, name, file_type, file_size, created_at').eq('deal_id', input.deal_id).order('created_at', { ascending: false }).limit(50);
        return j({ files: (data ?? []).map(f => ({ id: f.id, name: f.name, type: f.file_type, size_kb: f.file_size ? Math.round(Number(f.file_size) / 1024) : null, uploaded: String(f.created_at).slice(0, 10) })) });
      }
      case 'remove_exhibit_from_loi': {
        const bad = await outOfWorkspace(db, ctx, 'crm_form_submissions', input.submission_id, 'Document'); if (bad) return bad;
        const r = await editLoi(db, ctx.userId, ctx.businessUnit, String(input.submission_id), { removeExhibits: [String(input.exhibit)] }, ctx.origin ?? 'https://www.fairoaksrealtygroup.com');
        if (!r.ok) return j({ error: r.error });
        await logCopilot(db, ctx, `Removed an exhibit from the Letter of Intent “${r.submission.title ?? ''}”`);
        return j({ ok: true, edited: r.changes, submission_id: r.submission.id, note: 'The letter\u2019s PDF was rebuilt without it. Nothing was sent for signature.' });
      }
      case 'edit_file': {
        if (!!input.attachment_id === !!input.deal_file_id) return j({ error: 'Pass exactly one of attachment_id (a file attached to this chat) or deal_file_id (a file on a deal).' });
        const edits = (Array.isArray(input.edits) ? input.edits : []).filter((e: unknown) => e && typeof e === 'object').slice(0, 20) as Record<string, unknown>[];
        if (!edits.length) return j({ error: 'No edits given.' });
        let src: Buffer, srcName: string, srcDealId: string | null = null;
        if (input.attachment_id) {
          const att = await findAttachmentById(db, ctx.userId, String(input.attachment_id));
          if (!att) return j({ error: 'I can’t find that attachment any more (they’re kept for a few days) — ask the agent to attach it again.' });
          const { data, error } = await db.storage.from(ATT_BUCKET).download(att.path);
          if (error || !data) return j({ error: 'Could not read the attachment.' });
          src = Buffer.from(await data.arrayBuffer()); srcName = att.name;
        } else {
          const { data: f } = await db.from('crm_deal_docs').select('id, deal_id, name, storage_path').eq('id', input.deal_file_id).maybeSingle();
          if (!f) return j({ error: 'That deal file was not found.' });
          const deal = await loadDealForWrite(db, ctx, f.deal_id);
          if (typeof deal === 'string') return deal;
          const { data, error } = await db.storage.from('deal-docs').download(f.storage_path);
          if (error || !data) return j({ error: 'Could not read that file.' });
          src = Buffer.from(await data.arrayBuffer()); srcName = f.name; srcDealId = f.deal_id;
        }
        const ext = (srcName.split('.').pop() ?? '').toLowerCase();
        if (ext !== 'docx' && ext !== 'pdf') return j({ error: `I can edit Word (.docx) and PDF files — not .${ext}. (An older .doc needs to be re-saved as .docx first.)` });
        if (!!input.deal_id && !!input.listing_id) return j({ error: 'Pass only one of deal_id or listing_id.' });
        const target = input.deal_id || input.listing_id ? { deal_id: input.deal_id, listing_id: input.listing_id } : srcDealId ? { deal_id: srcDealId } : null;
        if (!target) return j({ error: 'Which deal or property should I file the edited copy on? Ask the agent, then pass deal_id or listing_id.' });
        let result;
        try { result = ext === 'docx' ? await editDocx(src, edits) : await editPdf(src, edits); }
        catch (e) { console.warn('[edit_file]', (e as Error).message); return j({ error: `I couldn’t open that ${ext.toUpperCase()} to edit it${ext === 'pdf' ? ' (it may be password-protected or damaged)' : ''}.` }); }
        if (!result.report.length) return j({ error: `Nothing was changed. ${result.warnings.join(' ')}`.trim(), warnings: result.warnings });
        const base = srcName.replace(/\.[a-z0-9]+$/i, '').replace(/\s*\(edited\)$/i, '');
        let outName = String(input.name || `${base} (edited).${ext}`).replace(/[\r\n/\\]+/g, ' ').trim().slice(0, 200);
        // never file two files with the same name on one deal/property: "(edited)", then "(edited 2)", "(edited 3)"…
        const { data: taken } = target.deal_id
          ? await db.from('crm_deal_docs').select('name').eq('deal_id', target.deal_id).limit(200)
          : await db.from('crm_listing_files').select('name').eq('listing_id', target.listing_id).limit(200);
        const names = new Set((taken ?? []).map(x => String(x.name).toLowerCase()));
        for (let n = 2; names.has(outName.toLowerCase()) && n < 50; n++) outName = outName.replace(/(\s*\(edited(?: \d+)?\))?(\.[a-z0-9]+)$/i, ` (edited ${n})$2`);
        const filed = JSON.parse(await fileBytesOnto(db, ctx, Buffer.from(result.bytes), outName, target));
        if (filed.error) return j(filed);
        await logCopilot(db, ctx, `Edited “${srcName}” (${result.report.length} change${result.report.length === 1 ? '' : 's'}) and filed the copy as “${outName}”`);
        return j({ ok: true, saved: outName, to: filed.to, changes: result.report, ...(result.warnings.length ? { warnings: result.warnings } : {}), note: 'The original file is untouched. Tell the agent exactly what changed and any warning (especially whether a PDF removal was only covered or permanent), and that they can click 👁 View on the new file.' });
      }
      case 'attach_exhibit_to_loi': {
        const bad = await outOfWorkspace(db, ctx, 'crm_form_submissions', input.submission_id, 'Document'); if (bad) return bad;
        if (!!input.attachment_id === !!input.deal_file_id) return j({ error: 'Pass exactly one of attachment_id (a file attached to this chat) or deal_file_id (a file on the deal).' });
        let src: Buffer, fileName: string;
        if (input.attachment_id) {
          const att = await findAttachmentById(db, ctx.userId, String(input.attachment_id));
          if (!att) return j({ error: 'I can’t find that attachment any more (they’re kept for a few days) — ask the agent to attach it again.' });
          const { data, error } = await db.storage.from(ATT_BUCKET).download(att.path);
          if (error || !data) return j({ error: 'Could not read the attachment.' });
          src = Buffer.from(await data.arrayBuffer()); fileName = att.name;
        } else {
          const { data: f } = await db.from('crm_deal_docs').select('id, deal_id, name, storage_path').eq('id', input.deal_file_id).maybeSingle();
          if (!f) return j({ error: 'That deal file was not found.' });
          const deal = await loadDealForWrite(db, ctx, f.deal_id);
          if (typeof deal === 'string') return deal;
          const { data, error } = await db.storage.from('deal-docs').download(f.storage_path);
          if (error || !data) return j({ error: 'Could not read that file.' });
          src = Buffer.from(await data.arrayBuffer()); fileName = f.name;
        }
        const ext = (fileName.split('.').pop() ?? '').toLowerCase();
        let bytes: Buffer = src, kind: 'pdf' | 'image', storeExt = ext;
        if (ext === 'pdf') {
          kind = 'pdf';
          try {
            const { PDFDocument } = await import('pdf-lib');
            const n = (await PDFDocument.load(src)).getPageCount();
            if (n > 40) return j({ error: `That PDF has ${n} pages — exhibits are limited to 40. Ask for a shorter file or trim it first.` });
          } catch { return j({ error: 'I couldn’t open that PDF (it may be password-protected or damaged).' }); }
        } else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
          kind = 'image';
          try {
            const sharp = (await import('sharp')).default;
            let img = sharp(src, { failOn: 'none' }).rotate();
            const meta = await img.metadata();
            if ((meta.width ?? 0) > 3000 || (meta.height ?? 0) > 3000) img = img.resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true });
            // pdf-lib embeds JPEG and PNG only: keep those, convert WebP/GIF to PNG.
            if (ext === 'jpg' || ext === 'jpeg') { bytes = await img.jpeg({ quality: 90 }).toBuffer(); storeExt = 'jpg'; } else { bytes = await img.png().toBuffer(); storeExt = 'png'; }
          } catch { return j({ error: 'I couldn’t read that image.' }); }
        } else return j({ error: `Only PDFs and images (JPG/PNG/WebP/GIF) can be attached as exhibits — not .${ext}.` });
        if (bytes.length > 15 * 1024 * 1024) return j({ error: 'That file is over 15 MB — too large to build into the letter.' });

        const exId = Math.random().toString(16).slice(2, 10);
        const path = `loi-exhibits/${input.submission_id}/${exId}__${fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80).replace(/\.[a-z]+$/i, '')}.${storeExt}`;
        const { error: upErr } = await db.storage.from(ATT_BUCKET).upload(path, bytes, { contentType: kind === 'pdf' ? 'application/pdf' : `image/${storeExt === 'jpg' ? 'jpeg' : 'png'}`, upsert: false });
        if (upErr) return j({ error: upErr.message });
        const title = (String(input.title ?? '').trim() || fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ')).replace(/^exhibit\s+[a-z0-9]+\s*[-–—:]\s*/i, '').trim().slice(0, 100) || 'Attachment';
        const exhibit: LoiExhibit = { id: exId, title, name: fileName, path, kind };
        const r = await editLoi(db, ctx.userId, ctx.businessUnit, String(input.submission_id), { addExhibit: exhibit }, ctx.origin ?? 'https://www.fairoaksrealtygroup.com');
        if (!r.ok) { await db.storage.from(ATT_BUCKET).remove([path]); return j({ error: r.error }); }
        await logCopilot(db, ctx, `Attached “${title}” to the Letter of Intent “${r.submission.title ?? ''}” as an exhibit`);
        return j({ ok: true, edited: r.changes, submission_id: r.submission.id, note: 'The exhibit is now part of the letter\u2019s PDF (cover sheet + its pages, after the signature page) and the agent\u2019s screen refreshes. Nothing was sent for signature.' });
      }
      case 'save_attachment': {
        if (!!input.deal_id === !!input.listing_id) return j({ error: 'Pass exactly one of deal_id or listing_id.' });
        const att = await findAttachmentById(db, ctx.userId, String(input.attachment_id ?? ''));
        if (!att) return j({ error: 'I can’t find that attachment any more (they’re kept for a few days) — ask the agent to attach it again.' });
        const { data: blob, error: dlErr } = await db.storage.from(ATT_BUCKET).download(att.path);
        if (dlErr || !blob) return j({ error: 'Could not read the attachment.' });
        const buf = Buffer.from(await blob.arrayBuffer());
        const fileName = String(input.name || att.name).replace(/[\r\n/\\]+/g, ' ').trim().slice(0, 200) || att.name;
        return fileBytesOnto(db, ctx, buf, fileName, { deal_id: input.deal_id, listing_id: input.listing_id });
      }
      case 'add_contacts_to_deal':
      case 'remove_contacts_from_deal': {
        const adding = name === 'add_contacts_to_deal';
        const deal = await loadDealForWrite(db, ctx, input.deal_id);
        if (typeof deal === 'string') return deal;
        const ids = [...new Set(((input.contact_ids ?? []) as string[]).filter(Boolean))];
        if (!ids.length && !input.make_primary_contact_id) return j({ error: 'Give at least one contact.' });
        const tagged = new Set<string>(((deal.tagged_contact_ids as string[] | null) ?? []));
        const patch: Record<string, any> = { last_touch: centralToday() };
        let primaryId: string | null = deal.client_id ?? null;
        const named: string[] = [], already: string[] = [];

        if (adding) {
          const wantIds = [...ids, ...(input.make_primary_contact_id ? [input.make_primary_contact_id] : [])];
          const people = await loadDealContacts(db, ctx, wantIds);
          if (typeof people === 'string') return people;
          if (input.make_primary_contact_id) {
            const np = people.find(c => c.id === input.make_primary_contact_id)!;
            // The old primary stays on the deal as a tagged contact — promoting someone must never drop anyone.
            if (deal.client_id && deal.client_id !== np.id) tagged.add(deal.client_id);
            tagged.delete(np.id);
            Object.assign(patch, { client_id: np.id, client: contactLabel(np), client_email: np.email || '', client_phone: np.phone || np.cell_phone || '' });
            primaryId = np.id;
            named.push(`${contactLabel(np)} (now the primary client)`);
          }
          for (const c of people) {
            if (c.id === primaryId) continue;
            if (tagged.has(c.id)) already.push(contactLabel(c)); else { tagged.add(c.id); named.push(contactLabel(c)); }
          }
        } else {
          if (ids.includes(deal.client_id)) return j({ error: "That's the deal's primary client — promote someone else first (add_contacts_to_deal with make_primary_contact_id), then remove them." });
          for (const id of ids) { if (tagged.delete(id)) named.push(id); else already.push(id); }
          const { data: ppl } = named.length ? await db.from('crm_clients').select('id, first_name, last_name, business_name').in('id', named) : { data: [] as any[] };
          const label = new Map((ppl ?? []).map(c => [c.id, contactLabel(c)]));
          for (let i = 0; i < named.length; i++) named[i] = label.get(named[i]) ?? named[i];
        }
        patch.tagged_contact_ids = [...tagged].filter(id => id !== primaryId);
        const { error } = await db.from('crm_deals').update(patch).eq('id', input.deal_id);
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `${adding ? 'Added' : 'Removed'} ${named.join(', ') || 'contacts'} ${adding ? 'to' : 'from'} a deal`, deal.client_id);
        return j({ ok: true, [adding ? 'added' : 'removed']: named, [adding ? 'already_on_deal' : 'not_on_deal']: already, deal_now_tags: patch.tagged_contact_ids.length });
      }
      case 'update_deal': {
        const deal = await loadDealForWrite(db, ctx, input.deal_id);
        if (typeof deal === 'string') return deal;
        const patch: Record<string, any> = {};
        if (input.type !== undefined) { if (!DEAL_TYPES.includes(input.type)) return j({ error: `type must be one of: ${DEAL_TYPES.join(', ')}` }); patch.type = input.type; }
        if (input.property !== undefined) patch.property = String(input.property).trim();
        if (input.value !== undefined) patch.value = Number(input.value) >= 0 ? Number(input.value) : 0;
        if (input.representation_side !== undefined) { if (!REPRESENTATION_SIDES.includes(input.representation_side)) return j({ error: `representation_side must be one of: ${REPRESENTATION_SIDES.join(', ')}` }); patch.representation_side = input.representation_side; }
        if (input.listing_id !== undefined) {
          if (input.listing_id === null) patch.listing_id = null;
          else {
            const { data: l } = await db.from('crm_listings').select('id, name, business_unit, is_restricted, listing_agent_id, assigned_agent_ids').eq('id', input.listing_id).maybeSingle();
            if (!l || !canSeeListing(l, ctx)) return j({ error: 'Property not found' });
            if (ctx.businessUnit && l.business_unit !== ctx.businessUnit) return j({ error: 'That property is in a different workspace' });
            patch.listing_id = l.id;
            if (input.property === undefined && !deal.property) patch.property = l.name;
          }
        }
        if (input.append_note) patch.notes = `${deal.notes ? deal.notes + '\n\n' : ''}[${new Date().toLocaleDateString('en-US')}] ${String(input.append_note).trim()}`;
        if (!Object.keys(patch).length) return j({ error: 'Nothing to update' });
        patch.last_touch = centralToday();
        const { data, error } = await db.from('crm_deals').update(patch).eq('id', input.deal_id).select('id, client, type, property, value, stage, representation_side, listing_id').single();
        if (error) return j({ error: error.message });
        await logCopilot(db, ctx, `Updated a deal (${Object.keys(patch).filter(k => k !== 'last_touch').join(', ')})`, deal.client_id);
        return j({ ok: true, updated: data });
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
      case 'autofill_loi': {
        // Read-only: builds the same draft the review screen shows, so the copilot can
        // say what is ready and what is missing. Generating stays a human action in
        // the UI — the copilot triggers and narrates, it does not file documents.
        if (input.deal_id) { const bad = await outOfWorkspace(db, ctx, 'crm_deals', input.deal_id, 'Deal'); if (bad) return bad; }
        if (input.contact_id) { const bad = await outOfWorkspace(db, ctx, 'crm_clients', input.contact_id, 'Contact'); if (bad) return bad; }
        const { data: p } = await db.from('crm_profiles').select('first_name, last_name, email, phone, license').eq('id', ctx.userId).maybeSingle();
        const draft = await buildLoiDraft(db, {
          name: `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim(), email: p?.email ?? '', phone: p?.phone ?? '', license: p?.license ?? '',
        }, {
          formId: String(input.form_id),
          dealId: input.deal_id ? String(input.deal_id) : null,
          contactId: input.contact_id ? String(input.contact_id) : null,
          side: input.side ? String(input.side) : null,
          provided: (input.provided ?? {}) as Record<string, string>,
        });
        if ('error' in draft) return j({ error: draft.error });
        const missing = missingRequired(draft);
        return j({
          form: draft.formName,
          weRepresent: draft.side.side, sideConfidence: draft.side.confidence, sideReason: draft.side.reason,
          willBeFiledOn: draft.filesOn.label,
          filledFromCrm: draft.slots.filter(x => x.provenance === 'crm').map(x => `${x.label}: ${x.value}`),
          standardLanguage: draft.slots.filter(x => x.provenance === 'default').length,
          // Reported as slot + label together: the slot is the key complete_loi takes,
          // and handing back only the label had the model key its answers by the
          // label, which then matched nothing.
          needsAgentInput: draft.needsInput.map(x => ({ key: x.slot, label: x.label, required: x.required })),
          checkThese: draft.checkThese.map(x => `${x.label} — ${x.check}`),
          requiredStillBlank: missing.map(x => ({ key: x.slot, label: x.label })),
          ...(draft.unmatchedProvided.length ? { didNotMatchAnyField: draft.unmatchedProvided, note2: 'These values you passed match no field on this form — use the exact keys above.' } : {}),
          blocked: draft.blocked?.reason,
          note: 'Nothing was created. To review each line and generate the draft PDF, the agent opens the deal\u2019s Docs tab and uses the ✨ Auto-fill button on this form. You cannot generate it.',
        });
      }
      case 'complete_loi': {
        // The gated twin of autofill_loi. Reaching here means the agent already
        // confirmed the ticket, so the arguments are the ones they approved — the
        // model cannot have changed its mind about a party name or a price since.
        if (input.deal_id) { const bad = await outOfWorkspace(db, ctx, 'crm_deals', input.deal_id, 'Deal'); if (bad) return bad; }
        if (input.contact_id) { const bad = await outOfWorkspace(db, ctx, 'crm_clients', input.contact_id, 'Contact'); if (bad) return bad; }
        const { data: me } = await db.from('crm_profiles').select('first_name, last_name, email, phone, license').eq('id', ctx.userId).maybeSingle();
        const r = await generateLoi(db, ctx.userId, ctx.businessUnit, {
          name: `${me?.first_name ?? ''} ${me?.last_name ?? ''}`.trim(), email: me?.email ?? '', phone: me?.phone ?? '', license: me?.license ?? '',
        }, {
          formId: String(input.form_id),
          dealId: input.deal_id ? String(input.deal_id) : null,
          contactId: input.contact_id ? String(input.contact_id) : null,
          side: input.side ? String(input.side) : null,
          provided: (input.provided ?? {}) as Record<string, string>,
          baseUrl: ctx.origin ?? 'https://www.fairoaksrealtygroup.com',
        });
        if (!r.ok) {
          // The 422 branch is the required-field gate: name the fields so the model
          // asks the agent for exactly those rather than inventing them.
          return j({
            error: r.error,
            ...(r.missingRequired?.length ? { askTheAgentFor: r.missingRequired.map(m => m.label), note: 'Ask the agent for these exact values. Do not supply them yourself.' } : {}),
            ...(r.blocked ? { blocked: r.blocked } : {}),
          });
        }
        await logCopilot(db, ctx, `Completed the Letter of Intent and filed it on the deal`, null);
        return j({
          ok: true, filed: true, submission: r.submission, weRepresent: r.side, filedOn: r.filedOn,
          ...(r.unmatchedProvided.length ? { warning: `These values matched no field and are NOT on the document: ${r.unmatchedProvided.join(', ')}. Tell the agent.` } : {}),
          note: 'The completed draft is on the deal. Nothing has been sent — e-signature is a separate step the agent takes themselves.',
        });
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
          const { data: bdRow } = await db.from('crm_form_submissions').select('builder_data').eq('id', input.submission_id).maybeSingle();
          const bd = bdRow?.builder_data as { terms?: { label: string; value: string }[]; [k: string]: unknown } | null;
          if (bd && Array.isArray(bd.terms)) {
            // A Letter of Intent: its content is the term list + letter fields, not overlay blanks.
            const env = await liveEnvelope(db, String(input.submission_id));
            return j({
              id: sub.id, title: sub.title, status: sub.status, kind: 'letter_of_intent', deal_id: sub.deal_id, listing_id: sub.listing_id,
              out_for_signature: !!env,
              letter: Object.fromEntries(['loiDate', 'addresseeName', 'addresseeAddr1', 'addresseeAddr2', 'reLine', 'additionalTerms', 'intro', 'subtitle', 'agentName', 'agentEmail', 'agentPhone'].map(k => [k, bd[k] ?? ''])),
              terms: bd.terms.map(t => ({ label: t.label, value: t.value })),
              exhibits: ((bd as { exhibits?: LoiExhibit[] }).exhibits ?? []).map((e, i) => ({ id: e.id, label: `EXHIBIT ${exhibitLetter(i)}`, title: e.title, file: e.name })),
              signers: Array.isArray(bd.sellers) ? bd.sellers : [],
              note: 'Edit this with edit_loi (term labels above are the exact ones to use).',
            });
          }
          return j({ id: sub.id, title: sub.title, status: sub.status, deal_id: sub.deal_id, listing_id: sub.listing_id, fields: summarizeFields(sub.values) });
        }
        let q = db.from('crm_form_submissions').select('id, title, status, deal_id, listing_id, updated_at').order('updated_at', { ascending: false }).limit(25);
        q = scoped(q, ctx);
        if (input.deal_id) q = q.eq('deal_id', input.deal_id);
        if (input.listing_id) q = q.eq('listing_id', input.listing_id);
        // Title search: every word must appear (a few words from the name, any order).
        if (input.query) {
          for (const w of String(input.query).split(/\s+/).map(x => x.replace(/[%,()]/g, '')).filter(Boolean).slice(0, 5)) q = q.ilike('title', `%${w}%`);
        }
        const { data, error } = await q;
        return error ? j({ error: error.message }) : j(data ?? []);
      }
      case 'fill_document': {
        const { data: sub } = await db.from('crm_form_submissions').select('id, title, values, business_unit, status, builder_data').eq('id', input.submission_id).maybeSingle();
        if (!sub) return j({ error: 'Document not found' });
        if (ctx.businessUnit && sub.business_unit !== ctx.businessUnit) return j({ error: 'Document is in a different workspace' });
        // A document that has already been executed is a signed record, not a draft.
        if (sub.status === 'executed' || sub.status === 'completed') return j({ error: 'That document is already executed — it can no longer be edited.' });
        // A Letter of Intent is a term list, not fillable blanks — it has its own tool.
        if ((sub.builder_data as { terms?: unknown } | null)?.terms) return j({ error: 'That is a Letter of Intent — use edit_loi to change its terms.' });
        // Out for signature: the signers hold the current PDF; changing it underneath them is how
        // two parties end up signing different documents.
        if (await liveEnvelope(db, String(input.submission_id))) return j({ error: OUT_FOR_SIGNATURE });

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
        // Re-stamp the PDF too, so what gets e-signed matches what the CRM shows.
        let pdf: 'refreshed' | 'not_refreshed' = 'not_refreshed'; let pdfNote: string | undefined;
        if (applied.length) {
          const r = await restampOverlay(db, String(input.submission_id));
          if (r.ok) pdf = 'refreshed'; else pdfNote = r.error;
          await logDocEdit(db, { submissionId: String(input.submission_id), editorId: ctx.userId, unit: sub.business_unit as string | null,
            summary: `Copilot filled: ${applied.slice(0, 4).join('; ')}${applied.length > 4 ? ` (+${applied.length - 4} more)` : ''}`, changes: { kind: 'copilot_fill', applied } });
        }
        await logCopilot(db, ctx, `Filled ${applied.length} field${applied.length === 1 ? '' : 's'} on “${sub.title ?? 'a document'}”`);
        return j({ ok: true, applied, unmatched, pdf, ...(pdfNote ? { pdfNote: `Values saved but the PDF could not be rebuilt (${pdfNote}). The agent can open the document and press Save to refresh it.` } : {}),
          note: unmatched.length ? 'Those field names are not on this document — read_document lists the real ones.' : undefined, submission_id: sub.id });
      }
      case 'edit_loi': {
        const bad = await outOfWorkspace(db, ctx, 'crm_form_submissions', input.submission_id, 'Document'); if (bad) return bad;
        const edit: LoiEdit = {
          setTerms: input.set_terms && typeof input.set_terms === 'object' ? input.set_terms : undefined,
          addTerms: Array.isArray(input.add_terms) ? input.add_terms : undefined,
          removeTerms: Array.isArray(input.remove_terms) ? input.remove_terms.map(String) : undefined,
          fields: input.fields && typeof input.fields === 'object' ? input.fields : undefined,
          sellers: Array.isArray(input.signers) ? input.signers : undefined,
        };
        const r = await editLoi(db, ctx.userId, ctx.businessUnit, String(input.submission_id), edit, ctx.origin ?? 'https://www.fairoaksrealtygroup.com');
        if (!r.ok) return j({ error: r.error });
        await logCopilot(db, ctx, `Edited the Letter of Intent “${r.submission.title ?? ''}” (${r.changes.length} change${r.changes.length === 1 ? '' : 's'})`);
        return j({ ok: true, edited: r.changes, ...(r.unmatched.length ? { notFound: r.unmatched, note: 'Those labels are not on the letter — read_document lists the exact ones.' } : {}), submission_id: r.submission.id,
          note2: 'The letter and its PDF are rebuilt and the agent\u2019s screen refreshes. Nothing was sent for signature.' });
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

/**
 * The confirmation text the agent actually APPROVES. For anything that emails a real person this must show WHO and WHAT —
 * the plain describeWrite only named the subject, so an injected or mistaken draft to the wrong address (or with a
 * different body than the agent read in chat) could be approved blind. Resolves the real recipient from the record and
 * prints the full body. Everything else falls through to describeWrite.
 */
export async function describeWriteRich(name: string, input: Record<string, any>, ctx: AgentCtx): Promise<string> {
  if (name === 'send_email') {
    try {
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const { data: c } = await db.from('crm_clients').select('first_name, last_name, business_name, email, business_unit').eq('id', input.contact_id).maybeSingle();
      if (c && (!ctx.businessUnit || c.business_unit === ctx.businessUnit)) {
        const who = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.business_name || 'contact';
        const body = String(input.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return `📧 Send from your Gmail to ${who} <${c.email ?? 'no email on file'}>\nSubject: ${input.subject}\n\n${body.slice(0, 1200)}${body.length > 1200 ? '…' : ''}`;
      }
    } catch { /* fall through to the generic text */ }
  }
  // Deal writes carry opaque ids: show the agent WHO and WHAT they're approving, and warn about a duplicate up front.
  if (name === 'edit_file') {
    try {
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      let file = 'the file', dealId: string | null = null;
      if (input.attachment_id) file = (await findAttachmentById(db, ctx.userId, String(input.attachment_id)))?.name ?? file;
      else if (input.deal_file_id) { const { data: f } = await db.from('crm_deal_docs').select('name, deal_id').eq('id', input.deal_file_id).maybeSingle(); file = f?.name ?? file; dealId = f?.deal_id ?? null; }
      const lines = ((input.edits ?? []) as Record<string, any>[]).slice(0, 10).map(e => {
        switch (e.op) {
          case 'replace': return `replace “${e.find}” → “${e.replace}”`;
          case 'delete_text': return `delete “${e.find}”`;
          case 'delete_paragraph': return `delete the paragraph containing “${e.containing}”`;
          case 'insert_paragraph': return `add a paragraph${e.after ? ` after “${String(e.after).slice(0, 40)}”` : e.position === 'start' ? ' at the start' : ' at the end'}: “${String(e.text ?? '').slice(0, 80)}”`;
          case 'add_text': return `write “${String(e.text ?? '').slice(0, 60)}”${e.anchor ? ` ${e.placement || 'right'} of “${String(e.anchor).slice(0, 40)}”` : ` at page ${e.page || 1} (${e.x}, ${e.y})`}`;
          case 'remove_text': return `remove “${e.find}”${e.page ? ` on page ${e.page}` : ''}${e.permanent ? ' — PERMANENT (page rebuilt as an image)' : ' — hidden with a white box only (words stay in the file)'}`;
          default: return String(e.op);
        }
      });
      let where = 'the same deal';
      const did = input.deal_id || dealId;
      if (did) { const { data: d } = await db.from('crm_deals').select('client, property').eq('id', did).maybeSingle(); if (d) where = `the deal ${d.client}${d.property ? ` — ${d.property}` : ''}`; }
      else if (input.listing_id) { const { data: l } = await db.from('crm_listings').select('name').eq('id', input.listing_id).maybeSingle(); if (l) where = `the property ${l.name}`; }
      return `✏️ Edit “${file}”:\n${lines.map(l => `  • ${l}`).join('\n')}\nThe edited copy is filed on ${where} as a NEW file — the original stays as it is.`;
    } catch { /* fall through */ }
  }
  if (name === 'attach_exhibit_to_loi') {
    try {
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const { data: sub } = await db.from('crm_form_submissions').select('title, builder_data').eq('id', input.submission_id).maybeSingle();
      const n = ((sub?.builder_data as { exhibits?: unknown[] } | null)?.exhibits ?? []).length;
      let file = 'the file';
      if (input.attachment_id) file = (await findAttachmentById(db, ctx.userId, String(input.attachment_id)))?.name ?? file;
      else if (input.deal_file_id) { const { data: f } = await db.from('crm_deal_docs').select('name').eq('id', input.deal_file_id).maybeSingle(); file = f?.name ?? file; }
      return `📎 Staple “${file}” onto the end of “${sub?.title ?? 'the Letter of Intent'}” as EXHIBIT ${exhibitLetter(n)}${input.title ? ` — ${input.title}` : ''}\nThe letter, its signature page and the exhibit become one PDF, rebuilt now. Nothing is sent for signature.`;
    } catch { /* fall through */ }
  }
  if (name === 'save_attachment') {
    try {
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const att = await findAttachmentById(db, ctx.userId, String(input.attachment_id ?? ''));
      let where = 'the record';
      if (input.deal_id) { const { data: d } = await db.from('crm_deals').select('client, property').eq('id', input.deal_id).maybeSingle(); if (d) where = `the deal ${d.client}${d.property ? ` — ${d.property}` : ''} (Docs tab)`; }
      else if (input.listing_id) { const { data: l } = await db.from('crm_listings').select('name').eq('id', input.listing_id).maybeSingle(); if (l) where = `the property ${l.name} (Documents)`; }
      return `📎 File “${input.name || att?.name || 'the attachment'}” onto ${where}`;
    } catch { /* fall through */ }
  }
  if (name === 'create_deal' || name === 'add_contacts_to_deal' || name === 'remove_contacts_from_deal') {
    try {
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const ids = [...new Set([input.contact_id, input.make_primary_contact_id, ...((input.contact_ids ?? []) as string[]), ...((input.also_contact_ids ?? []) as string[])].filter(Boolean))] as string[];
      const { data: ppl } = ids.length ? await db.from('crm_clients').select('id, first_name, last_name, business_name').in('id', ids) : { data: [] as any[] };
      const nm = (id: string) => { const c = (ppl ?? []).find(x => x.id === id); return c ? contactLabel(c) : 'a contact'; };
      if (name === 'create_deal') {
        const lines = [`🗂 Create a deal in the pipeline`, `  • Client: ${nm(input.contact_id)}`, `  • Type: ${input.type}`, `  • Property: ${input.property || '—'}${input.listing_id ? ' (linked to the property record)' : ''}`,
          `  • Value: ${input.value ? `$${Number(input.value).toLocaleString()}` : '—'}`, `  • Stage: ${input.stage ?? 'Prospect'}`];
        if (input.representation_side) lines.push(`  • We represent: ${input.representation_side}`);
        const extra = ((input.also_contact_ids ?? []) as string[]).map(nm);
        if (extra.length) lines.push(`  • Also tagged: ${extra.join(', ')}`);
        if (input.notes) lines.push(`  • Notes: ${String(input.notes).slice(0, 200)}`);
        const { data: open } = await db.from('crm_deals').select('property, stage').eq('client_id', input.contact_id).not('stage', 'in', '("Closed","Lost")');
        const dup = (open ?? []).filter(d => input.property && samePropertyText(d.property, input.property));
        if (dup.length && input.force !== true) lines.push(`⚠️ ${nm(input.contact_id)} already has an open deal for this property (${dup[0].stage}) — it will NOT be duplicated.`);
        return lines.join('\n');
      }
      const verb = name === 'add_contacts_to_deal' ? 'Add' : 'Remove';
      const who = ((input.contact_ids ?? []) as string[]).map(nm);
      const { data: dl } = await db.from('crm_deals').select('client, property, type, stage').eq('id', input.deal_id).maybeSingle();
      const dealName = dl ? `${dl.client}${dl.property ? ` — ${dl.property}` : ''} (${dl.type}, ${dl.stage})` : 'the deal';
      return `${verb} ${who.join(', ') || 'the contacts'} ${name === 'add_contacts_to_deal' ? 'to' : 'from'} the deal: ${dealName}${input.make_primary_contact_id ? `\nMake ${nm(input.make_primary_contact_id)} the primary client (the current one stays tagged)` : ''}`;
    } catch { /* fall through to the generic text */ }
  }
  return describeWrite(name, input);
}

// A short human-readable summary of a proposed write, for the confirmation prompt.
export function describeWrite(name: string, input: Record<string, any>): string {
  switch (name) {
    case 'create_task': return `Create task “${input.title}”${input.due_date ? ` due ${input.due_date}` : ''}`;
    case 'complete_task': return `Mark task complete`;
    case 'add_note': return `Add a note to the contact: “${input.note}”`;
    case 'update_deal_stage': return `Move the deal to “${input.stage}”`;
    case 'edit_file': return `✏️ Edit the file (${(input.edits ?? []).length} change${(input.edits ?? []).length === 1 ? '' : 's'}) and file the edited copy — the original is not changed`;
    case 'attach_exhibit_to_loi': return `📎 Attach “${input.title || 'the file'}” to the Letter of Intent as an exhibit and rebuild the PDF — nothing is sent for signature`;
    case 'remove_exhibit_from_loi': return `Remove exhibit “${input.exhibit}” from the Letter of Intent and rebuild the PDF`;
    case 'save_attachment': return `Save the attached file${input.name ? ` as “${input.name}”` : ''} to the ${input.deal_id ? 'deal' : 'property'}`;
    case 'create_deal': return `Create a ${input.type} deal${input.property ? ` for ${input.property}` : ''}${input.value ? ` at $${Number(input.value).toLocaleString()}` : ''} (stage ${input.stage ?? 'Prospect'})${(input.also_contact_ids ?? []).length ? ` and tag ${(input.also_contact_ids as string[]).length} other contact${(input.also_contact_ids as string[]).length === 1 ? '' : 's'}` : ''}`;
    case 'add_contacts_to_deal': return `Add ${(input.contact_ids ?? []).length || 1} contact${(input.contact_ids ?? []).length === 1 ? '' : 's'} to the deal${input.make_primary_contact_id ? ' (and make one the primary client)' : ''}`;
    case 'remove_contacts_from_deal': return `Remove ${(input.contact_ids ?? []).length} contact${(input.contact_ids ?? []).length === 1 ? '' : 's'} from the deal`;
    case 'update_deal': return `Update the deal's ${Object.keys(input).filter(k => k !== 'deal_id').map(k => k.replace(/_/g, ' ')).join(', ') || 'details'}`;
    case 'generate_lease': return `Generate & file the lease${input.values?.tenant_name ? ` for ${input.values.tenant_name}${input.values.suite ? `, suite ${input.values.suite}` : ''}` : ''}`;
    case 'start_form': return `Start a new form document`;
    case 'send_for_signature': return `📧 Send for e-signature to ${(input.signers || []).map((s: any) => [s.name, s.email && `<${s.email}>`].filter(Boolean).join(' ')).join(', ')} — this emails them the document`;
    case 'send_email': return `📧 Send the email “${input.subject}” from your Gmail — this emails the contact`;
    case 'schedule_event': return `📅 Add “${input.title}” to your calendar on ${input.date}`;
    case 'create_contact': return `Add contact ${input.business_name || `${input.first_name ?? ''} ${input.last_name ?? ''}`.trim()} (${input.type})`;
    case 'update_contact': return `Update this contact's ${Object.keys(input).filter(k => k !== 'contact_id').join(', ') || 'details'}`;
    case 'create_property': return `Add property “${input.name}”${input.address ? ` — ${input.address}` : ''}${input.asking_price ? ` at $${Number(input.asking_price).toLocaleString()}` : ''}`;
    case 'fill_document': return `Fill in ${Object.keys(input.fields ?? {}).length || 'the'} field${Object.keys(input.fields ?? {}).length === 1 ? '' : 's'} on this document${input.contact_id ? " from the contact's details" : ''}`;
    case 'draft_campaign': return `Save “${input.name}” as an UNSENT draft campaign — nothing is emailed`;
    case 'edit_loi': {
      const lines: string[] = [];
      for (const [k, v] of Object.entries((input.set_terms ?? {}) as Record<string, string>)) lines.push(`${String(k).replace(/:$/, '')} → ${v}`);
      for (const t of (input.add_terms ?? []) as { label: string; value: string }[]) lines.push(`add ${String(t.label).replace(/:$/, '')}: ${t.value}`);
      for (const t of (input.remove_terms ?? []) as string[]) lines.push(`remove ${String(t).replace(/:$/, '')}`);
      for (const [k, v] of Object.entries((input.fields ?? {}) as Record<string, string>)) lines.push(`${k} → ${v}`);
      ((input.signers ?? []) as { entity?: string; signatory?: string }[]).forEach((s, i) => { if (s?.entity) lines.push(`signer ${i + 1} → ${s.entity}`); if (s?.signatory) lines.push(`signatory ${i + 1} → ${s.signatory}`); });
      return `✏️ Edit the Letter of Intent live and rebuild its PDF:\n${lines.slice(0, 12).map(l => `  • ${l}`).join('\n') || '  • (no changes listed)'}\nNothing is sent for signature.`;
    }
    case 'complete_loi': {
      // The agent is approving legal values, so the summary lists the ones THEY
      // supplied verbatim rather than a count — those are the lines that are not
      // standard language and not pulled from a record.
      const given = Object.entries((input.provided ?? {}) as Record<string, string>)
        .filter(([, v]) => String(v ?? '').trim())
        .map(([k, v]) => `${k.replace(/:$/, '')} = ${v}`);
      const where = input.deal_id ? 'on this deal' : input.contact_id ? "on this contact's record" : 'to your documents on the E-Sign page';
      return `📄 Generate the Letter of Intent and file it ${where} as a draft${given.length ? `, with ${given.join('; ')}` : ''} — everything else comes from the records or the standard language. Nothing is sent for signature.`;
    }
    default: return name;
  }
}
