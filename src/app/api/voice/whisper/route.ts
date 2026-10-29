import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { say, twiml, twilioConfigured, twilioParams, verifyTwilioSignature, voiceOrigin } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * POST /api/voice/whisper?cs=<bot call CallSid> — the "press 1 to accept" screen on the agent's leg of a live transfer.
 *
 * Runs on the agent's side the moment their cell answers, BEFORE the caller is connected:
 *   (no step)    → tell the agent who is calling and ask for a 1.
 *   step=digit   → 1 connects the caller (an empty response bridges the two legs); any other key declines.
 *   step=none    → nothing pressed (a carrier voicemail answered, or they didn't want it): hang up on this leg.
 * A decline is recorded on the call (ai_meta.transfer.screen) and the Dial ends as a miss, so /api/voice/dial-result
 * puts Ava back on the line to take the message — the caller never lands in anyone's personal cell voicemail.
 */
export async function POST(req: Request) {
  if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const p = await twilioParams(req);
  if (!verifyTwilioSignature(req, p)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const u = new URL(req.url);
  const cs = u.searchParams.get('cs') || '';
  const step = u.searchParams.get('step') || '';
  const db = adminClient();
  const { data: call } = cs ? await db.from('crm_call_log').select('id, caller_name, ai_meta').eq('source', 'voicebot').eq('external_id', cs).maybeSingle() : { data: null };

  const mark = async (screen: 'accepted' | 'declined') => {
    if (!call) return;
    const { data: fresh } = await db.from('crm_call_log').select('ai_meta').eq('id', call.id).maybeSingle();
    const meta = { ...((fresh?.ai_meta as Record<string, unknown>) || {}) };
    meta.transfer = { ...((meta.transfer as Record<string, unknown> | undefined) ?? {}), screen, screened_at: new Date().toISOString() };
    await db.from('crm_call_log').update({ ai_meta: meta, updated_at: new Date().toISOString() }).eq('id', call.id);
  };

  if (step === 'digit') {
    if (p.Digits === '1') { await mark('accepted'); return twiml(''); }
    await mark('declined');
    return twiml('<Hangup/>');
  }
  if (step === 'none') {
    await mark('declined');
    return twiml('<Hangup/>');
  }

  const meta = (call?.ai_meta as { caller_name?: string; intent?: string; property?: string } | null) ?? {};
  const who = (meta.caller_name || call?.caller_name || '').trim();
  const about = (meta.intent || meta.property || '').trim();
  const text = `Call from the CRECO line${who ? `, ${who}` : ''}${about ? `, about ${about}` : ''}. Press 1 to take the call.`;
  const base = `${voiceOrigin()}/api/voice/whisper?cs=${encodeURIComponent(cs)}`;
  return twiml(`<Gather input="dtmf" numDigits="1" timeout="6" action="${base}&amp;step=digit" method="POST">${say(text)}</Gather><Redirect method="POST">${base}&amp;step=none</Redirect>`);
}

// Anything but Twilio's POST: nothing to do.
export async function GET() { return NextResponse.json({ ok: true, service: 'transfer-whisper' }); }
