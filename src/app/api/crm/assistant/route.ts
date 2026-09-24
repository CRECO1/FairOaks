import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { createClient } from '@supabase/supabase-js';
import { TOOLS, WRITE_TOOLS, CLIENT_TOOLS, runTool, describeWrite, resolveNav, type AgentCtx, type NavTarget } from '@/lib/crm-assistant-tools';
import { writeAuditLog } from '@/lib/audit';
import { systemPrompt } from '@/lib/crm-assistant-prompt';

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

interface ReqBody { messages?: Anthropic.MessageParam[]; allowWrites?: boolean }

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { messages: incoming = [], allowWrites = false }: ReqBody = await req.json();
  if (!Array.isArray(incoming) || incoming.length === 0) return NextResponse.json({ error: 'messages required' }, { status: 400 });

  // Agent's first name for a personal system prompt.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: prof } = await db.from('crm_profiles').select('first_name').eq('id', ctx.userId).single();

  // Enrich the context so tools can call the CRM's own HTTP endpoints as this agent.
  const toolCtx: AgentCtx = { ...ctx, token: req.headers.get('authorization')?.replace(/^Bearer\s+/i, ''), origin: req.nextUrl.origin };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [...incoming];
  const pendingWrites: { name: string; summary: string }[] = [];
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
        return NextResponse.json({ messages, reply, pendingWrites, clientActions });
      }

      // Execute each requested tool. Reads run immediately; writes run only when the
      // agent has approved (allowWrites) — otherwise they're deferred with a note back
      // to the model so it asks for confirmation.
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
        } else if (WRITE_TOOLS.has(block.name) && !allowWrites) {
          pendingWrites.push({ name: block.name, summary: describeWrite(block.name, input) });
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
    return NextResponse.json({ messages, reply: "I ran out of steps on that one — could you narrow it down a bit?", pendingWrites, clientActions });
  } catch (e) {
    console.error('[crm-assistant]', e);
    return NextResponse.json({ error: 'The assistant hit an error. Try again.' }, { status: 500 });
  }
}
