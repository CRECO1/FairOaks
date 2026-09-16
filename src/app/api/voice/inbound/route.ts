import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { gather, say, twiml, twilioConfigured, twilioParams, verifyTwilioSignature, voiceOrigin, startRecording } from '@/lib/twilio';
import { defaultGreeting, loadSettings, matchContact, unitForNumber } from '@/lib/voicebot';
import { toE164 } from '@/lib/phone';

export const dynamic = 'force-dynamic';

/**
 * POST /api/voice/inbound — Twilio's "A call comes in" webhook for the bot line.
 *
 * Talkroute forwards here (after hours, no answer, or a menu option). We open the
 * call record, greet the caller by name when the caller ID is a known contact, and
 * hand the conversation to /api/voice/turn.
 */
export async function POST(req: Request) {
  if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const p = await twilioParams(req);
  if (!verifyTwilioSignature(req, p)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const db = adminClient();
  const callSid = p.CallSid;
  const from = toE164(p.From);
  const to = toE164(p.To);
  // One bot line can serve both brands: when Talkroute forwards a call, Twilio tells
  // us which Talkroute number it came through, and that number picks the workspace.
  const via = toE164(p.ForwardedFrom) || toE164(p.CalledVia) || null;
  const unit = await unitForNumber(db, via || to);
  const settings = await loadSettings(db, unit);
  const contact = await matchContact(db, from, unit);

  if (!settings.enabled) {
    // Switched off in the CRM: take a plain voicemail-style message instead of hanging up on people.
    return twiml(`${say(`Thanks for calling ${settings.company_name || 'us'}. Please leave your name, number and message after the tone.`)}<Record maxLength="120" action="${voiceOrigin()}/api/voice/status" recordingStatusCallback="${voiceOrigin()}/api/voice/recording" playBeep="true"/>`);
  }

  const greeting = defaultGreeting(settings, contact);
  const { data: call } = await db.from('crm_call_log').insert({
    business_unit: unit, source: 'voicebot', kind: 'bot', external_id: callSid, direction: 'inbound', result: 'in_progress',
    from_number: from, to_number: to, caller_name: p.CallerName || contact?.name || null, contact_id: contact?.id ?? null,
    started_at: new Date().toISOString(), needs_follow_up: true,
    raw: { From: p.From, To: p.To, ForwardedFrom: p.ForwardedFrom || null, CallerName: p.CallerName, FromCity: p.FromCity, FromState: p.FromState },
  }).select('id').single();
  if (call?.id) await db.from('crm_call_turns').insert({ call_id: call.id, role: 'bot', text: greeting });

  // Record the whole call for the log. Fire-and-forget; the greeting must not wait on it.
  void startRecording(callSid);

  return twiml(gather(greeting, `${voiceOrigin()}/api/voice/turn`));
}
