import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { createClient } from '@supabase/supabase-js';
import { TOOLS, WRITE_TOOLS, runTool, describeWrite, type AgentCtx } from '@/lib/crm-assistant-tools';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = process.env.CRM_ASSISTANT_MODEL || 'claude-sonnet-5';

function systemPrompt(ctx: AgentCtx, agentName: string): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const unit = ctx.businessUnit === 'commercial' ? 'CRECO (commercial real estate)' : ctx.businessUnit === 'residential' ? 'Fair Oaks Realty Group (residential)' : 'the brokerage (all workspaces)';
  return `You are the in-CRM copilot for ${agentName}, an agent at ${unit}. Today is ${today}.

You help the agent get work done in their CRM by calling tools — looking up contacts, deals and tasks, and taking actions like creating tasks, adding notes, and moving deals through stages. You act as this agent, scoped to their workspace.

Rules:
- Be concise and practical. Lead with the answer; skip preamble.
- Use tools to get real data — never invent contacts, deals, tasks, ids, dates or numbers. If you need an id, look it up first (e.g. search_contacts before creating a task for someone).
- Take ONE tool action per turn so the agent can follow along. Gather any ids you need with read tools first (e.g. search_contacts before creating a task for someone).
- For any WRITE (creating a task, adding a note, moving a deal stage): just CALL the tool when you're ready — the app automatically pauses it and asks the agent to confirm before it runs, showing them exactly what will happen. So don't ask "should I?" in text; call the tool, then, in one short line, tell the agent what you've queued up for them to confirm.
- When a tool result says NOT_EXECUTED, that's the confirmation pause working normally — briefly restate what will happen and let the agent confirm; don't retry or apologize.
- If something is out of scope or you can't find it, say so plainly.`;
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

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [...incoming];
  const pendingWrites: { name: string; summary: string }[] = [];

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
        return NextResponse.json({ messages, reply, pendingWrites });
      }

      // Execute each requested tool. Reads run immediately; writes run only when the
      // agent has approved (allowWrites) — otherwise they're deferred with a note back
      // to the model so it asks for confirmation.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;
        const input = (block.input ?? {}) as Record<string, any>;
        let content: string;
        if (WRITE_TOOLS.has(block.name) && !allowWrites) {
          pendingWrites.push({ name: block.name, summary: describeWrite(block.name, input) });
          content = JSON.stringify({ status: 'NOT_EXECUTED', reason: 'Queued for the agent\'s one-click confirmation in the app. In one short line, restate what will happen. Do not ask a yes/no question and do not retry.' });
        } else {
          content = await runTool(block.name, input, ctx);
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    // Loop guard hit.
    return NextResponse.json({ messages, reply: "I ran out of steps on that one — could you narrow it down a bit?", pendingWrites });
  } catch (e) {
    console.error('[crm-assistant]', e);
    return NextResponse.json({ error: 'The assistant hit an error. Try again.' }, { status: 500 });
  }
}
