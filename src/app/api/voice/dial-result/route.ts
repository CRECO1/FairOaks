import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { gather, twiml, twilioConfigured, twilioParams, verifyTwilioSignature, voiceOrigin } from '@/lib/twilio';
import { speechHints } from '@/lib/listing-knowledge';
import { asLang, line } from '@/lib/voice-lines';

export const dynamic = 'force-dynamic';

/**
 * POST /api/voice/dial-result — the <Dial action> after Ava rang an agent's cell.
 *
 * Records how the ring went on the call (who, answered or not, for how long) so the CRM tracks it either way.
 * The agent's leg runs a "press 1 to accept" screen first (/api/voice/whisper), so a "completed" leg only counts as
 * a real connection when it was accepted there. Anything else — no-answer / busy / failed, or a cell that picked up
 * but nobody pressed 1 (a carrier voicemail) — means nobody took the call, so Ava comes back on the line and takes
 * the message in our system instead; the caller never ends up in a personal voicemail.
 */
export async function POST(req: Request) {
  if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const p = await twilioParams(req);
  if (!verifyTwilioSignature(req, p)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const db = adminClient();
  const dialStatus = p.DialCallStatus || 'failed';
  const duration = Number(p.DialCallDuration || 0) || 0;
  const { data: call } = await db.from('crm_call_log').select('id, business_unit, ai_meta').eq('source', 'voicebot').eq('external_id', p.CallSid).maybeSingle();
  if (!call) return twiml('<Hangup/>');

  const meta = { ...((call.ai_meta as Record<string, unknown>) || {}) };
  const prior = (meta.transfer as Record<string, unknown> | undefined) ?? {};
  // "completed" without an accepted screen = the cell (or its voicemail) answered but nobody took the call.
  const status = dialStatus === 'completed' && prior.screen !== 'accepted' ? 'no-answer' : dialStatus;
  meta.transfer = { ...prior, status, duration_sec: duration, ended_at: new Date().toISOString() };
  await db.from('crm_call_log').update({ ai_meta: meta, updated_at: new Date().toISOString() }).eq('id', call.id);

  if (status === 'completed') return twiml('<Hangup/>');

  // Nobody reached: take the message. The turn route sees meta.transfer and won't offer another transfer.
  const lang = asLang(meta.lang);
  const multi = meta.stt === 'multi';
  const voice = meta.voice === 'new' ? 'new' as const : 'classic' as const;
  // Already have their name and number (Ava took them before connecting)? Don't ask again.
  const known = Boolean(meta.caller_name && meta.callback_number);
  const text = line(known ? 'transferMissedKnown' : 'transferMissed', lang);
  await db.from('crm_call_turns').insert({ call_id: call.id, role: 'bot', text, meta: { action: 'continue', lang, after_dial: status } });
  return twiml(gather(text, `${voiceOrigin()}/api/voice/turn`, { hints: await speechHints(call.business_unit), lang, multi, voice }));
}
