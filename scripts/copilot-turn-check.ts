// End-to-end check of a Copilot TURN (scripts/copilot-eval.ts only checks the first round's tool choice).
// Run after any change to src/lib/copilot-turn.ts, the confirm path, or the stream format:
//
//   set -a; . .env.local; set +a; npx tsx scripts/copilot-turn-check.ts
//
// It runs real turns against the live prompt, tools and database AS THE FIRST SUPER ADMIN, so it needs
// ANTHROPIC_API_KEY and costs a few cents. What it touches:
//   - reads only, by default (no audit rows are written for its tool calls);
//   - with CHECK_WRITES=1 it also confirms ONE throwaway contact ("ZZ Copilot Check …"), asks a follow-up
//     about it, then deletes the contact and the activity line it left.
// Exits 1 on any failure.
import { createClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { runCopilotTurn, runConfirmedWrites, type TurnPayload } from '@/lib/copilot-turn';
import { loadCopilotPrefs } from '@/lib/copilot-prefs';
import { runTool, type AgentCtx } from '@/lib/crm-assistant-tools';
import { encodeEvent, ndjsonParser, CONFIRMED_ID_PREFIX, type CopilotEvent } from '@/lib/copilot-stream';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const textOf = (m: Anthropic.MessageParam | undefined) => (typeof m?.content === 'string' ? m.content : (m?.content ?? []).filter((b): b is Anthropic.TextBlockParam => b.type === 'text').map(b => b.text).join(' '));
/** Every tool_use must be answered by a tool_result in the next message, or the API rejects the whole log. */
function wellFormed(msgs: Anthropic.MessageParam[]): string | null {
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;
    const ids = m.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use').map(b => b.id);
    if (!ids.length) continue;
    const next = msgs[i + 1];
    const answered = new Set(next && next.role === 'user' && typeof next.content !== 'string' ? next.content.filter((b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result').map(b => b.tool_use_id) : []);
    const missing = ids.filter(id => !answered.has(id));
    if (missing.length) return `message ${i} has ${missing.length} tool call(s) with no result`;
  }
  return null;
}

(async () => {
  // 1. The stream format survives being cut anywhere.
  {
    const sent: CopilotEvent[] = [{ t: 'step', label: 'Searching contacts' }, { t: 'text', d: 'Hello — “quoted”\nline two' }, { t: 'round' }, { t: 'done', payload: { messages: [], reply: 'x' } }];
    const wire = sent.map(encodeEvent).join('');
    let allOk = true;
    for (const size of [1, 2, 3, 7, 13, 1000]) {
      const got: CopilotEvent[] = [];
      const p = ndjsonParser(e => got.push(e));
      for (let i = 0; i < wire.length; i += size) p.push(wire.slice(i, i + size));
      p.end();
      if (JSON.stringify(got) !== JSON.stringify(sent)) allOk = false;
    }
    const junk: CopilotEvent[] = [];
    const pj = ndjsonParser(e => junk.push(e)); pj.push('not json\n{"t":"round"}\n{"no":"type"}\n'); pj.end();
    check('stream format: same events whatever the chunk size; junk lines skipped', allOk && junk.length === 1);
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: who } = await db.from('crm_profiles').select('id, first_name').eq('role', 'super_admin').limit(1).single();
  if (!who) { console.log('FAIL no super admin profile found'); process.exit(1); }
  const ctx = { userId: who.id, role: 'super_admin', businessUnit: 'commercial', token: '', origin: 'http://localhost' } as AgentCtx;
  const prefs = await loadCopilotPrefs(db, ctx.userId);
  console.log(`     (saved preferences: ${prefs === null ? 'not switched on — table missing' : `${prefs.length} saved`})`);
  const base = { ctx, db, firstName: who.first_name || 'Zack', open: null, prefs, audit: false as const };

  // 2. A real multi-round turn: progress events arrive, the log is well formed, and later rounds read the conversation from the cache.
  const ask = async (incoming: Anthropic.MessageParam[], cacheConversation: boolean) => {
    const events: CopilotEvent[] = [];
    const usage: Anthropic.Usage[] = [];
    const out = await runCopilotTurn({ ...base, incoming, emit: e => events.push(e), onUsage: (_r, u) => usage.push(u), cacheConversation });
    return { out, events, usage };
  };
  const q: Anthropic.MessageParam[] = [{ role: 'user', content: 'How many open tasks do I have, and which deals are in the pipeline right now? Keep it to a few lines.' }];
  const a = await ask(q, true);
  const steps = a.events.filter(e => e.t === 'step').map(e => (e as { label: string }).label);
  const streamed = a.events.filter(e => e.t === 'text').map(e => (e as { d: string }).d).join('');
  check('turn: tools ran and each announced a step', steps.length > 0, steps.join(' · '));
  check('turn: the reply streamed as text', streamed.trim().length > 20, `${streamed.length} chars in ${a.events.filter(e => e.t === 'text').length} pieces`);
  check('turn: log ends on the assistant and is well formed', a.out.messages[a.out.messages.length - 1]?.role === 'assistant' && !wellFormed(a.out.messages), wellFormed(a.out.messages) ?? '');
  check('turn: nothing was written or queued by a read question', a.out.pendingWrites.length === 0);
  const fmt = (u: Anthropic.Usage[]) => u.map((x, i) => `r${i + 1} new=${x.input_tokens} read=${x.cache_read_input_tokens ?? 0} wrote=${x.cache_creation_input_tokens ?? 0}`).join(' | ');
  console.log(`     tokens, conversation cached:     ${fmt(a.usage)}`);
  const b = await ask(q, false);
  console.log(`     tokens, conversation NOT cached: ${fmt(b.usage)}`);
  if (a.usage.length > 1 && b.usage.length > 1) {
    // In round 2+ the tool results of the earlier rounds are either read back from the cache (marker on) or billed as new input (marker off).
    const later = (u: Anthropic.Usage[]) => u.slice(1).reduce((n, x) => n + x.input_tokens, 0) / (u.length - 1);
    check('cache: later rounds send less uncached input with the conversation marker', later(a.usage) < later(b.usage), `avg new input per later round ${Math.round(later(a.usage))} vs ${Math.round(later(b.usage))}`);
  } else console.log('     (single-round answer — cache comparison skipped)');
  check('cache: the tool list + instructions are read from the cache', (b.usage[0]?.cache_read_input_tokens ?? 0) > 5000, `read ${b.usage[0]?.cache_read_input_tokens ?? 0} on the repeat`);

  // 3. Reads that need no model: an untouched blank is reused, a file link opens, preferences degrade cleanly.
  {
    const { data: blank } = await db.from('crm_form_submissions').select('id, form_id, title').eq('created_by', ctx.userId).eq('status', 'saved').is('filled_path', null).is('builder_data', null).is('deal_id', null).is('listing_id', null).is('client_id', null).eq('values', '[]').limit(1);
    if (blank?.[0]?.form_id) {
      const { count: before } = await db.from('crm_form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', blank[0].form_id);
      const r = JSON.parse(await runTool('start_form', { form_id: blank[0].form_id }, ctx));
      const { count: after } = await db.from('crm_form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', blank[0].form_id);
      check('start_form: reuses an untouched blank instead of adding another', r.reused === true && before === after, `“${blank[0].title}” ${before} → ${after}`);
    } else console.log('     (no untouched unfiled blank to test start_form reuse with)');
    const { data: doc } = await db.from('crm_form_submissions').select('id, title').not('filled_path', 'is', null).eq('business_unit', 'commercial').order('created_at', { ascending: false }).limit(1);
    if (doc?.[0]) {
      const r = JSON.parse(await runTool('get_file_link', { submission_id: doc[0].id }, ctx));
      const head = r.url ? await fetch(r.url, { method: 'GET', headers: { Range: 'bytes=0-7' } }) : null;
      const first = head ? Buffer.from(await head.arrayBuffer()).toString('latin1') : '';
      check('get_file_link: the link opens the PDF', !!r.ok && !!head && head.status < 300 && first.startsWith('%PDF'), `${head?.status} “${String(r.name).slice(0, 50)}”`);
      const none = JSON.parse(await runTool('get_file_link', {}, ctx));
      check('get_file_link: refuses without exactly one file', !!none.error);
    }
    if (prefs === null) {
      const r = JSON.parse(await runTool('save_preference', { text: 'check' }, ctx));
      check('preferences: off cleanly while the table is missing', !!r.error && !/relation|schema|column/i.test(r.error), r.error);
    }
  }

  // 3b. "My tasks" means mine: what I own or am assigned, as the dashboard counts it — never a task I only created for someone else.
  {
    const mineIds = async (ids: string[]) => {
      if (!ids.length) return { own: 0, foreign: 0 };
      const { data } = await db.from('crm_tasks').select('id, agent_id, assigned_to').in('id', ids);
      const own = (data ?? []).filter(t => t.agent_id === ctx.userId || t.assigned_to === ctx.userId).length;
      return { own, foreign: (data ?? []).length - own };
    };
    const mine = JSON.parse(await runTool('list_tasks', {}, ctx));
    const m = await mineIds((mine.tasks as { id: string }[]).map(t => t.id));
    check('list_tasks: every task in "mine" is owned by or assigned to me', m.foreign === 0 && (mine.tasks as { mine: boolean }[]).every(t => t.mine), `${mine.count} mine, ${mine.for_others?.count ?? 0} created for others ${JSON.stringify(mine.for_others?.by_person ?? {})}`);
    const deleg = JSON.parse(await runTool('list_tasks', { scope: 'delegated' }, ctx));
    const d = await mineIds((deleg.tasks as { id: string }[]).map(t => t.id));
    check('list_tasks: "delegated" holds only other people\'s tasks, each with an owner name', d.own === 0 && (deleg.tasks as { owner: string }[]).every(t => t.owner && t.owner !== 'you'), `${deleg.count} delegated`);
    // The dashboard's own number: open tasks I own, dated before today, not call-list calls.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
    const { data: dash } = await db.from('crm_tasks').select('id, type, description, notes, due_date').eq('agent_id', ctx.userId).is('completed_at', null).lt('due_date', today);
    const dashOverdue = (dash ?? []).filter(t => !(t.type === 'call' && /(^|\n)From:\s*\S/.test(`${t.description ?? ''}\n${t.notes ?? ''}`))).length;
    const od = JSON.parse(await runTool('list_tasks', { due: 'overdue' }, ctx));
    check('list_tasks: my overdue count is the dashboard\'s overdue count', od.count === dashOverdue, `copilot ${od.count} vs dashboard rule ${dashOverdue}`);
    const td = JSON.parse(await runTool('list_tasks', { due: 'today' }, ctx));
    console.log(`     due today: ${td.count} mine; created for others: ${JSON.stringify(td.for_others?.by_person ?? {})}`);
  }

  // 4. Confirming a write leaves its real result (and the new id) in the log, and the next turn uses it.
  if (process.env.CHECK_WRITES === '1') {
    const name = `ZZ Copilot Check ${Date.now().toString(36)} LLC`;
    let createdId: string | undefined;
    try {
      // A real turn queues the write, so the log that gets confirmed is the real shape (thinking blocks and all), not a hand-built one.
      const asked = await runCopilotTurn({ ...base, incoming: [{ role: 'user', content: `Add a new buyer contact for the company “${name}”. There is no person's name, email or phone — just the company.` }] });
      check('queue: one create_contact is waiting on the card, nothing ran', asked.pendingWrites.length === 1 && asked.pendingWrites[0].name === 'create_contact', asked.pendingWrites.map(w => w.name).join(', ') || `said: ${asked.reply.slice(0, 140)}`);
      const queued = asked.messages;
      const done: TurnPayload = await runConfirmedWrites({ ctx, incoming: queued, confirm: asked.pendingWrites.map(w => w.id), audit: false });
      const use = done.messages.flatMap(m => (typeof m.content === 'string' ? [] : m.content)).find((x): x is Anthropic.ToolUseBlockParam => x.type === 'tool_use' && x.id.startsWith(CONFIRMED_ID_PREFIX));
      const res = done.messages.flatMap(m => (typeof m.content === 'string' ? [] : m.content)).find((x): x is Anthropic.ToolResultBlockParam => x.type === 'tool_result' && x.tool_use_id === use?.id);
      try { createdId = JSON.parse(String(res?.content ?? '{}')).created?.id; } catch { /* checked below */ }
      check('confirm: ran, and the log holds the call with its real result', done.confirmed[0]?.ok === true && !!use && !!createdId && !wellFormed(done.messages), done.reply);
      check('confirm: the log still ends with the ✓ line', textOf(done.messages[done.messages.length - 1]).startsWith('✓'));
      const twice = await runConfirmedWrites({ ctx, incoming: queued, confirm: ['not-a-ticket'], audit: false });
      check('confirm: a bad ticket runs nothing', twice.confirmed[0]?.ok === false && !twice.messages.some(m => typeof m.content !== 'string' && m.content.some(x => x.type === 'tool_use' && x.id.startsWith(CONFIRMED_ID_PREFIX))));
      if (createdId) {
        const follow = await runCopilotTurn({ ...base, incoming: [...done.messages, { role: 'user', content: 'open that contact' }] });
        const opened = follow.clientActions.find(x => x.type === 'open-record');
        check('follow-up: "open that contact" opens the record the confirm just made', !!opened && opened.type === 'open-record' && opened.id === createdId, opened ? `${opened.type} ${'id' in opened ? opened.id : ''}` : `no open-record; said: ${follow.reply.slice(0, 120)}`);
      }
    } finally {
      if (createdId) await db.from('crm_clients').delete().eq('id', createdId);
      await db.from('crm_activity').delete().eq('type', 'copilot').like('notes', '%ZZ Copilot Check%');
      const { count } = await db.from('crm_clients').select('id', { count: 'exact', head: true }).ilike('business_name', 'ZZ Copilot Check%');
      check('cleanup: no throwaway contact left behind', count === 0, `${count} left`);
    }
  } else console.log('     (CHECK_WRITES=1 not set — the confirm-and-follow-up check was skipped)');

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('script error:', e); process.exit(1); });
