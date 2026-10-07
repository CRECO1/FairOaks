// ─────────────────────────────────────────────────────────────────────────────
// Twilio Programmable Voice — the line the AI voice bot answers on. Talkroute
// forwards to this number (after hours, on no-answer, or from a menu option).
//
// Everything here is plain HTTPS: Twilio POSTs form-encoded webhooks, we answer
// with TwiML. No SDK, no websockets — it runs on Vercel functions as-is.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { APP_ORIGIN } from '@/lib/esign';

export function twilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/** The public origin Twilio reaches us on — must match what is configured in the Twilio console. */
export function voiceOrigin(): string {
  return (process.env.VOICE_PUBLIC_ORIGIN || APP_ORIGIN).replace(/\/$/, '');
}

/**
 * Twilio signs every webhook: base64(HMAC-SHA1(authToken, url + Σ sorted(key+value))).
 * The URL must be exactly what Twilio requested, so we rebuild it from our known
 * public origin rather than trusting proxy headers.
 */
export function verifyTwilioSignature(req: Request, params: Record<string, string>): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;
  const sig = req.headers.get('x-twilio-signature') ?? '';
  if (!sig) return false;
  const u = new URL(req.url);
  const url = `${voiceOrigin()}${u.pathname}${u.search}`;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(data).digest('base64');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Twilio posts application/x-www-form-urlencoded. */
export async function twilioParams(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

// ── TwiML ─────────────────────────────────────────────────────────────────────
export const xml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A warm, natural neural voice. Override per deployment without a code change.
export const VOICE = process.env.TWILIO_VOICE || 'Polly.Joanna-Neural';

export function say(text: string): string {
  return `<Say voice="${xml(VOICE)}" language="en-US">${xml(text)}</Say>`;
}

/** Say something, then listen for the caller's reply and POST it to `action`. */
export function gather(text: string, action: string, opts: { timeoutSec?: number } = {}): string {
  return `<Gather input="speech" action="${xml(action)}" method="POST" language="en-US" speechTimeout="auto" speechModel="phone_call" enhanced="true" actionOnEmptyResult="true" timeout="${opts.timeoutSec ?? 6}">${say(text)}</Gather>`;
}

/** Say a short filler, pause, then have Twilio re-request `url` — used while a slow reply finishes in the background. */
export function holdThenRedirect(text: string | null, url: string, pauseSec = 2): string {
  return `${text ? say(text) : ''}<Pause length="${pauseSec}"/><Redirect method="POST">${xml(url)}</Redirect>`;
}

export function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// ── REST (only what we need) ──────────────────────────────────────────────────
function authHeader(): string {
  return 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
}

/** Start recording the live call; Twilio tells /api/voice/recording when the file is ready. */
export async function startRecording(callSid: string): Promise<{ ok: boolean; sid?: string }> {
  if (!twilioConfigured()) return { ok: false };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const body = new URLSearchParams({
    RecordingStatusCallback: `${voiceOrigin()}/api/voice/recording`,
    RecordingStatusCallbackEvent: 'completed',
    RecordingChannels: 'dual',
    Trim: 'trim-silence',
  });
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${encodeURIComponent(callSid)}/Recordings.json`, {
      method: 'POST', headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const j = await r.json().catch(() => ({})) as { sid?: string; code?: number; message?: string };
    if (r.ok && j.sid) return { ok: true, sid: j.sid };
    // Twilio refuses while the call isn't live yet (still ringing into our webhook).
    console.warn('[twilio] startRecording refused', r.status, j.code, j.message);
    return { ok: false };
  } catch (e) { console.warn('[twilio] startRecording', e); return { ok: false }; }
}

/**
 * Start the whole-call recording once the call is live, retrying a refusal.
 * Run it inside next/server's after(): a bare un-awaited promise gets frozen when
 * the webhook returns, and asking the instant the call arrives (before our TwiML
 * has even been read) is refused — between them, 13 of the first 24 bot calls
 * were never recorded. onStarted gets the RecordingSid as soon as Twilio accepts.
 */
export async function startRecordingWhenLive(callSid: string, onStarted: (recordingSid: string) => Promise<void>, delaysMs: number[] = [1500, 3000]): Promise<boolean> {
  for (const d of delaysMs) {
    if (d) await new Promise(res => setTimeout(res, d));
    const r = await startRecording(callSid);
    if (r.ok && r.sid) { await onStarted(r.sid); return true; }
  }
  console.error('[twilio] call recording never started', callSid);
  return false;
}

/** Media URL for a recording, playable by the CRM through our authed proxy. */
export function recordingMediaUrl(recordingSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;
}

/** Fetch the recording bytes with our credentials (the CRM never sees the auth token). */
export async function fetchRecording(recordingSid: string): Promise<Response> {
  return fetch(recordingMediaUrl(recordingSid), { headers: { Authorization: authHeader() } });
}

/** TwiML for a finished bot reply: keep listening, hang up, or transfer. Shared by /api/voice/turn and /api/voice/wait. */
export function renderReply(reply: { say: string; action: 'continue' | 'end' | 'transfer' }, settings: { transfer_number: string | null }, callerNumber: string | null): string {
  const turnUrl = `${voiceOrigin()}/api/voice/turn`;
  if (reply.action === 'transfer' && settings.transfer_number) {
    return `${say(reply.say)}<Dial timeout="25" callerId="${xml(callerNumber || '')}">${xml(settings.transfer_number)}</Dial>${say("I wasn't able to reach anyone. An agent will call you back as soon as possible. Goodbye.")}<Hangup/>`;
  }
  if (reply.action === 'end') return `${say(reply.say)}<Hangup/>`;
  return gather(reply.say, turnUrl);
}
