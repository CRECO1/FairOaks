// One Copilot turn: the Claude tool-use loop and the confirm-and-run path.
//
// This lives in lib (not in the route) so that /api/crm/assistant and the check script in
// scripts/copilot-turn-check.ts run exactly the same code: the route adds auth, rate limits and
// the HTTP response around it and nothing else.
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendGuard, TOOLS, WRITE_TOOLS, CLIENT_TOOLS, DRIVE_TOOLS, DRIVE_WRITE_TOOLS, PREF_TOOLS, canUseDrive, resolveRecord, DOC_EDIT_TOOLS, DEAL_WRITE_TOOLS, CONTACT_WRITE_TOOLS, runTool, precheckWrite, describeWrite, describeWriteRich, resolveNav, type AgentCtx, type NavTarget } from '@/lib/crm-assistant-tools';
import { systemPrompt } from '@/lib/crm-assistant-prompt';
import { signPendingWrite, verifyPendingWrite, consumePendingWrite } from '@/lib/copilot-confirm';
import { WEB_TOOLS, compactWebTurns } from '@/lib/copilot-web';
import { hydrateAttachments } from '@/lib/copilot-attachments';
import { stepLabel, CONFIRMED_ID_PREFIX, type CopilotEvent } from '@/lib/copilot-stream';

export const COPILOT_MODEL = process.env.CRM_ASSISTANT_MODEL || 'claude-sonnet-5';
/** How many queued actions one Confirm click may run. The card shows every one of them, so this is a size cap, not a safety gate. */
export const MAX_CONFIRM = 12;
const MAX_ROUNDS = 8;

/** A UI directive for the browser: navigate, or reload something the Copilot just changed. */
export type ClientAction = { type: 'navigate'; page: string; tab?: string; label: string } | { type: 'open-record'; kind: 'deal' | 'contact'; id: string; tab?: string; label: string } | { type: 'doc-updated'; submissionId: string } | { type: 'refresh'; scope: 'deals' | 'contacts' | 'drive' };
export type OpenDoc = { submissionId: string; title: string; kind: 'loi' | 'form' };
export interface TurnPayload {
  messages: Anthropic.MessageParam[];
  reply: string;
  pendingWrites: { id: string; name: string; summary: string }[];
  clientActions: ClientAction[];
  confirmed: { summary: string; ok: boolean; error?: string }[];
}

interface Common {
  /** The agent, with their bearer token and the app origin so tools can call the CRM's own routes as them. */
  ctx: AgentCtx;
  incoming: Anthropic.MessageParam[];
  /** The live request, for the audit row's IP and user agent. */
  req?: NextRequest;
  /** false = no audit rows (the check script must not show up as the agent's activity). */
  audit?: boolean;
}

/**
 * Per-tool-call oversight trail.
 *
 * Records WHAT the copilot was asked to do on someone's behalf, not what they typed:
 * free-text arguments (email bodies, campaign copy, notes) are reduced to a field
 * name and a length, while ids, names and flags are kept so the row is still useful
 * for "which contact did that touch". Best-effort — it never blocks a tool.
 */
const BULK_TEXT_ARGS = new Set(['body', 'email_body', 'note', 'notes', 'message', 'prompt', 'description', 'highlights', 'values', 'fields', 'content', 'text']);

function safeArgs(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (BULK_TEXT_ARGS.has(k)) {
      out[k] = typeof v === 'string' ? `<${v.length} chars>`
        : Array.isArray(v) ? `<${v.length} items>`
        : v && typeof v === 'object' ? `<${Object.keys(v).length} fields: ${Object.keys(v).slice(0, 12).join(', ')}>`
        : v;
    } else if (typeof v === 'string' && v.length > 200) {
      out[k] = `${v.slice(0, 200)}…`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function logToolCall(c: Common, tool: string, input: Record<string, unknown>, outcome: 'executed' | 'queued_for_confirmation' | 'rejected_precheck', result?: string) {
  if (c.audit === false) return;
  let ok: boolean | undefined;
  let error: string | undefined;
  if (result) {
    try { const parsed = JSON.parse(result); if (parsed && typeof parsed === 'object') { ok = !parsed.error; if (parsed.error) error = String(parsed.error).slice(0, 200); } }
    catch { /* non-JSON result — leave ok undefined */ }
  }
  // Loaded on demand: lib/audit is server-only, and the check script (audit: false) runs this file outside Next.
  const { writeAuditLog } = await import('@/lib/audit');
  await writeAuditLog({
    actorId: c.ctx.userId,
    action: 'copilot_tool',
    targetType: tool,
    targetId: (input?.contact_id ?? input?.deal_id ?? input?.listing_id ?? input?.submission_id ?? input?.task_id ?? undefined) as string | undefined,
    metadata: { tool, outcome, write: WRITE_TOOLS.has(tool), args: safeArgs(input), role: c.ctx.role, business_unit: c.ctx.businessUnit, ...(ok !== undefined ? { ok } : {}), ...(error ? { error } : {}) },
    req: c.req,
  });
}

/** The text of the agent's newest typed message (tool results and attachments don't count). */
function lastUserText(msgs: Array<{ role: string; content: unknown }>): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const text = Array.isArray(m.content) ? (m.content as Array<{ type?: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text ?? '').join(' ') : '';
    if (text.trim()) return text;
  }
  return '';
}

// ── What a confirmed write leaves in the conversation ───────────────────────────
// The agent's click runs the action without the model, so the model used to learn nothing about it: the
// new record's id never reached the conversation, and "fill it in" or "open it" on the next turn had to
// guess which record was meant. A confirmed write is now appended as a real tool call with its real
// result, so the ids are there to use. Both are kept small, because the chat log is replayed every turn.

/** The call, as history: long text is already in the queued call just above, so it is not repeated. */
function historyInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (typeof v === 'string' && v.length > 600) out[k] = `${v.slice(0, 200)}… (${v.length} characters; the full text is in the queued call above)`;
    else if (v && typeof v === 'object' && JSON.stringify(v).length > 1500) out[k] = '(as in the queued call above)';
    else out[k] = v;
  }
  return out;
}

/** The result, as history: ids, names and short facts are kept; anything bulky is dropped. */
function historyResult(raw: string): string {
  if (raw.length <= 2500) return raw;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p ?? {})) {
      if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string') out[k] = v.length > 300 ? `${v.slice(0, 300)}…` : v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        const kept: Record<string, unknown> = {};
        for (const f of ['id', 'title', 'name', 'status', 'deal_id', 'listing_id', 'client_id']) if (typeof o[f] === 'string') kept[f] = o[f];
        if (Object.keys(kept).length) out[k] = kept;
      }
    }
    return JSON.stringify(out);
  } catch { return raw.slice(0, 2500); }
}


/**
 * Run the writes the agent just confirmed. They run from the ticket, not from the model: replaying the
 * approved call is the whole point — the agent read a summary, and this executes exactly the call that
 * summary described. Confirming is a button, not a question, so the model is not asked again.
 */
export async function runConfirmedWrites(c: Common & { confirm: unknown[] }): Promise<TurnPayload> {
  const confirmed: TurnPayload['confirmed'] = [];
  const clientActions: ClientAction[] = [];
  const uses: Anthropic.ToolUseBlockParam[] = [];
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const token of c.confirm.slice(0, MAX_CONFIRM)) {
    const call = verifyPendingWrite(token, c.ctx);
    if (!call) { confirmed.push({ summary: 'One action could not be confirmed', ok: false, error: 'That confirmation expired or was not valid — ask me again.' }); continue; }
    // Single-use: a replayed confirm must not run an outward action a second time.
    if (!(await consumePendingWrite(call.nonce))) { confirmed.push({ summary: 'One action was not run', ok: false, error: 'That confirmation was already used — ask me again if you want it done again.' }); continue; }
    const summary = describeWrite(call.name, call.input);
    const result = await runTool(call.name, call.input, c.ctx);
    await logToolCall(c, call.name, call.input, 'executed', result);
    let err: string | undefined;
    try {
      const p = JSON.parse(result);
      if (p?.error) err = String(p.error);
      // A document edit just landed: tell the browser so an open editor reloads it live.
      else if (DOC_EDIT_TOOLS.has(call.name) && typeof p?.submission_id === 'string') clientActions.push({ type: 'doc-updated', submissionId: p.submission_id });
      // The CRM loads deals/contacts once; without this a deal the copilot just created isn't in the pipeline until a reload.
      else if (DEAL_WRITE_TOOLS.has(call.name)) clientActions.push({ type: 'refresh', scope: 'deals' });
      else if (CONTACT_WRITE_TOOLS.has(call.name)) clientActions.push({ type: 'refresh', scope: 'contacts' });
      // A document or folder just landed in My Drive: reload it if it is on screen.
      else if (DRIVE_WRITE_TOOLS.has(call.name)) clientActions.push({ type: 'refresh', scope: 'drive' });
    } catch { /* non-JSON */ }
    confirmed.push({ summary, ok: !err, error: err });
    const id = `${CONFIRMED_ID_PREFIX}${crypto.randomBytes(12).toString('hex')}`;
    uses.push({ type: 'tool_use', id, name: call.name, input: historyInput(call.input) });
    results.push({ type: 'tool_result', tool_use_id: id, content: historyResult(result) });
  }
  if (c.confirm.length > MAX_CONFIRM) {
    const left = c.confirm.length - MAX_CONFIRM;
    confirmed.push({ summary: `${left} more action${left === 1 ? ' was' : 's were'} not run`, ok: false, error: `I run up to ${MAX_CONFIRM} at a time — ask me for the rest.` });
  }
  const reply = confirmed.map(x => (x.ok ? `✓ ${x.summary}` : `⚠ ${x.summary} — ${x.error ?? 'did not go through'}`)).join('\n');
  const messages: Anthropic.MessageParam[] = [
    ...c.incoming,
    ...(uses.length ? [{ role: 'assistant' as const, content: uses }, { role: 'user' as const, content: results }] : []),
    { role: 'assistant', content: [{ type: 'text', text: reply }] },
  ];
  return { messages, reply, pendingWrites: [], clientActions, confirmed };
}

/**
 * Cache the conversation so far. Every round of a turn re-sends the whole history, and the next turn sends
 * it again: a marker on the last block lets rounds 2+ and the follow-up question read it back at the cache
 * rate. Applied to the copy that goes to the model only — the stored history never carries the marker.
 */
function withCacheTail(msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user') return msgs;   // a paused assistant turn goes back untouched
  const content: Anthropic.ContentBlockParam[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content];
  const i = content.length - 1;
  const b = content[i];
  if (!b) return msgs;
  if (b.type === 'text') { if (!b.text.trim()) return msgs; content[i] = { ...b, cache_control: { type: 'ephemeral' } }; }
  else if (b.type === 'tool_result' || b.type === 'image' || b.type === 'document') content[i] = { ...b, cache_control: { type: 'ephemeral' } };
  else return msgs;
  return [...msgs.slice(0, -1), { ...last, content }];
}

/** A turn cut off mid tool call leaves a tool_use with no result, which the API rejects on every later request. Drop those calls. */
function dropUnansweredToolUse(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || typeof last.content === 'string') return messages;
  if (!last.content.some(b => b.type === 'tool_use')) return messages;
  const kept = last.content.filter(b => b.type !== 'tool_use');
  return [...messages.slice(0, -1), { role: 'assistant', content: kept.length ? kept : [{ type: 'text', text: '(stopped before finishing)' }] }];
}

export interface TurnArgs extends Common {
  db: SupabaseClient;
  firstName: string;
  open: OpenDoc | null;
  /** The agent's standing preferences; null when the feature is not set up, which also hides its tools. */
  prefs: string[] | null;
  /** Progress while the turn runs. */
  emit?: (e: CopilotEvent) => void;
  /** Aborted when the browser goes away, so a turn nobody is waiting for stops spending. */
  signal?: AbortSignal;
  /** Token usage per round, for the check script. */
  onUsage?: (round: number, usage: Anthropic.Usage) => void;
  /** Check-script switch: false sends the history without its cache marker, to measure what the marker saves. */
  cacheConversation?: boolean;
}

export async function runCopilotTurn(a: TurnArgs): Promise<TurnPayload> {
  const { ctx, db } = a;
  const emit = a.emit ?? (() => { /* nobody listening */ });
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [...a.incoming];
  // Attached files are stored as small references in the chat; they're turned into real content for the model
  // on each call (and only the caller's own files, newest few). `messages` itself stays reference-only so the
  // history returned to the browser never carries file bytes.
  const attachmentCache = new Map<string, { parts: Anthropic.ContentBlockParam[]; bytes: number }>();
  const pendingWrites: TurnPayload['pendingWrites'] = [];
  const clientActions: ClientAction[] = [];

  // The prompt + tool list are ~35k tokens and a turn makes several calls in a row. Two markers: one after the tool
  // definitions, which are the same for every agent and every screen, and one after the system prompt, which names the
  // agent and the document they have open. So switching documents (or agents) re-reads the tools instead of re-writing them.
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: systemPrompt(ctx, a.firstName || 'the agent', a.open, a.prefs), cache_control: { type: 'ephemeral' } }];
  const own = TOOLS.filter(t => (!DRIVE_TOOLS.has(t.name) || canUseDrive(ctx)) && (a.prefs !== null || !PREF_TOOLS.has(t.name)));
  const tools: Anthropic.ToolUnion[] = [...own.slice(0, -1), { ...own[own.length - 1], cache_control: { type: 'ephemeral' } }, ...WEB_TOOLS];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) emit({ t: 'round' });
    const hydrated = await hydrateAttachments(db, ctx.userId, messages, attachmentCache);
    // Streamed so the agent sees the reply as it is written and what is being looked up. Tool inputs are left on the API's
    // default (buffered and validated) rather than streamed eagerly: nothing here shows a half-written tool call, and a
    // write must never be queued from arguments that were cut short.
    const stream = client.messages.stream({
      model: COPILOT_MODEL,
      max_tokens: 16000,
      system,
      tools,
      messages: a.cacheConversation === false ? hydrated : withCacheTail(hydrated),
    }, a.signal ? { signal: a.signal } : undefined);
    stream.on('text', d => emit({ t: 'text', d }));
    stream.on('streamEvent', ev => {
      if (ev.type === 'content_block_start' && ev.content_block.type === 'server_tool_use') emit({ t: 'step', label: stepLabel(ev.content_block.name) });
    });
    const res = await stream.finalMessage();
    a.onUsage?.(round, res.usage);
    messages.push({ role: 'assistant', content: res.content });

    // A long web search can pause mid-turn. Re-sending the conversation as it stands
    // resumes it — no "continue" message, the trailing server_tool_use is the cue.
    if (res.stop_reason === 'pause_turn') continue;

    if (res.stop_reason !== 'tool_use') {
      // Web answers arrive as many small text blocks (one per citation), so join
      // them without separators — a newline here would break sentences apart.
      let reply = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim();
      let history = compactWebTurns(messages);
      // Cut off by the length limit in the middle of a tool call: nothing was queued, so say so rather than leave a broken log.
      if (res.content.some(b => b.type === 'tool_use')) {
        history = dropUnansweredToolUse(history);
        const note = 'That was too long for me to finish in one go, so nothing was queued. Ask me for it in smaller pieces.';
        reply = reply ? `${reply}\n\n${note}` : note;
        history = [...history, { role: 'assistant', content: [{ type: 'text', text: note }] }];
      }
      const last = history[history.length - 1];
      const shown = typeof last?.content === 'string' ? last.content
        : (last?.content as Anthropic.ContentBlockParam[] | undefined)?.filter((b): b is Anthropic.TextBlockParam => b.type === 'text').map(b => b.text).join('\n').trim();
      return { messages: history, reply: shown || reply, pendingWrites, clientActions, confirmed: [] };
    }

    // Execute each requested tool. Reads run immediately. Writes never run here: they
    // are turned into an approval ticket for the agent to confirm, and a note goes back
    // to the model so it explains what it has queued instead of retrying.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      const input = (block.input ?? {}) as Record<string, any>;
      let content: string;
      emit({ t: 'step', label: stepLabel(block.name, WRITE_TOOLS.has(block.name)) });
      if (CLIENT_TOOLS.has(block.name)) {
        // Nothing to execute server-side — resolve the target, hand it to the
        // client, and tell the model it's done so it can answer in the same turn.
        // Deliberately NOT a WRITE: making someone confirm a tab switch would be
        // absurd, and there is no data change to confirm.
        if (block.name === 'open_record') {
          const rr = await resolveRecord(input, ctx);
          if ('error' in rr) content = JSON.stringify({ error: rr.error });
          else {
            clientActions.push({ type: 'open-record', ...rr.action });
            content = JSON.stringify({ ok: true, opened: rr.action.label, note: 'It is open on their screen now. Say so in one short line — do not tell them where to click.' });
          }
          await logToolCall(a, block.name, input, 'executed', content);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
          continue;
        }
        const r = resolveNav(String(input.destination ?? ''), ctx);
        if ('error' in r) {
          content = JSON.stringify({ error: r.error });
        } else {
          const t: NavTarget = r.target;
          clientActions.push({ type: 'navigate', page: t.page, tab: t.tab, label: t.label });
          content = JSON.stringify({ ok: true, opened: t.label, note: 'The screen has switched. Say so in one short line.' });
        }
        await logToolCall(a, block.name, input, 'executed', content);
      } else if (WRITE_TOOLS.has(block.name) && (content = sendGuard(block.name, lastUserText(a.incoming)) ?? '')) {
        // A send the agent never asked for (a vague "do it"): refused here, in code, whatever the model decided.
        await logToolCall(a, block.name, input, 'rejected_precheck', content);
      } else if (WRITE_TOOLS.has(block.name) && (content = await precheckWrite(block.name, input, ctx) ?? '')) {
        // Refused before the agent is ever asked to confirm — the model gets the reason and fixes the call.
        await logToolCall(a, block.name, input, 'rejected_precheck', content);
      } else if (WRITE_TOOLS.has(block.name)) {
        pendingWrites.push({ id: signPendingWrite(ctx, block.name, input), name: block.name, summary: await describeWriteRich(block.name, input, ctx) });
        content = JSON.stringify({ status: 'NOT_EXECUTED', reason: 'Queued for the agent\'s one-click confirmation in the app. In one short line, restate what will happen. Do not ask a yes/no question and do not retry.' });
        await logToolCall(a, block.name, input, 'queued_for_confirmation');
      } else {
        content = await runTool(block.name, input, ctx);
        await logToolCall(a, block.name, input, 'executed', content);
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
    }
    messages.push({ role: 'user', content: toolResults });
  }
  // Loop guard hit. The note goes into the log itself: the panel draws the log, so a reply that is only returned beside it is never seen.
  const reply = 'I ran out of steps on that one — could you narrow it down a bit?';
  return { messages: [...compactWebTurns(messages), { role: 'assistant', content: [{ type: 'text', text: reply }] }], reply, pendingWrites, clientActions, confirmed: [] };
}
