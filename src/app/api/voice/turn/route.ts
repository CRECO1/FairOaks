import { NextResponse, after } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { holdThenRedirect, renderReply, say, twiml, twilioConfigured, twilioParams, verifyTwilioSignature, voiceOrigin } from '@/lib/twilio';
import { loadSettings, nextReply, type BotReply, type Turn } from '@/lib/voicebot';
import { toE164 } from '@/lib/phone';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TURNS = 12; // caller utterances — a hard stop so a confused loop can't run up minutes

/**
 * POST /api/voice/turn — Twilio <Gather> result: what the caller just said.
 * Append it, ask Claude for the next line, say it, and either listen again,
 * transfer, or hang up.
 */
export async function POST(req: Request) {
  if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const p = await twilioParams(req);
  if (!verifyTwilioSignature(req, p)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const db = adminClient();
  const { data: call } = await db.from('crm_call_log').select('id, business_unit, from_number, contact_id, caller_name, ai_meta').eq('source', 'voicebot').eq('external_id', p.CallSid).maybeSingle();
  if (!call) return twiml(`${say("Sorry, something went wrong on our end. Please call back in a moment.")}<Hangup/>`);

  const settings = await loadSettings(db, call.business_unit);
  const heard = (p.SpeechResult || '').trim();
  const { data: callerTurn } = await db.from('crm_call_turns').insert({ call_id: call.id, role: 'caller', text: heard || '(silence)' }).select('id').single();

  const { data: turnRows } = await db.from('crm_call_turns').select('role, text').eq('call_id', call.id).order('created_at');
  const history = (turnRows ?? []) as Turn[];
  const callerTurns = history.filter(t => t.role === 'caller').length;

  let contact = null as null | { id: string; name: string };
  if (call.contact_id) {
    const { data: c } = await db.from('crm_clients').select('id, first_name, last_name, business_name').eq('id', call.contact_id).maybeSingle();
    if (c) contact = { id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || 'Contact' };
  }

  // Work out the reply, store it with what to do next, and keep the call row current.
  const work = (async (): Promise<BotReply> => {
    const reply: BotReply = callerTurns >= MAX_TURNS
      ? { say: "Thank you. I have everything I need, and an agent will call you back as soon as possible. Goodbye.", action: 'end' }
      : await nextReply(settings, history, { callerNumber: call.from_number, contact });
    await db.from('crm_call_turns').insert({ call_id: call.id, role: 'bot', text: reply.say, meta: { action: reply.action, after_turn: callerTurn?.id ?? null } });
    const meta = { ...((call.ai_meta as Record<string, unknown>) || {}) };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (reply.caller_name) { meta.caller_name = reply.caller_name; if (!call.caller_name || call.caller_name === contact?.name) patch.caller_name = reply.caller_name; }
    if (reply.callback_number) { meta.callback_number = reply.callback_number; patch.callback_number = toE164(reply.callback_number); }
    if (reply.intent) { meta.intent = reply.intent; patch.intent = reply.intent; }
    if (reply.property) meta.property = reply.property;
    if (reply.needs_follow_up === false) meta.bot_said_no_follow_up = true;
    patch.ai_meta = meta;
    await db.from('crm_call_log').update(patch).eq('id', call.id);
    return reply;
  })();

  // Twilio gives a webhook 15 seconds. Answer directly when the reply is quick;
  // otherwise say so, let the work finish in the background, and have Twilio poll.
  const quick = await Promise.race<BotReply | null>([work, new Promise<null>(res => setTimeout(() => res(null), QUICK_BUDGET_MS))]);
  if (quick) return twiml(renderReply(quick, settings, call.from_number));
  after(work.catch(e => console.error('[voice/turn] background', e)));
  const waitUrl = `${voiceOrigin()}/api/voice/wait?after=${encodeURIComponent(callerTurn?.id ?? '')}`;
  return twiml(holdThenRedirect(HOLD_LINES[callerTurns % HOLD_LINES.length], waitUrl, 2));
}

const QUICK_BUDGET_MS = 6500;
const HOLD_LINES = ['One moment while I look that up.', 'Let me check on that for you.', 'Just a second.'];
