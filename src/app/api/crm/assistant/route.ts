import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { createClient } from '@supabase/supabase-js';
import { TOOLS, WRITE_TOOLS, CLIENT_TOOLS, runTool, describeWrite, resolveNav, type AgentCtx, type NavTarget } from '@/lib/crm-assistant-tools';
import { writeAuditLog } from '@/lib/audit';
import { systemPrompt } from '@/lib/crm-assistant-prompt';
import { rateLimit } from '@/lib/ratelimit';
import { signPendingWrite, verifyPendingWrite } from '@/lib/copilot-confirm';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = process.env.CRM_ASSISTANT_MODEL || 'claude-sonnet-5';


/**
 * Per-tool-call oversight trail.
 *
 * Records WHAT the copilot was asked to do on someone's behalf, not what they typed:
 * free-text arguments (email bodies, campaign copy, notes) are reduced to a field
 * name and a length, while ids, names and flags are kept so the row is still useful
 * for "which contact did that touch". Best-effort — it never blocks a tool.
 */
const BULK_TEXT_ARGS = new Set(['body', 'email_body', 'note', 'notes', 'message', 'prompt', 'description', 'highlights', 'values', 'fields']);

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

async function logToolCall(ctx: AgentCtx, req: NextRequest, tool: string, input: Record<string, unknown>, outcome: 'executed' | 'queued_for_confirmation', result?: string) {
  let ok: boolean | undefined;
  let error: string | undefined;
  if (result) {
    try { const parsed = JSON.parse(result); if (parsed && typeof parsed === 'object') { ok = !parsed.error; if (parsed.error) error = String(parsed.error).slice(0, 200); } }
    catch { /* non-JSON result — leave ok undefined */ }
  }
  await writeAuditLog({
    actorId: ctx.userId,
    action: 'copilot_tool',
    targetType: tool,
    targetId: (input?.contact_id ?? input?.deal_id ?? input?.listing_id ?? input?.submission_id ?? input?.task_id ?? undefined) as string | undefined,
    metadata: { tool, outcome, write: WRITE_TOOLS.has(tool), args: safeArgs(input), role: ctx.role, business_unit: ctx.businessUnit, ...(ok !== undefined ? { ok } : {}), ...(error ? { error } : {}) },
    req,
  });
}

interface ReqBody {
  messages?: Anthropic.MessageParam[];
  /** Approval tickets from a previous turn's pendingWrites, one per action the agent confirmed. */
  confirm?: unknown[];
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  // The costliest endpoint in the app: each call is up to six Claude rounds with tool
  // results fed back in. Auth alone bounds WHO can spend that, not HOW MUCH.
  const { success } = await rateLimit(req, 'copilot');
  if (!success) return NextResponse.json({ error: "You're going a bit fast for me — give it a minute." }, { status: 429 });

  const { messages: incoming = [], confirm = [] }: ReqBody = await req.json();
  if (!Array.isArray(incoming) || incoming.length === 0) return NextResponse.json({ error: 'messages required' }, { status: 400 });
  // The whole conversation is replayed by the client on every turn, so its size is
  // caller-controlled and gets re-sent to the model up to six times per request. Without
  // a ceiling one request can bill an arbitrary number of tokens. Generous on purpose:
  // a single turn can add a dozen entries (each tool round appends an assistant turn and
  // a tool_result turn), so these sit far above any real conversation.
  if (incoming.length > 150 || JSON.stringify(incoming).length > 120_000) {
    return NextResponse.json({ error: 'That conversation has gotten too long — start a new chat.' }, { status: 413 });
  }

  // Agent's first name for a personal system prompt.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: prof } = await db.from('crm_profiles').select('first_name').eq('id', ctx.userId).single();

  // Enrich the context so tools can call the CRM's own HTTP endpoints as this agent.
  const toolCtx: AgentCtx = { ...ctx, token: req.headers.get('authorization')?.replace(/^Bearer\s+/i, ''), origin: req.nextUrl.origin };

  // ── Confirmed writes run first, and run from the ticket, not from the model ──────
  // Replaying the approved call is the whole point: the agent read a summary, and this
  // executes exactly the call that summary described. The model is not asked again.
  const confirmed: { summary: string; ok: boolean; error?: string }[] = [];
  if (Array.isArray(confirm) && confirm.length) {
    for (const token of confirm.slice(0, 5)) {
      const call = verifyPendingWrite(token, toolCtx);
      if (!call) { confirmed.push({ summary: 'One action could not be confirmed', ok: false, error: 'That confirmation expired or was not valid — ask me again.' }); continue; }
      const summary = describeWrite(call.name, call.input);
      const result = await runTool(call.name, call.input, toolCtx);
      await logToolCall(toolCtx, req, call.name, call.input, 'executed', result);
      let err: string | undefined;
      try { const p = JSON.parse(result); if (p?.error) err = String(p.error); } catch { /* non-JSON */ }
      confirmed.push({ summary, ok: !err, error: err });
    }
  }

  // Confirming is a button, not a question, so it does not need the model: the actions
  // have already run and the outcome is known. Returning straight away also removes the
  // failure this replaced — a round-trip that could answer with anything at all — and
  // makes the confirm click free.
  if (confirmed.length) {
    const lines = confirmed.map(c => (c.ok ? `✓ ${c.summary}` : `⚠ ${c.summary} — ${c.error ?? 'did not go through'}`));
    const reply = lines.join('\n');
    const out = [...incoming, { role: 'assistant' as const, content: [{ type: 'text' as const, text: reply }] }];
    return NextResponse.json({ messages: out, reply, pendingWrites: [], clientActions: [], confirmed });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [...incoming];
  const pendingWrites: { id: string; name: string; summary: string }[] = [];
  // UI directives for the browser to apply when the response lands (navigation).
  const clientActions: { type: 'navigate'; page: string; tab?: string; label: string }[] = [];

  try {
    for (let round = 0; round < 6; round++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: systemPrompt(ctx, prof?.first_name || 'the agent'),
        tools: TOOLS,
        messages,
      });
      messages.push({ role: 'assistant', content: res.content });

      if (res.stop_reason !== 'tool_use') {
        const reply = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n').trim();
        return NextResponse.json({ messages, reply, pendingWrites, clientActions, confirmed });
      }

      // Execute each requested tool. Reads run immediately. Writes never run here: they
      // are turned into an approval ticket for the agent to confirm, and a note goes back
      // to the model so it explains what it has queued instead of retrying.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;
        const input = (block.input ?? {}) as Record<string, any>;
        let content: string;
        if (CLIENT_TOOLS.has(block.name)) {
          // Nothing to execute server-side — resolve the target, hand it to the
          // client, and tell the model it's done so it can answer in the same turn.
          // Deliberately NOT a WRITE: making someone confirm a tab switch would be
          // absurd, and there is no data change to confirm.
          const r = resolveNav(String(input.destination ?? ''), toolCtx);
          if ('error' in r) {
            content = JSON.stringify({ error: r.error });
          } else {
            const t: NavTarget = r.target;
            clientActions.push({ type: 'navigate', page: t.page, tab: t.tab, label: t.label });
            content = JSON.stringify({ ok: true, opened: t.label, note: 'The screen has switched. Say so in one short line.' });
          }
          await logToolCall(toolCtx, req, block.name, input, 'executed', content);
        } else if (WRITE_TOOLS.has(block.name)) {
          pendingWrites.push({ id: signPendingWrite(toolCtx, block.name, input), name: block.name, summary: describeWrite(block.name, input) });
          content = JSON.stringify({ status: 'NOT_EXECUTED', reason: 'Queued for the agent\'s one-click confirmation in the app. In one short line, restate what will happen. Do not ask a yes/no question and do not retry.' });
          await logToolCall(toolCtx, req, block.name, input, 'queued_for_confirmation');
        } else {
          content = await runTool(block.name, input, toolCtx);
          await logToolCall(toolCtx, req, block.name, input, 'executed', content);
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    // Loop guard hit.
    return NextResponse.json({ messages, reply: "I ran out of steps on that one — could you narrow it down a bit?", pendingWrites, clientActions, confirmed });
  } catch (e) {
    console.error('[crm-assistant]', e);
    return NextResponse.json({ error: 'The assistant hit an error. Try again.' }, { status: 500 });
  }
}
