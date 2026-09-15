import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { gather, say, twiml, twilioConfigured, twilioParams, verifyTwilioSignature, voiceOrigin, xml } from '@/lib/twilio';
import { loadSettings, nextReply, type Turn } from '@/lib/voicebot';
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
  await db.from('crm_call_turns').insert({ call_id: call.id, role: 'caller', text: heard || '(silence)' });

  const { data: turnRows } = await db.from('crm_call_turns').select('role, text').eq('call_id', call.id).order('created_at');
  const history = (turnRows ?? []) as Turn[];
  const callerTurns = history.filter(t => t.role === 'caller').length;

  let contact = null as null | { id: string; name: string };
  if (call.contact_id) {
    const { data: c } = await db.from('crm_clients').select('id, first_name, last_name, business_name').eq('id', call.contact_id).maybeSingle();
    if (c) contact = { id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || 'Contact' };
  }

  const reply = callerTurns >= MAX_TURNS
    ? { say: "Thank you. I have everything I need, and an agent will call you back as soon as possible. Goodbye.", action: 'end' as const }
    : await nextReply(settings, history, { callerNumber: call.from_number, contact });

  await db.from('crm_call_turns').insert({ call_id: call.id, role: 'bot', text: reply.say });

  // Keep what the bot has learned so far on the call row, so a dropped call still leaves a useful record.
  const meta = { ...((call.ai_meta as Record<string, unknown>) || {}) };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('caller_name' in reply && reply.caller_name) { meta.caller_name = reply.caller_name; if (!call.caller_name || call.caller_name === contact?.name) patch.caller_name = reply.caller_name; }
  if ('callback_number' in reply && reply.callback_number) { meta.callback_number = reply.callback_number; patch.callback_number = toE164(reply.callback_number); }
  if ('intent' in reply && reply.intent) { meta.intent = reply.intent; patch.intent = reply.intent; }
  if ('property' in reply && reply.property) meta.property = reply.property;
  if ('needs_follow_up' in reply && reply.needs_follow_up === false) meta.bot_said_no_follow_up = true;
  patch.ai_meta = meta;
  await db.from('crm_call_log').update(patch).eq('id', call.id);

  const turnUrl = `${voiceOrigin()}/api/voice/turn`;
  if (reply.action === 'transfer' && settings.transfer_number) {
    await db.from('crm_call_turns').insert({ call_id: call.id, role: 'bot', text: `[transferring to ${settings.transfer_number}]` });
    return twiml(`${say(reply.say)}<Dial timeout="25" callerId="${xml(call.from_number || '')}">${xml(settings.transfer_number)}</Dial>${say("I wasn't able to reach anyone. An agent will call you back as soon as possible. Goodbye.")}<Hangup/>`);
  }
  if (reply.action === 'end') return twiml(`${say(reply.say)}<Hangup/>`);
  return twiml(gather(reply.say, turnUrl));
}
