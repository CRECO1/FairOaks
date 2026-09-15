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
export async function startRecording(callSid: string): Promise<void> {
  if (!twilioConfigured()) return;
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const body = new URLSearchParams({
    RecordingStatusCallback: `${voiceOrigin()}/api/voice/recording`,
    RecordingStatusCallbackEvent: 'completed',
    RecordingChannels: 'dual',
    Trim: 'trim-silence',
  });
  try {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${encodeURIComponent(callSid)}/Recordings.json`, {
      method: 'POST', headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
  } catch (e) { console.warn('[twilio] startRecording', e); }
}

/** Media URL for a recording, playable by the CRM through our authed proxy. */
export function recordingMediaUrl(recordingSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;
}

/** Fetch the recording bytes with our credentials (the CRM never sees the auth token). */
export async function fetchRecording(recordingSid: string): Promise<Response> {
  return fetch(recordingMediaUrl(recordingSid), { headers: { Authorization: authHeader() } });
}
