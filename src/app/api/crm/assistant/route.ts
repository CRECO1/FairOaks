import { userRateLimit } from '@/lib/user-ratelimit';
import { NextRequest, NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { createClient } from '@supabase/supabase-js';
import { type AgentCtx } from '@/lib/crm-assistant-tools';
import { rateLimit } from '@/lib/ratelimit';
import { runCopilotTurn, runConfirmedWrites, type OpenDoc } from '@/lib/copilot-turn';
import { loadCopilotPrefs } from '@/lib/copilot-prefs';
import { ndjsonResponse } from '@/lib/copilot-stream';

export const runtime = 'nodejs';
// Web research adds server-side search/fetch rounds inside each Claude call.
// Research questions run several web searches in one turn (a batch of businesses is the worst case), so this is the long ceiling.
export const maxDuration = 300;

interface ReqBody {
  messages?: Anthropic.MessageParam[];
  /** Approval tickets from a previous turn's pendingWrites, one per action the agent confirmed. */
  confirm?: unknown[];
  /** The document the agent has open on screen right now (so "this LOI" means something). */
  openDoc?: { submissionId?: unknown; title?: unknown; kind?: unknown } | null;
  /** true = answer as a stream of progress lines (lib/copilot-stream) instead of one JSON body. */
  stream?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  // The costliest endpoint in the app: each call is up to eight Claude rounds with tool
  // results fed back in. Auth alone bounds WHO can spend that, not HOW MUCH.
  const { success } = await rateLimit(req, 'copilot');
  if (!success) return NextResponse.json({ error: "You're going a bit fast for me — give it a minute." }, { status: 429 });
  // The IP limit above is easy to sidestep from many addresses, so the real spending cap is per signed-in user.
  if (!(await userRateLimit('copilot-hour', ctx.userId, 60, '1 h')).success || !(await userRateLimit('copilot-day', ctx.userId, 300, '1 d')).success) {
    return NextResponse.json({ error: "That's a lot of Copilot requests for one day. It resets shortly — ask the account owner if you need more." }, { status: 429 });
  }

  const { messages: incoming = [], confirm = [], openDoc, stream: wantStream }: ReqBody = await req.json();
  if (!Array.isArray(incoming) || incoming.length === 0) return NextResponse.json({ error: 'messages required' }, { status: 400 });
  // The whole conversation is replayed by the client on every turn, so its size is
  // caller-controlled and gets re-sent to the model up to eight times per request. Without
  // a ceiling one request can bill an arbitrary number of tokens. Generous on purpose:
  // a single turn can add a dozen entries (each tool round appends an assistant turn and
  // a tool_result turn), so these sit far above any real conversation.
  if (incoming.length > 150 || JSON.stringify(incoming).length > 120_000) {
    return NextResponse.json({ error: 'That conversation has gotten too long — start a new chat.' }, { status: 413 });
  }

  // Enrich the context so tools can call the CRM's own HTTP endpoints as this agent.
  const toolCtx: AgentCtx = { ...ctx, token: req.headers.get('authorization')?.replace(/^Bearer\s+/i, ''), origin: req.nextUrl.origin };

  // ── Confirmed writes run first, and run from the ticket, not from the model ──────
  // Confirming is a button, not a question, so it does not need the model: the actions
  // have already run and the outcome is known. Returning straight away also removes the
  // failure this replaced — a round-trip that could answer with anything at all — and
  // makes the confirm click free.
  if (Array.isArray(confirm) && confirm.length) {
    try { return NextResponse.json(await runConfirmedWrites({ ctx: toolCtx, incoming, confirm, req })); }
    catch (e) { console.error('[crm-assistant] confirm', e); return NextResponse.json({ error: 'The assistant hit an error. Try again.' }, { status: 500 }); }
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // Agent's first name for a personal system prompt, and what they have asked the Copilot to remember.
  const [{ data: prof }, prefs] = await Promise.all([
    db.from('crm_profiles').select('first_name').eq('id', ctx.userId).single(),
    loadCopilotPrefs(db, ctx.userId),
  ]);

  // The document on the agent's screen, if any. The id is only a hint for the model — every tool
  // still checks the workspace itself — and the title is clipped so it can't smuggle a paragraph.
  const open: OpenDoc | null = openDoc && typeof openDoc.submissionId === 'string' && UUID.test(openDoc.submissionId)
    ? { submissionId: openDoc.submissionId, title: String(openDoc.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 120), kind: openDoc.kind === 'loi' ? 'loi' as const : 'form' as const }
    : null;

  const turn = { ctx: toolCtx, db, incoming, req, firstName: prof?.first_name || 'the agent', open, prefs };

  if (wantStream !== true) {
    try { return NextResponse.json(await runCopilotTurn(turn)); }
    catch (e) { console.error('[crm-assistant]', e); return NextResponse.json({ error: 'The assistant hit an error. Try again.' }, { status: 500 }); }
  }

  // Streamed: progress lines while the turn runs, then the same payload the JSON branch returns.
  return ndjsonResponse(
    (emit, signal) => runCopilotTurn({ ...turn, emit, signal }),
    e => { console.error('[crm-assistant]', e); return 'The assistant hit an error. Try again.'; },
  );
}
