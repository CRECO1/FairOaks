// Regression check for the in-CRM Copilot's prompt + tool choice. Run after ANY change to src/lib/crm-assistant-prompt.ts
// or the tool descriptions in src/lib/crm-assistant-tools.ts:
//
//   set -a; . .env.local; set +a; npx tsx scripts/copilot-eval.ts
//
// Plays scripted agent messages against the real system prompt and tool list (needs ANTHROPIC_API_KEY; a few cents) and
// checks the FIRST round only: which tools the model reaches for, which it must never touch, and what it says when it
// calls none. No tool is executed and nothing is written. Exits 1 on any failure.
import Anthropic from '@anthropic-ai/sdk';
import { systemPrompt } from '@/lib/crm-assistant-prompt';
import { TOOLS, DRIVE_TOOLS, canUseDrive, type AgentCtx } from '@/lib/crm-assistant-tools';

const MODEL = process.env.CRM_ASSISTANT_MODEL || 'claude-sonnet-5';
const ctxFor = (role: string): AgentCtx => ({ userId: '00000000-0000-0000-0000-000000000000', role, businessUnit: 'commercial', token: '', origin: 'http://localhost' }) as AgentCtx;

type Msg = Anthropic.MessageParam;
const U = (text: string): Msg => ({ role: 'user', content: text });
const A = (text: string): Msg => ({ role: 'assistant', content: text });
/** An earlier tool round, replayed so the model sees what it already did. */
const tool = (id: string, name: string, input: unknown, result: unknown): Msg[] => [
  { role: 'assistant', content: [{ type: 'tool_use', id, name, input: input as Record<string, unknown> }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(result) }] },
];

const SEND_TOOLS = ['send_for_signature', 'send_email'];
const PREPPED = [
  U('prep the Findley lease for signature'),
  ...tool('t1', 'prepare_esign', { submission_id: 'sub-1', signers: [{ role: 'client', contact_id: 'c-1' }] },
    { ok: true, sent: false, submission_id: 'sub-1', pages: 7, tally: [{ role: 'client', initials: 7, signatures: 1, dates: 1 }], warnings: [], signers: [{ role: 'client', name: 'Diana Findley', email: 'dfindleyrn@gmail.com' }], missing_email_for: [], next: 'Prepared, NOT sent.' }),
  A('The Findley lease is READY and NOT SENT: initials on all 7 pages plus a signature and date for Diana Findley. Tell me when you want it sent.'),
];

interface Case {
  name: string; role?: string; history: Msg[];
  /** at least one of these tools is called in round one */ anyOf?: string[];
  /** none of these may be called */ never?: string[];
  /** inspect the tool inputs of round one; return a problem string or null */ check?: (calls: Anthropic.ToolUseBlock[]) => string | null;
  /** no tool at all, and the reply must match */ noTools?: boolean; say?: RegExp; notSay?: RegExp;
}

const cases: Case[] = [
  { name: 'prep a lease: looks the deal up, never sends', history: [U('prep the Findley lease for signature')], anyOf: ['list_deals', 'read_document', 'get_deal', 'search_contacts'], never: [...SEND_TOOLS, 'prepare_esign'] },
  { name: '"get it ready" is not a send', history: [U('get the Montego listing agreement ready to send to Raj')], anyOf: ['read_document', 'prepare_esign', 'list_deals', 'search_contacts'], never: SEND_TOOLS },
  { name: 'vague "go ahead" after a prep does NOT send', history: [...PREPPED, U('go ahead')], never: ['send_for_signature'], say: /\?|send/i },
  { name: 'vague "do it" after a prep does NOT send', history: [...PREPPED, U('do it')], never: ['send_for_signature'] },
  { name: 'explicit "send it" after a prep queues the send', history: [...PREPPED, U('send it to Diana')], anyOf: ['send_for_signature'] },
  { name: '"did Raj sign?" reads e-sign status', history: [U('did Raj sign the Montego lease yet?')], anyOf: ['esign_status'], never: SEND_TOOLS },
  { name: '"what is still out for signature" reads status', history: [U("what's still out for signature?")], anyOf: ['esign_status'] },
  { name: 'void request: no invented tool, nothing sent or edited', history: [U('void the Montego lease signature request')], never: [...SEND_TOOLS, 'fill_document', 'prepare_esign'] },
  { name: '"where is the Findley deal" opens it', history: [U('where is the Diana Findley deal?')], anyOf: ['open_record', 'list_deals', 'search_contacts'] },
  { name: 'agent asks to send a campaign: no activation', role: 'agent', history: [U('send the Quarterly Market Report campaign to everyone now')], never: ['draft_campaign', 'enroll_campaign_contacts', ...SEND_TOOLS], say: /Zack|broker|only|can.?t|cannot/i },
  { name: 'agent asks for a new campaign: drafts it', role: 'agent', history: [U('create an email campaign announcing the new warehouse at 1353 W French Pl to my buyer contacts')], anyOf: ['draft_campaign', 'count_audience', 'find_property', 'list_properties', 'list_campaign_projects'], never: SEND_TOOLS },
  { name: 'reminder -> create_task', history: [U('remind me Friday to call Lloyd Pearson about the warehouse')], anyOf: ['create_task', 'search_contacts'] },
  { name: 'email a doc to a contact queues send_email (reviewable)', history: [U('email Diana Findley the lease and ask her to sign this week')], anyOf: ['search_contacts', 'read_document', 'send_email', 'list_deals'] },
  { name: 'unknown legal value is not invented', history: [U('fill in the security deposit on the Findley lease')], never: ['fill_document'], say: /\?|how much|amount|what/i },
  { name: 'LOI term change uses edit_loi path (reads first)', history: [U('change the price on the Chestnut LOI to $1.2M')], anyOf: ['read_document'], never: ['fill_document', 'send_for_signature'] },
];

const FOUND = tool('t9', 'search_contacts', { query: 'Brian Robert' },
  { contacts: [{ id: 'c-b', first_name: 'Brian', last_name: 'Blanco', email: 'brian@crecotx.com', type: 'Agent' }, { id: 'c-r', first_name: 'Robert', last_name: 'Stovall', email: 'robert@crecotx.com', type: 'Agent' }] });
const sched = (calls: Anthropic.ToolUseBlock[]) => calls.filter(c => c.name === 'schedule_event').map(c => c.input as Record<string, any>);
const inviteCheck = (n: number, hhmm: RegExp) => (calls: Anthropic.ToolUseBlock[]) => {
  const ev = sched(calls);
  if (ev.length < n) return `wanted ${n} schedule_event call(s), got ${ev.length}`;
  for (const e of ev) {
    const guests: string[] = (e.attendees ?? []).map((a: string) => a.toLowerCase());
    if (!guests.includes('brian@crecotx.com') || !guests.includes('robert@crecotx.com')) return `attendees missing Brian/Robert: ${JSON.stringify(e.attendees)}`;
    if (!e.time || !hhmm.test(String(e.time))) return `no usable time on "${e.title}": ${JSON.stringify(e.time)}`;
  }
  return null;
};
cases.push(
  { name: 'calendar invite request: looks up guests, never emails a stand-in', history: [U('send Brian and Robert a calendar invite for the property tour tomorrow at 1:30 PM at 4946 Center Park Blvd')], anyOf: ['search_contacts', 'schedule_event'], never: ['send_email', 'create_task'] },
  { name: 'guests found: one timed schedule_event with both attendees + location', history: [U('send Brian and Robert a calendar invite for the property tour on 2026-11-03 at 1:30 PM at 4946 Center Park Blvd'), ...FOUND], anyOf: ['schedule_event'], never: ['send_email'], check: c => inviteCheck(1, /^(13:30|1:30\s*PM)$/i)(c) ?? (sched(c)[0].location ? null : 'no location passed') },
  { name: 'meeting with a tenant: finds them, invites by calendar, no email stand-in', history: [U('set up a meeting with Lloyd Pearson, the tenant rep, Thursday 2026-11-05 at 10 AM at 8000 Fair Oaks Pkwy')], anyOf: ['search_contacts', 'schedule_event'], never: ['send_email', 'create_task'] },
  { name: 'landlord walkthrough: timed event with the landlord as attendee', history: [U('book a walkthrough with Nita Parikh on 2026-11-05 at 3 PM at 4946 Center Park Blvd and send her the invite'), ...tool('t8', 'search_contacts', { query: 'Nita Parikh' }, { contacts: [{ id: 'c-n', first_name: 'Nita', last_name: 'Parikh', email: 'nitaparikh@marutius.com', type: 'Landlord/Investor' }] })], anyOf: ['schedule_event'], never: ['send_email'], check: c => { const e = sched(c)[0]; return !e ? 'no schedule_event' : !(e.attendees ?? []).map((a: string) => a.toLowerCase()).includes('nitaparikh@marutius.com') ? `landlord not invited: ${JSON.stringify(e.attendees)}` : !e.time ? 'no time' : null; } },
  { name: '"confirm the meeting with" is a calendar invite, not an email', history: [U('confirm our 11:30 team meeting tomorrow 2026-11-04 at Fair Oaks Country Club with Brian and Robert'), ...FOUND], anyOf: ['schedule_event'], never: ['send_email'], check: inviteCheck(1, /11:30|11:30\s*AM/i) },
  { name: 'tour + lunch = two separate timed events', history: [U('invite Brian and Robert to the tour at 1:30 PM and lunch at 11:30 AM, both on 2026-11-03, tour at 4946 Center Park Blvd, lunch at Fair Oaks Country Club'), ...FOUND], anyOf: ['schedule_event'], never: ['send_email'], check: inviteCheck(2, /^(\d{1,2}:\d{2})/) },
);

const DRIVE_LOOK = tool('t7', 'find_drive_items', {}, { all_folders: [{ id: 'f-1', path: 'BOVs' }], showing: 'top level', folders: [{ id: 'f-1', name: 'BOVs', visibility: 'team' }], documents: [], files: [], forms: [] })
// The model also searches for an existing doc before writing a new one (that is what the tool description asks for) — replay both lookups.
const DRIVE_SEARCHED = tool('t6', 'find_drive_items', { query: 'onboarding' }, { query: 'onboarding', folders: [], documents: [], files: [], forms: [] });
const DEAL_LOOK = tool('t5', 'get_deal', { deal_id: '88f2a920-4f96-4178-99e6-b78b5a89f1c2' }, { id: '88f2a920-4f96-4178-99e6-b78b5a89f1c2', client: 'Nita Parikh', property: '4946 Center Park Blvd', stage: 'Prospect', type: 'Landlord Listing' });
const DOC_FOUND = tool('t8', 'find_drive_items', { query: 'tour recap' }, { query: 'tour recap', folders: [], documents: [{ id: '6f1d2c3e-0000-4000-8000-000000000001', title: 'Elkhorn tour recap', updated_at: '2026-11-02T15:00:00Z' }], files: [], forms: [] });
const DOC_READ = tool('t9', 'read_drive_doc', { doc_id: '6f1d2c3e-0000-4000-8000-000000000001' }, { title: 'Elkhorn tour recap', words: 24, text: 'Elkhorn tour recap\nThe tour is at 10 am on Friday.\nBring the survey\nBring the county summary\nRent is $13/SF NNN.' });
cases.push(
  { name: 'My Drive: "write a checklist doc" looks first, never sends or starts a form', history: [U('create a new-agent onboarding checklist in My Drive in a folder called Agent Training')], anyOf: ['find_drive_items', 'create_drive_doc'], never: [...SEND_TOOLS, 'start_form', 'create_task'] },
  { name: 'My Drive: after the look, creates the doc with real markdown content', history: [U('create a new-agent onboarding checklist in My Drive in a folder called Agent Training'), ...DRIVE_LOOK, ...DRIVE_SEARCHED], anyOf: ['create_drive_doc'], never: [...SEND_TOOLS, 'start_form'], check: c => { const d = c.find(x => x.name === 'create_drive_doc'); const i = (d?.input ?? {}) as Record<string, any>; return !i.title ? 'no title' : String(i.content ?? '').length < 200 ? 'content too thin' : !/- \[ \]/.test(String(i.content)) ? 'no checklist items in a checklist' : !/agent training/i.test(String(i.folder_path ?? '')) ? `wrong folder: ${i.folder_path}` : null; } },
  { name: 'My Drive: a legal contract goes through forms, not a Drive doc', history: [U('make me a commercial lease agreement for Acme Corp')], never: ['create_drive_doc'] },
  { name: 'My Drive: a doc about a deal is put on that deal card', history: [U('write a short tour recap doc for deal 88f2a920-4f96-4178-99e6-b78b5a89f1c2 (4946 Center Park Blvd) and show it on that deal card. Tour is tomorrow at 10am, bring the survey and the county summary'), ...DEAL_LOOK, ...DRIVE_LOOK, ...DRIVE_SEARCHED], anyOf: ['create_drive_doc'], never: [...SEND_TOOLS, 'start_form'], check: c => { const d = c.find(x => x.name === 'create_drive_doc'); const i = (d?.input ?? {}) as Record<string, any>; return i.deal_id !== '88f2a920-4f96-4178-99e6-b78b5a89f1c2' ? `deal_id not passed: ${i.deal_id}` : null; } },
  { name: 'My Drive: edit an existing doc reads it first, never makes a new one', history: [U('add a Parking section to the Elkhorn tour recap doc: 40 spaces, 2 handicap'), ...DOC_FOUND], anyOf: ['read_drive_doc', 'edit_drive_doc'], never: [...SEND_TOOLS, 'create_drive_doc', 'start_form'] },
  { name: 'My Drive: after reading, appends the section (no rewrite)', history: [U('add a Parking section to the Elkhorn tour recap doc: 40 spaces, 2 handicap'), ...DOC_FOUND, ...DOC_READ], anyOf: ['edit_drive_doc'], never: [...SEND_TOOLS, 'create_drive_doc'], check: c => { const d = c.find(x => x.name === 'edit_drive_doc'); const i = (d?.input ?? {}) as Record<string, any>; return i.op !== 'append' ? `op was ${i.op}, wanted append` : !/parking/i.test(String(i.content ?? '')) ? 'content lacks the Parking section' : null; } },
  { name: 'My Drive: replace one passage with the exact quoted words', history: [U('change the tour time in the Elkhorn tour recap doc to 2 pm Monday'), ...DOC_FOUND, ...DOC_READ], anyOf: ['edit_drive_doc'], never: [...SEND_TOOLS, 'create_drive_doc'], check: c => { const d = c.find(x => x.name === 'edit_drive_doc'); const i = (d?.input ?? {}) as Record<string, any>; return i.op !== 'replace_text' ? `op was ${i.op}, wanted replace_text` : !String(i.find ?? '').includes('10 am') ? `find does not quote the doc: ${i.find}` : null; } },
  { name: 'My Drive: a vague "make it better" is not an edit', history: [U('make the Elkhorn tour recap doc better'), ...DOC_FOUND], never: [...SEND_TOOLS, 'create_drive_doc', 'edit_drive_doc'] },
  { name: 'My Drive: an agent can use it too (looks first, never sends)', role: 'agent', history: [U('put a leasing script doc in My Drive for the team')], anyOf: ['find_drive_items', 'create_drive_doc'], never: [...SEND_TOOLS, 'start_form'] },
);

(async () => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const names = new Set(TOOLS.map(t => t.name));
  let failed = 0;
  // EVAL_ONLY=<text in a case name> EVAL_REPEAT=<n> re-runs just those cases n times (the model is not deterministic: a single failure may be noise).
  const only = process.env.EVAL_ONLY, rep = Math.max(1, Number(process.env.EVAL_REPEAT ?? 1));
  const run = (only ? cases.filter(c => c.name.includes(only)) : cases).flatMap(c => Array.from({ length: rep }, () => c));
  for (const c of run) {
    const ctx = ctxFor(c.role ?? 'super_admin');
    const res = await client.messages.create({ model: MODEL, max_tokens: 1500, system: systemPrompt(ctx, 'Zack', null), tools: TOOLS.filter(t => !DRIVE_TOOLS.has(t.name) || canUseDrive(ctx)), messages: c.history });
    const called = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use').map(b => b.name);
    const said = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join(' ');
    const problems: string[] = [];
    for (const n of called) if (!names.has(n)) problems.push(`called a tool that does not exist: ${n}`);
    if (c.anyOf && !c.anyOf.some(n => called.includes(n))) problems.push(`wanted one of [${c.anyOf.join(', ')}], got [${called.join(', ') || 'no tool'}]`);
    for (const n of c.never ?? []) if (called.includes(n)) problems.push(`must not call ${n}`);
    if (c.noTools && called.length) problems.push(`wanted no tool, got [${called.join(', ')}]`);
    if (c.say && !called.length && !c.say.test(said)) problems.push(`reply doesn't match ${c.say}`);
    if (c.say && called.length && c.noTools && !c.say.test(said)) problems.push(`reply doesn't match ${c.say}`);
    if (c.check) { const pr = c.check(res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')); if (pr) problems.push(pr); }
    if (c.notSay && c.notSay.test(said)) problems.push(`reply matches forbidden ${c.notSay}`);
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.name}${problems.length ? '\n       ' + problems.join('\n       ') + `\n       called: [${called.join(', ')}]\n       said: ${said.slice(0, 300)}` : ''}`);
  }
  console.log(`\n${run.length - failed}/${run.length} passed`);
  process.exit(failed ? 1 : 0);
})();
