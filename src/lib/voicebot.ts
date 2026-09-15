// ─────────────────────────────────────────────────────────────────────────────
// The AI receptionist. Twilio hands us what the caller said, one turn at a time;
// Claude decides what to say back and whether the conversation is done. State
// lives in crm_call_log + crm_call_turns because every webhook is a fresh function.
// ─────────────────────────────────────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { last10, prettyPhone, toE164 } from '@/lib/phone';
import { esc, resendConfig } from '@/lib/esign';
import { Resend } from 'resend';
import { listingFactSheet } from '@/lib/listing-knowledge';

export const VOICEBOT_MODEL = process.env.VOICEBOT_MODEL || 'claude-opus-5';

export interface VoicebotSettings {
  business_unit: string; enabled: boolean; bot_name: string; company_name: string | null;
  greeting: string | null; instructions: string | null; transfer_number: string | null;
  notify_emails: string[]; twilio_number: string | null; talkroute_numbers: string[]; updated_at?: string;
}

const DEFAULTS: Record<string, { company: string; blurb: string }> = {
  commercial: {
    company: 'CRECO',
    blurb: 'CRECO (Commercial Real Estate Co.) is a commercial real estate brokerage in the San Antonio / Texas Hill Country area: office, retail, industrial and land — leasing, sales, tenant and landlord representation, and property management including the Fair Oaks Plaza office park at 8000 Fair Oaks Parkway.',
  },
  residential: {
    company: 'Fair Oaks Realty Group',
    blurb: 'Fair Oaks Realty Group is a residential real estate brokerage serving Fair Oaks Ranch, Boerne and the Texas Hill Country near San Antonio: buying, selling, luxury homes, relocation and new construction.',
  },
};

export async function loadSettings(db: SupabaseClient, unit: string): Promise<VoicebotSettings> {
  const { data } = await db.from('crm_voicebot_settings').select('*').eq('business_unit', unit).maybeSingle();
  const d = DEFAULTS[unit] ?? DEFAULTS.commercial;
  return {
    business_unit: unit, enabled: true, bot_name: 'Ava', company_name: d.company, greeting: null, instructions: null,
    transfer_number: null, notify_emails: [], twilio_number: null, talkroute_numbers: [],
    ...(data ?? {}),
  } as VoicebotSettings;
}

/** Which workspace owns a phone number we were reached on. Unknown → commercial (the main line). */
export async function unitForNumber(db: SupabaseClient, ourNumber: string | null): Promise<string> {
  if (!ourNumber) return 'commercial';
  const { data } = await db.from('crm_voicebot_settings').select('business_unit, twilio_number, talkroute_numbers');
  for (const s of data ?? []) {
    const nums = [s.twilio_number, ...((s.talkroute_numbers as string[] | null) ?? [])].filter(Boolean) as string[];
    if (nums.some(n => last10(n) === last10(ourNumber))) return s.business_unit as string;
  }
  return 'commercial';
}

export interface MatchedContact { id: string; name: string; type?: string | null; business_name?: string | null }

/** Find the CRM contact behind a caller ID, however the number was typed into the card. */
export async function matchContact(db: SupabaseClient, number: string | null, unit: string): Promise<MatchedContact | null> {
  const key = last10(number);
  if (key.length < 7) return null;
  const tail = key.slice(-4);
  // Cheap DB prefilter on the last four digits, exact comparison in code.
  const { data } = await db.from('crm_clients')
    .select('id, first_name, last_name, business_name, type, phone, cell_phone')
    .eq('business_unit', unit)
    .or(`phone.ilike.%${tail}%,cell_phone.ilike.%${tail}%`)
    .limit(50);
  for (const c of data ?? []) {
    if (last10(c.phone) === key || last10(c.cell_phone) === key) {
      const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || 'Contact';
      return { id: c.id, name, type: c.type, business_name: c.business_name };
    }
  }
  return null;
}

// ── The conversation ──────────────────────────────────────────────────────────
export interface Turn { role: 'bot' | 'caller'; text: string }

export interface BotReply {
  say: string;
  action: 'continue' | 'end' | 'transfer';
  caller_name?: string | null;
  callback_number?: string | null;
  intent?: string | null;
  property?: string | null;
  needs_follow_up?: boolean;
}

function systemPrompt(s: VoicebotSettings, ctx: { callerNumber: string | null; contact: MatchedContact | null; now: string }): string {
  const d = DEFAULTS[s.business_unit] ?? DEFAULTS.commercial;
  const company = s.company_name || d.company;
  return `You are ${s.bot_name}, the phone receptionist for ${company}. You are answering a live phone call; your words are read aloud by text-to-speech.

About the company: ${d.blurb}

Your job on this call:
1. Find out who is calling and what they need (a property they saw, a lease question, a showing, a tenant/maintenance issue at a building we manage, a general enquiry).
2. If they ask about one of our listings, answer from the CURRENT LISTINGS fact sheet below: what it is, where it is, size, rate or price, key features, whether it is still active or pending. Read numbers naturally ("about sixteen thousand square feet", "ten dollars a foot"). If the caller is vague, ask which property or what they are looking for (type, area, size) and name the one or two that fit. Never mention a property that is not on the sheet, and never guess a detail the sheet doesn't give.
3. When a question goes beyond the sheet — or they want to see the space, make an offer, or talk terms — say an agent will get them that answer, and collect what the agent needs to call back: their name, the best number (confirm the caller ID number ${ctx.callerNumber ? prettyPhone(ctx.callerNumber) : 'is unknown, so ask for one'} if they don't offer another), and which property or matter it concerns.
4. Reassure them an agent will call back promptly, then end politely. Do not stretch the call: three to five exchanges is typical. Always get a name and number before ending unless the caller refuses or is a wrong number.
${s.transfer_number ? `5. If the caller insists on speaking to a person right now, or describes an urgent building emergency (flooding, fire, no power, break-in), use action "transfer".` : `5. There is no live transfer available on this line; for an urgent building emergency, tell them an agent will be alerted immediately and collect the details.`}

Rules:
- Speak like a warm, competent front-desk person: short sentences, plain words, no lists, no markdown, no emojis. One question at a time.
- Never invent prices, availability, square footage, lease terms, or appointment times beyond what the listing sheet says. Say an agent will confirm.
- Never promise a specific callback time beyond "as soon as possible" or "during business hours".
- Do not ask for or repeat sensitive data (card numbers, SSN).
- If the caller is a vendor or sales call, take a brief message and end.
- If the caller says goodbye, has no further needs, or has left all the details, end the call with a brief goodbye.
- If you couldn't hear them (empty or garbled input), say so briefly and ask again; after two failed attempts, ask them to leave their name and number and end.
${ctx.contact ? `\nThe caller ID matches an existing contact in our CRM: ${ctx.contact.name}${ctx.contact.business_name ? ` (${ctx.contact.business_name})` : ''}${ctx.contact.type ? `, ${ctx.contact.type}` : ''}. Greet them by first name and confirm it's them.` : ''}
${s.instructions ? `\nExtra instructions from the brokerage:\n${s.instructions}` : ''}
The current date and time is ${ctx.now} (Central Time).

Respond with ONLY a JSON object, nothing else:
{"say": "<what to say next, spoken text>", "action": "continue" | "end" | "transfer", "caller_name": "<name if learned, else null>", "callback_number": "<digits if learned, else null>", "intent": "<3-8 word label of what they want, else null>", "property": "<the listing title from the sheet they asked about, else null>", "needs_follow_up": true|false}
"say" is required and must be non-empty even when action is "end" or "transfer" (it is spoken before hanging up or transferring).`;
}

function parseReply(text: string): BotReply | null {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1));
    if (!j || typeof j.say !== 'string' || !j.say.trim()) return null;
    const action: BotReply['action'] = j.action === 'end' || j.action === 'transfer' ? j.action : 'continue';
    return {
      say: j.say.trim(), action,
      caller_name: typeof j.caller_name === 'string' && j.caller_name.trim() ? j.caller_name.trim() : null,
      callback_number: typeof j.callback_number === 'string' && j.callback_number.replace(/\D/g, '').length >= 7 ? toE164(j.callback_number) : null,
      intent: typeof j.intent === 'string' && j.intent.trim() ? j.intent.trim().slice(0, 80) : null,
      property: typeof j.property === 'string' && j.property.trim() ? j.property.trim().slice(0, 120) : null,
      needs_follow_up: j.needs_follow_up !== false,
    };
  } catch { return null; }
}

const centralNow = () => new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * One turn of the conversation. `history` is everything said so far (bot + caller,
 * in order); the last entry is the caller's newest utterance.
 */
export async function nextReply(s: VoicebotSettings, history: Turn[], ctx: { callerNumber: string | null; contact: MatchedContact | null }): Promise<BotReply> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [];
  // Claude's own lines are assistant turns; the caller's are user turns. The API
  // needs a user message first, so an opening greeting is folded into the first turn.
  let pendingBot: string[] = [];
  for (const t of history) {
    if (t.role === 'bot') { pendingBot.push(t.text); continue; }
    if (pendingBot.length && messages.length) messages.push({ role: 'assistant', content: JSON.stringify({ say: pendingBot.join(' '), action: 'continue' }) });
    const prefix = !messages.length && pendingBot.length ? `[You already said: "${pendingBot.join(' ')}"]\n` : '';
    messages.push({ role: 'user', content: `${prefix}Caller said: ${t.text || '(nothing audible)'}` });
    pendingBot = [];
  }
  if (!messages.length) messages.push({ role: 'user', content: 'Caller said: (nothing audible yet)' });
  if (messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: 'Caller said: (silence)' });

  // The listing sheet is its own block, cached separately: it changes every few
  // minutes at most, while the prompt's timestamp changes every turn.
  const sheet = await listingFactSheet(s.business_unit);
  const system: Anthropic.TextBlockParam[] = sheet.text
    ? [{ type: 'text', text: sheet.text, cache_control: { type: 'ephemeral' } }, { type: 'text', text: systemPrompt(s, { ...ctx, now: centralNow() }) }]
    : [{ type: 'text', text: systemPrompt(s, { ...ctx, now: centralNow() }), cache_control: { type: 'ephemeral' } }];
  try {
    const res = await client.messages.create({
      model: VOICEBOT_MODEL,
      max_tokens: 400,
      // Phone latency matters more than depth here; low effort keeps replies to a couple of seconds.
      output_config: { effort: 'low' },
      system,
      messages,
    });
    if (res.stop_reason === 'refusal') return { say: "I'm sorry, I didn't catch that. Could you tell me your name and the best number to reach you?", action: 'continue' };
    const text = res.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('');
    return parseReply(text) ?? { say: "Sorry, could you say that again?", action: 'continue' };
  } catch (e) {
    console.error('[voicebot] nextReply', e);
    return { say: "I'm having trouble hearing you. Please leave your name and number after the tone and an agent will call you back.", action: 'end' };
  }
}

export function defaultGreeting(s: VoicebotSettings, contact: MatchedContact | null): string {
  if (s.greeting?.trim()) return s.greeting.trim();
  const company = s.company_name || (DEFAULTS[s.business_unit] ?? DEFAULTS.commercial).company;
  const first = contact?.name?.split(' ')[0];
  return first
    ? `Thanks for calling ${company}, this is ${s.bot_name}. Is this ${first}? How can I help you today?`
    : `Thanks for calling ${company}, this is ${s.bot_name}. Our agents are with other clients right now, but I can take the details and have someone call you back. May I have your name?`;
}

// ── After the call ────────────────────────────────────────────────────────────
export interface CallSummary { summary: string; intent: string | null; property: string | null; caller_name: string | null; callback_number: string | null; needs_follow_up: boolean; urgency: 'low' | 'normal' | 'high' }

export async function summarizeCall(turns: Turn[], ctx: { callerNumber: string | null; contact: MatchedContact | null }): Promise<CallSummary | null> {
  if (!turns.some(t => t.role === 'caller' && t.text.trim())) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const transcript = turns.map(t => `${t.role === 'bot' ? 'Receptionist' : 'Caller'}: ${t.text}`).join('\n');
  try {
    const res = await client.messages.create({
      model: VOICEBOT_MODEL,
      max_tokens: 600,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: `This is the transcript of a phone call our AI receptionist answered for a real estate brokerage. Caller ID: ${ctx.callerNumber ? prettyPhone(ctx.callerNumber) : 'unknown'}${ctx.contact ? ` (CRM contact: ${ctx.contact.name})` : ''}.

${transcript}

Write the note an agent needs before calling back. Respond with ONLY JSON:
{"summary": "<2-4 plain sentences: who called, what they want, what they were told, what still needs an answer from an agent>", "intent": "<3-8 word label>", "property": "<the listing or building they asked about, or null>", "caller_name": "<name or null>", "callback_number": "<digits or null>", "needs_follow_up": true|false, "urgency": "low"|"normal"|"high"}
needs_follow_up is false only for wrong numbers, spam/sales calls, or callers who explicitly said no callback is needed. urgency is high for building emergencies or a caller ready to transact now.` }],
    });
    if (res.stop_reason === 'refusal') return null;
    const text = res.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('');
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0) return null;
    const j = JSON.parse(text.slice(start, end + 1));
    return {
      summary: String(j.summary || '').trim() || 'Call answered by the voice bot.',
      intent: j.intent ? String(j.intent).slice(0, 80) : null,
      property: j.property ? String(j.property).slice(0, 120) : null,
      caller_name: j.caller_name ? String(j.caller_name).slice(0, 80) : null,
      callback_number: j.callback_number ? toE164(String(j.callback_number)) : null,
      needs_follow_up: j.needs_follow_up !== false,
      urgency: j.urgency === 'high' ? 'high' : j.urgency === 'low' ? 'low' : 'normal',
    };
  } catch (e) { console.error('[voicebot] summarizeCall', e); return null; }
}

/** Email the agents what just happened so a callback isn't waiting on someone opening the CRM. */
export async function notifyCallSummary(s: VoicebotSettings, call: {
  id: string; from_number: string | null; caller_name: string | null; contact: MatchedContact | null; started_at: string; duration_sec: number | null;
  summary: string; intent: string | null; property?: string | null; callback_number: string | null; urgency: string; transcript: string;
}): Promise<void> {
  const to = (s.notify_emails ?? []).filter(Boolean);
  if (!to.length) return;
  const { from, apiKey } = resendConfig(s.business_unit);
  if (!apiKey) return;
  const who = call.caller_name || call.contact?.name || 'Unknown caller';
  const num = call.callback_number || call.from_number;
  const when = new Date(call.started_at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
  const subject = `${call.urgency === 'high' ? '🚨 ' : ''}📞 ${who}${call.property ? ` · ${call.property}` : ''}${call.intent ? ` — ${call.intent}` : ''}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="border-bottom:3px solid #c9922c;padding:14px 0 10px"><span style="font-size:18px;font-weight:800;color:#c9922c">${esc(s.company_name || 'CRM')} · Voice bot answered a call</span></div>
    <div style="padding:16px 2px;font-size:15px;line-height:1.55">
      <p><strong>${esc(who)}</strong>${call.contact ? ' <span style="color:#6b7280">(existing contact)</span>' : ''}<br>
      ${num ? `<a href="tel:${esc(num)}" style="color:#1d4ed8">${esc(prettyPhone(num))}</a>` : 'No number captured'} · ${esc(when)}${call.duration_sec ? ` · ${Math.round(call.duration_sec / 60)} min` : ''}</p>
      <p style="background:#faf7ef;border-left:3px solid #c9922c;padding:10px 12px;border-radius:4px">${esc(call.summary)}</p>
      <p><a href="https://www.fairoaksrealtygroup.com/crm/${s.business_unit}#calls" style="background:#c9922c;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px;display:inline-block">Open the Calling Log</a></p>
      <details><summary style="color:#6b7280;cursor:pointer">Transcript</summary><pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:#374151">${esc(call.transcript)}</pre></details>
    </div></div>`;
  try { await new Resend(apiKey).emails.send({ from, to, subject, html }); }
  catch (e) { console.warn('[voicebot] notify', e); }
}

export function flattenTranscript(turns: Turn[]): string {
  return turns.map(t => `${t.role === 'bot' ? 'Bot' : 'Caller'}: ${t.text}`).join('\n');
}
