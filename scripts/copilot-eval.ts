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
import { TOOLS, type AgentCtx } from '@/lib/crm-assistant-tools';

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

(async () => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const names = new Set(TOOLS.map(t => t.name));
  let failed = 0;
  for (const c of cases) {
    const ctx = ctxFor(c.role ?? 'super_admin');
    const res = await client.messages.create({ model: MODEL, max_tokens: 1500, system: systemPrompt(ctx, 'Zack', null), tools: TOOLS, messages: c.history });
    const called = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use').map(b => b.name);
    const said = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join(' ');
    const problems: string[] = [];
    for (const n of called) if (!names.has(n)) problems.push(`called a tool that does not exist: ${n}`);
    if (c.anyOf && !c.anyOf.some(n => called.includes(n))) problems.push(`wanted one of [${c.anyOf.join(', ')}], got [${called.join(', ') || 'no tool'}]`);
    for (const n of c.never ?? []) if (called.includes(n)) problems.push(`must not call ${n}`);
    if (c.noTools && called.length) problems.push(`wanted no tool, got [${called.join(', ')}]`);
    if (c.say && !called.length && !c.say.test(said)) problems.push(`reply doesn't match ${c.say}`);
    if (c.say && called.length && c.noTools && !c.say.test(said)) problems.push(`reply doesn't match ${c.say}`);
    if (c.notSay && c.notSay.test(said)) problems.push(`reply matches forbidden ${c.notSay}`);
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.name}${problems.length ? '\n       ' + problems.join('\n       ') + `\n       called: [${called.join(', ')}]\n       said: ${said.slice(0, 300)}` : ''}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
})();
