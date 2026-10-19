// ─────────────────────────────────────────────────────────────────────────────
// Twilio Programmable Voice — the line the AI voice bot answers on. Talkroute
// forwards to this number (after hours, on no-answer, or from a menu option).
//
// Everything here is plain HTTPS: Twilio POSTs form-encoded webhooks, we answer
// with TwiML. No SDK, no websockets — it runs on Vercel functions as-is.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { APP_ORIGIN } from '@/lib/esign';
import { line } from '@/lib/voice-lines';
import { speechText } from '@/lib/speech-text';

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

// Two voice generations. "classic" is the neural voice every caller has heard so far; "new" is the GENERATIVE
// version of the same voices — noticeably more natural, with real breaths, pacing and intonation. Which one a call
// gets is decided once at the start of the call (voiceGenerationFor in voicebot.ts) so every turn matches.
// Override any of them without a code change.
export const VOICE = process.env.TWILIO_VOICE || 'Polly.Joanna-Neural';
export const VOICE_ES = process.env.TWILIO_VOICE_ES || 'Polly.Lupe-Neural';
export const VOICE_NEW = process.env.TWILIO_VOICE_NEW || 'Polly.Joanna-Generative';
export const VOICE_NEW_ES = process.env.TWILIO_VOICE_NEW_ES || 'Polly.Lupe-Generative';
export type VoiceGen = 'classic' | 'new';

export function say(text: string, lang: 'en' | 'es' = 'en', gen: VoiceGen = 'classic'): string {
  const spoken = lang === 'es' ? speechText(text) : speechText(text);
  const voice = lang === 'es' ? (gen === 'new' ? VOICE_NEW_ES : VOICE_ES) : (gen === 'new' ? VOICE_NEW : VOICE);
  return `<Say voice="${xml(voice)}" language="${lang === 'es' ? 'es-US' : 'en-US'}">${xml(spoken)}</Say>`;
}

/**
 * Say something, then listen for the caller's reply and POST it to `action`.
 *
 * `multi` uses Twilio's Deepgram nova-3 model in multi-language mode, which recognises English AND Spanish
 * in the same call with no menu — the caller just speaks. (Twilio requires an integer speechTimeout with a
 * named model, not "auto"; `enhanced` is Google-only and ignored; failover to another provider does not
 * happen, hence the gating in voicebot.multilingualEnabled.) Without it: the original English recogniser, or
 * Spanish when the conversation is already in Spanish.
 */
export function gather(text: string, action: string, opts: { timeoutSec?: number; hints?: string[]; lang?: 'en' | 'es'; multi?: boolean; voice?: VoiceGen } = {}): string {
  // `hints` biases speech recognition toward words we expect (our people, properties, streets): without them
  // "Zack Stovall" came back "Zack stoval" and "Dietz Elkhorn" as "diesel, corn".
  // Capped well inside Twilio's limits (phrases ≤100 chars) so a long property list can never make Twilio reject the TwiML.
  let h = '';
  for (const x of (opts.hints ?? []).map(x => x.replace(/[,"<>&]/g, ' ').replace(/\s+/g, ' ').trim()).filter(x => x && x.length <= 80).slice(0, 120)) {
    if (h.length + x.length + 2 > 3500) break;
    h += (h ? ', ' : '') + x;
  }
  const lang = opts.lang ?? 'en';
  const recog = opts.multi
    ? `language="multi" speechModel="deepgram_nova-3" speechTimeout="2" profanityFilter="false"`
    : lang === 'es'
      ? `language="es-US" speechTimeout="auto" speechModel="phone_call" enhanced="true"`
      : `language="en-US" speechTimeout="auto" speechModel="phone_call" enhanced="true"`;
  return `<Gather input="speech" action="${xml(action)}" method="POST" ${recog} actionOnEmptyResult="true" timeout="${opts.timeoutSec ?? 6}"${h ? ` hints="${xml(h)}"` : ''}>${say(text, lang, opts.voice)}</Gather>`;
}

/** Say a short filler, pause, then have Twilio re-request `url` — used while a slow reply finishes in the background. */
export function holdThenRedirect(text: string | null, url: string, pauseSec = 2, lang: 'en' | 'es' = 'en', gen: VoiceGen = 'classic'): string {
  return `${text ? say(text, lang, gen) : ''}<Pause length="${pauseSec}"/><Redirect method="POST">${xml(url)}</Redirect>`;
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
export function renderReply(reply: { say: string; action: 'continue' | 'end' | 'transfer' }, settings: { transfer_number: string | null }, callerNumber: string | null, hints?: string[], opts: { lang?: 'en' | 'es'; multi?: boolean; voice?: VoiceGen } = {}): string {
  const lang = opts.lang ?? 'en';
  const turnUrl = `${voiceOrigin()}/api/voice/turn`;
  if (reply.action === 'transfer' && settings.transfer_number) {
    return `${say(reply.say, lang, opts.voice)}<Dial timeout="25" callerId="${xml(callerNumber || '')}">${xml(settings.transfer_number)}</Dial>${say(line('transferFailed', lang), lang, opts.voice)}<Hangup/>`;
  }
  if (reply.action === 'end') return `${say(reply.say, lang, opts.voice)}<Hangup/>`;
  return gather(reply.say, turnUrl, { hints, lang, multi: opts.multi, voice: opts.voice });
}
