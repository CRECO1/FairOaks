import { NextResponse, after } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { gather, say, twiml, twilioConfigured, twilioParams, verifyTwilioSignature, voiceOrigin, startRecordingWhenLive } from '@/lib/twilio';
import { defaultGreeting, loadSettings, matchContact, unitForNumber, multilingualEnabled, voiceGenerationFor, callerNumberOrNull } from '@/lib/voicebot';
import { speechHints } from '@/lib/listing-knowledge';
import { toE164 } from '@/lib/phone';
import { BLOCKED_MESSAGE, findBlock, recordBlockedHit } from '@/lib/call-blocklist';

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
  // The real caller, or null when Talkroute handed us one of OUR lines as the caller ID (the Fair Oaks line does).
  const caller = await callerNumberOrNull(db, from);

  // Block list FIRST — before the greeting, the contact lookup, the recording or any transfer. A blocked number
  // is told goodbye and hung up on: no Ava, no ring to an agent's cell, no summary email, no call-back queue.
  // The attempt is still logged (result 'blocked') so it shows in the Calling Log. Any lookup error falls
  // through to the normal flow (findBlock fails open). A caller ID that is really one of OUR lines is never checked.
  const blocked = caller ? await findBlock(db, caller, unit) : null;
  if (blocked) {
    await db.from('crm_call_log').insert({
      business_unit: unit, source: 'voicebot', kind: 'bot', external_id: callSid, direction: 'inbound', result: 'blocked',
      from_number: from, to_number: to, caller_name: p.CallerName || null, started_at: new Date().toISOString(), needs_follow_up: false,
      summary: `Blocked number — call turned away${blocked.reason ? ` (${blocked.reason})` : ''}.`, intent: 'Blocked caller',
      raw: { From: p.From, To: p.To, ForwardedFrom: p.ForwardedFrom || null, CallerName: p.CallerName },
      ai_meta: { blocked: { id: blocked.id, source: blocked.source, reason: blocked.reason, at: new Date().toISOString() } },
    });
    await recordBlockedHit(db, blocked);
    return twiml(`${say(BLOCKED_MESSAGE)}<Hangup/>`);
  }
  const contact = caller ? await matchContact(db, caller, unit) : null;

  if (!settings.enabled) {
    // Switched off in the CRM: take a plain voicemail-style message instead of hanging up on people.
    return twiml(`${say(`Thanks for calling ${settings.company_name || 'us'}. Please leave your name, number and message after the tone.`)}<Record maxLength="120" action="${voiceOrigin()}/api/voice/status" recordingStatusCallback="${voiceOrigin()}/api/voice/recording" playBeep="true"/>`);
  }

  const greeting = defaultGreeting(settings, contact);
  // English + Spanish recognition for this call (see multilingualEnabled); remembered so every later turn matches.
  const multi = await multilingualEnabled(db, caller, unit).catch(() => false);
  const voice = await voiceGenerationFor(db, caller, unit).catch(() => 'classic' as const);
  const { data: call } = await db.from('crm_call_log').insert({
    business_unit: unit, source: 'voicebot', kind: 'bot', external_id: callSid, direction: 'inbound', result: 'in_progress',
    from_number: from, to_number: to, caller_name: p.CallerName || contact?.name || null, contact_id: contact?.id ?? null,
    started_at: new Date().toISOString(), needs_follow_up: true,
    raw: { From: p.From, To: p.To, ForwardedFrom: p.ForwardedFrom || null, CallerName: p.CallerName, FromCity: p.FromCity, FromState: p.FromState },
    ai_meta: { stt: multi ? 'multi' : 'legacy', lang: 'en', voice, ...(caller ? {} : { caller_id_unknown: true }) },
  }).select('id').single();
  if (call?.id) await db.from('crm_call_turns').insert({ call_id: call.id, role: 'bot', text: greeting });

  // Record the whole call for the log, without holding up the greeting: after() keeps
  // the function alive until Twilio has accepted, a beat after the call goes live.
  // The RecordingSid is stored at once; /api/voice/recording confirms it when done.
  after(() => startRecordingWhenLive(callSid, async sid => {
    await db.from('crm_call_log').update({ recording_url: `twilio:${sid}` }).eq('source', 'voicebot').eq('external_id', callSid).is('recording_url', null);
  }));

  return twiml(gather(greeting, `${voiceOrigin()}/api/voice/turn`, { hints: await speechHints(unit), multi, voice }));
}
