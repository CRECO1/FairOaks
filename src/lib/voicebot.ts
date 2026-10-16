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
import { describeHome, listingFactSheet, searchHomes } from '@/lib/listing-knowledge';
import { line, type Lang } from '@/lib/voice-lines';

export const VOICEBOT_MODEL = process.env.VOICEBOT_MODEL || 'claude-opus-5';
// Phone turns are latency-bound. VOICEBOT_THINKING=off skips reasoning on the live turns
// (the post-call summary keeps adaptive thinking; nobody is waiting on it).
const TURN_THINKING: { thinking?: { type: 'disabled' } } = process.env.VOICEBOT_THINKING === 'off' ? { thinking: { type: 'disabled' } } : {};

/**
 * The model for LIVE phone turns — a caller is waiting on every one. Opus took a
 * median 3.3 s (p90 5.1 s) per reply in Sept–Oct 2026, which with speech detection
 * and TTS left callers in 4–6 s of silence. Tested 2026-10-07 on real call scripts
 * with the live listing sheet: Opus 5 3.6 s avg, Sonnet 5.5 1.6 s median / 1.9 s avg
 * with the same accuracy, Haiku 4.5 1.5 s but misstated a listing's acreage — so
 * Sonnet 5.5. The post-call summary stays on VOICEBOT_MODEL, where nobody is waiting.
 * Override with VOICEBOT_TURN_MODEL; if that model ever errors, the turn retries
 * once on VOICEBOT_MODEL rather than dropping the caller.
 */
export const VOICEBOT_TURN_MODEL = process.env.VOICEBOT_TURN_MODEL || 'claude-sonnet-5-5';
// Haiku 4.5 rejects output_config.effort and has no thinking unless asked, so it gets neither.
const turnOptions = (model: string) => (/haiku/i.test(model) ? {} : { output_config: { effort: 'low' as const } });

export interface VoicebotSettings {
  business_unit: string; enabled: boolean; bot_name: string; company_name: string | null;
  greeting: string | null; instructions: string | null; transfer_number: string | null;
  notify_emails: string[]; twilio_number: string | null; talkroute_numbers: string[]; updated_at?: string;
  /** Every missed call / voicemail / bot call-back in this workspace is assigned to this agent (null = the ownership rules in lib/call-routing.ts). */
  missed_call_assignee?: string | null;
}

const DEFAULTS: Record<string, { company: string; blurb: string; website: string; phone: string }> = {
  commercial: {
    company: 'CRECO',
    website: 'crecotx dot com',
    phone: 'two one zero, eight one seven, three four four three',
    blurb: 'CRECO (Commercial Real Estate Co.) is a commercial real estate brokerage in the San Antonio / Texas Hill Country area: office, retail, industrial and land — leasing, sales, tenant and landlord representation, and property management including the Fair Oaks Plaza office park at 8000 Fair Oaks Parkway.',
  },
  residential: {
    company: 'Fair Oaks Realty Group',
    website: 'fair oaks realty group dot com',
    phone: 'two one zero, three nine zero, nine nine nine seven',
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

export interface MatchedContact { id: string; name: string; type?: string | null; business_name?: string | null; first?: string | null }

/** "LIANG" / "liang" → "Liang". Mixed case is left alone (McDonald, DeLeon). */
function niceCase(s: string): string {
  const t = s.trim();
  return t === t.toUpperCase() || t === t.toLowerCase() ? t.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_m, a, b) => a + b.toUpperCase()) : t;
}
/** A first name we can safely say aloud — never a placeholder ("Contact"), a phone number, an email, or a company word. */
export function spokenFirstName(raw: string | null | undefined): string | null {
  const f = String(raw ?? '').trim().split(/\s+/)[0];
  if (!/^[A-Za-z][A-Za-z'’-]{1,19}$/.test(f)) return null;
  if (/^(contact|unknown|caller|customer|client|tenant|owner|broker|agent|admin|info|sales|office|mr|mrs|ms|dr)$/i.test(f)) return null;
  return niceCase(f);
}

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
      // Greet only by a real PERSON'S first name. A company-only card ("Texas Plumbing Supply") or a placeholder
      // ("Unknown caller (210) …") used to be greeted as "Is this Texas?" / "Is this Contact?".
      const person = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
      const first = spokenFirstName(c.first_name);
      const name = person ? niceCase(person) : c.business_name || 'Contact';
      return { id: c.id, name, type: c.type, business_name: c.business_name, first };
    }
  }
  return null;
}

/**
 * Should this call use the multi-language recogniser (English + Spanish, no menu)?
 * VOICEBOT_MULTILINGUAL = on | off | test (default test). In test mode only the team's own phones
 * (profiles, our lines, and the phones the office lines forward to — i.e. Zack's cell) and VOICEBOT_MULTI_TEST_NUMBERS are switched on, so the new recogniser can be
 * proven on a real call before any customer hears it. Flip to `on` once it's confirmed.
 */
export async function multilingualEnabled(db: SupabaseClient, fromNumber: string | null, unit = 'commercial'): Promise<boolean> {
  const mode = (process.env.VOICEBOT_MULTILINGUAL || 'test').toLowerCase();
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const key = last10(fromNumber);
  if (key.length < 10) return false;
  if ((process.env.VOICEBOT_MULTI_TEST_NUMBERS || '').split(',').some(n => last10(n) === key)) return true;
  const { internalNumbers } = await import('@/lib/call-history');
  return (await internalNumbers(db, unit)).has(key);
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
  caller_email?: string | null;
  /** The language this reply is spoken in. Absent = unchanged (the route keeps whatever the call was already in). */
  language?: Lang | null;
  needs_follow_up?: boolean;
}

function systemPrompt(s: VoicebotSettings, ctx: { callerNumber: string | null; contact: MatchedContact | null; now: string }): string {
  const d = DEFAULTS[s.business_unit] ?? DEFAULTS.commercial;
  const company = s.company_name || d.company;
  return `You are ${s.bot_name}, the phone receptionist for ${company}. You are answering a live phone call; your words are read aloud by text-to-speech.

About the company: ${d.blurb}

Your job on this call:
1. Find out who is calling and what they need (a property they saw, a lease question, a showing, a tenant/maintenance issue at a building we manage, a general enquiry).
2. If they ask about one of our listings, answer from the ${s.business_unit === 'residential' ? 'OUR OWN LISTINGS sheet below — and for any other home, call the lookup_listings tool first, then answer from what it returns (any licensed agent can show any MLS listing, so offer a showing and take details)' : 'CURRENT LISTINGS fact sheet below'}: what it is, where it is, size, rate or price, key features, whether it is still active or pending. Read numbers naturally ("about sixteen thousand square feet", "ten dollars a foot"). If the caller is vague, ask which property or what they are looking for (type, area, size) and name the one or two that fit. Never guess a detail the sheet doesn't give. If a caller names a property that is not on the sheet, NEVER say it isn't ours or isn't one of our listings: say you don't have that one's details in front of you, that an agent will confirm, and take their name, number and the property name.
3. When a question goes beyond the sheet — or they want to see the space, make an offer, or talk terms — say an agent will get them that answer, and collect what the agent needs to call back: their name, the best number (confirm the caller ID number ${ctx.callerNumber ? prettyPhone(ctx.callerNumber) : 'is unknown, so ask for one'} if they don't offer another), and which property or matter it concerns.
4. Reassure them an agent will call back promptly, then end politely. Do not stretch the call: three to five exchanges is typical. Always get a name and number before ending unless the caller refuses or is a wrong number.
${s.transfer_number ? `5. If the caller insists on speaking to a person right now, or describes an urgent building emergency (flooding, fire, no power, break-in), use action "transfer".` : `5. There is no live transfer available on this line; for an urgent building emergency, tell them an agent will be alerted immediately and collect the details.`}

Language: callers may speak English or Spanish, and the speech recognizer transcribes whichever they speak. If the caller speaks Spanish, answer in natural, warm Latin-American Spanish for the rest of the call (say digits in Spanish too), set "language" to "es", and keep it that way unless they switch back; if they speak English, use "en". Switch the moment they do — never ask which language they prefer, never offer a menu. Property names and street addresses stay as they are. The JSON keys always stay in English.

People: Zachary "Zack" Stovall is the broker and owner; Brian Blanco is an agent. If a caller asks for either, or for "an agent" or "the broker", you cannot connect them on this line: say so kindly and that you will make sure they get the message. NEVER say someone is out, in a meeting, unavailable or busy — you don't know. Ask what it's about and for the best number.

Rules:
- Speak like a warm, competent front-desk person: short sentences, plain words, no lists, no markdown, no emojis. One question at a time.
- Keep every reply short — about two sentences, thirty words. When you describe a listing, give at most three facts (what and where, size, rate) and offer more; never recite the whole sheet, because a caller can't absorb it by ear.
- Say phone numbers as separate digit words in groups with commas ("two one zero, three five five, eight six eight three"), never as one number.
- Only name a property when the caller named it or clearly described it. If you think you know which one they mean, ask "Do you mean …?" — never state a guess as fact, and never put words in their mouth.
- If the caller says you got something wrong (a name, number, property, or what they asked), apologize in a few words, have them say it again, then repeat back exactly what they said and check it. Never defend or repeat a guess.
- You asked for first AND last name in the greeting. If they gave only a first name, ask for the last name ONCE, as its own short question ("And your last name?") just before you wrap up — never combined with another question; if they skip it, move on.
- Company facts you may share: ${d.blurb} Our website is ${d.website}; the main number is ${d.phone}. Services: tenant and landlord representation, leasing, investment and land sales, build-to-suit, site selection and property management. If you're asked anything about the company that isn't here, say an agent will answer it.
- You cannot send texts or emails from this line. If the caller wants information, a listing or a flyer sent to them, ask for their email address: have them say it slowly, read it back ("john dot smith at gmail dot com"), and only put it in caller_email once they confirm. Say an agent will send it — never promise a text.
- If someone asks whether you are a person or a robot, say plainly that you're the virtual receptionist, then carry on helping.
- The office is ${officeOpen() ? 'open now (Monday–Saturday, 8 a.m.–6 p.m. Central)' : 'closed now (hours are Monday–Saturday, 8 a.m.–6 p.m. Central)'}. ${officeOpen() ? '' : 'After hours, an agent calls back the next business morning; for a true building emergency say an agent will be alerted right away.'}
- ${s.business_unit === 'residential' ? 'The lookup_listings tool is the only thing you can look up, and only within this same reply.' : 'You cannot look anything up and there is no hold: everything you know is in the sheet below.'} Never say "let me check", "let me find that" or "one moment", and never ask the caller to wait.
- Never ask the caller to confirm something they already told you, and never ask the same question twice.
- As soon as you have their name, a callback number and what they need, thank them, say in one sentence what the agent will follow up on, and end the call (action "end").
- Never invent prices, availability, square footage, lease terms, or appointment times beyond what the listing sheet says. Say an agent will confirm.
- Never promise a specific callback time beyond "as soon as possible" or "during business hours".
- Do not ask for or repeat sensitive data (card numbers, SSN).
- If the caller is a vendor or sales call, take a brief message and end.
- If the caller claims to be a government agency (IRS, sheriff, a warrant), threatens legal action, or asks for payment, card or bank details, it is a scam: say once that you can't help with that and end the call (action "end"). Do not take a message from them.
- If the caller says goodbye, has no further needs, or has left all the details, end the call with a brief goodbye.
- If you couldn't hear them (empty or garbled input), say so briefly and ask again; after two failed attempts, ask them to leave their name and number and end.
${ctx.contact ? ctx.contact.first
  ? `\nThe caller ID matches an existing contact in our CRM: ${ctx.contact.name}${ctx.contact.business_name ? ` (${ctx.contact.business_name})` : ''}${ctx.contact.type ? `, ${ctx.contact.type}` : ''}. The greeting already asked if this is ${ctx.contact.first}; if they say no or give another name, go with what they tell you.`
  : `\nThe caller ID matches ${ctx.contact.business_name || ctx.contact.name} in our CRM, but we have no person's name on file. Don't guess a name — ask who is calling.` : ''}
${s.instructions ? `\nExtra instructions from the brokerage:\n${s.instructions}` : ''}
The current date and time is ${ctx.now} (Central Time).

Respond with ONLY a JSON object, nothing else:
{"say": "<what to say next, spoken text>", "language": "en" | "es", "action": "continue" | "end" | "transfer", "caller_name": "<name if learned, else null>", "callback_number": "<digits if learned, else null>", "intent": "<3-8 word label of what they want, else null>", "property": "<the listing title from the sheet they asked about, else null>", "caller_email": "<email address they gave and confirmed, else null>", "needs_follow_up": true|false}
"say" is required and must be non-empty even when action is "end" or "transfer" (it is spoken before hanging up or transferring). Your ENTIRE reply must be that JSON object, even for a one-line answer — never plain text, never text outside the braces.`;
}

// Residential only: the MLS feed is ~10k homes, so the bot looks them up instead of reading a sheet.
const LOOKUP_TOOL: Anthropic.Tool = {
  name: 'lookup_listings',
  description: 'Search homes currently for sale on the San Antonio / Hill Country MLS. Use when the caller names an address, an MLS number, a neighborhood, or describes what they want (city, bedrooms, budget). Returns up to 5 matches with price, beds, baths, size, status and the listing brokerage.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      mls_number: { type: ['string', 'null'], description: 'MLS number if the caller gave one' },
      address: { type: ['string', 'null'], description: 'Street address fragment, e.g. "10403 White Hart"' },
      city: { type: ['string', 'null'], description: 'City, e.g. "Boerne"' },
      zip: { type: ['string', 'null'], description: '5-digit ZIP' },
      subdivision: { type: ['string', 'null'], description: 'Neighborhood / subdivision name' },
      min_beds: { type: ['number', 'null'], description: 'Minimum bedrooms' },
      min_price: { type: ['number', 'null'], description: 'Minimum price in dollars' },
      max_price: { type: ['number', 'null'], description: 'Maximum price in dollars' },
      property_type: { type: ['string', 'null'], description: 'sfd | condo | townhome | land | multifamily' },
    },
    required: ['mls_number', 'address', 'city', 'zip', 'subdivision', 'min_beds', 'min_price', 'max_price', 'property_type'],
  },
};

async function runLookup(input: Record<string, unknown>): Promise<string> {
  const clean = <T,>(v: unknown): T | undefined => (v === null || v === undefined || v === '' ? undefined : (v as T));
  const homes = await searchHomes({
    mls_number: clean<string>(input.mls_number), address: clean<string>(input.address), city: clean<string>(input.city), zip: clean<string>(input.zip),
    subdivision: clean<string>(input.subdivision), min_beds: clean<number>(input.min_beds), min_price: clean<number>(input.min_price), max_price: clean<number>(input.max_price), property_type: clean<string>(input.property_type),
  });
  if (!homes.length) return 'No active listings match. Tell the caller you could not find it in the current MLS data and that an agent will check.';
  return homes.map(h => describeHome(h)).join('\n\n');
}

/** A plausible email address, lower-cased — or null. Spoken addresses are error-prone, so be strict. */
export function cleanEmail(v: unknown): string | null {
  const e = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e) && e.length <= 120 ? e : null;
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
      caller_email: cleanEmail(j.caller_email),
      language: j.language === 'es' ? 'es' : j.language === 'en' ? 'en' : null,
      needs_follow_up: j.needs_follow_up !== false,
    };
  } catch { return null; }
}

const centralNow = () => new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * One turn of the conversation. `history` is everything said so far (bot + caller,
 * in order); the last entry is the caller's newest utterance.
 */
export async function nextReply(s: VoicebotSettings, history: Turn[], ctx: { callerNumber: string | null; contact: MatchedContact | null; lang?: Lang }): Promise<BotReply> {
  const lang: Lang = ctx.lang ?? 'en';
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
    const tools = s.business_unit === 'residential' ? [LOOKUP_TOOL] : undefined;
    let model = VOICEBOT_TURN_MODEL;
    const ask = () => client.messages.create({
      model,
      // The budget covers the model's THINKING as well as the JSON answer. At 400 a long thought left the JSON
      // cut off mid-sentence, parseReply failed, and callers heard "Sorry, could you say that again?" on the very
      // turn they asked about a listing (reproduced 3 of 4 runs). Thinking is already capped by effort: low.
      max_tokens: 1800,
      // Phone latency matters more than depth here.
      ...turnOptions(model),
      // {type:'disabled'} is a 400 on the x.5 models and unneeded on Haiku. Sonnet 5.5 runs
      // fastest with its default light thinking at low effort (measured: 1.6 s median vs
      // 2.2 s with thinking switched off via 'between_tools').
      ...(tools || /haiku|-5-5/i.test(model) ? {} : TURN_THINKING),
      system,
      messages,
      ...(tools ? { tools } : {}),
    });
    let res: Anthropic.Message;
    try { res = await ask(); }
    catch (e) {
      if (model === VOICEBOT_MODEL || !(e instanceof Anthropic.APIError)) throw e;
      console.warn('[voicebot] turn model failed, retrying on', VOICEBOT_MODEL, e.status, e.message);
      model = VOICEBOT_MODEL;
      res = await ask();
    }
    // Manual tool loop, capped: at most two lookups per turn keeps the caller from waiting.
    for (let round = 0; round < 2 && res.stop_reason === 'tool_use'; round++) {
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        let out = 'lookup failed';
        try { out = u.name === 'lookup_listings' ? await runLookup(u.input as Record<string, unknown>) : 'unknown tool'; } catch (e) { console.warn('[voicebot] tool', e); }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: out });
      }
      messages.push({ role: 'assistant', content: res.content });
      messages.push({ role: 'user', content: results });
      res = await ask();
    }
    if (res.stop_reason === 'refusal') return { say: line('noCatch', lang), action: 'continue' };
    const text = res.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('');
    const parsed = parseReply(text);
    if (parsed) return parsed;
    // Truncated or malformed: salvage the spoken line if it is intact, else the caller is better served by
    // a plain re-ask than by silence — but log it, so a recurrence is visible.
    console.warn('[voicebot] unparseable reply', res.stop_reason, text.slice(0, 160));
    // The model sometimes answers in plain prose instead of the JSON envelope. If it's clean speech (no braces),
    // say it as-is — far better than "say that again" to a caller who just asked a clear question.
    const prose = text.replace(/```[\s\S]*?```/g, '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
    if (!/[{}]/.test(prose) && prose.length >= 8 && prose.length <= 700) return { say: prose, action: 'continue' };
    const m = text.match(/"say"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) { try { const say = JSON.parse(`"${m[1]}"`) as string; if (say.trim()) return { say: say.trim(), action: 'continue' }; } catch { /* fall through */ } }
    return { say: line('sorryRepeat', lang), action: 'continue' };
  } catch (e) {
    console.error('[voicebot] nextReply', e);
    return { say: line('trouble', lang), action: 'end' };
  }
}

/** Office hours (Central): Mon–Sat 8am–6pm, matching the Talkroute business-hours schedule. */
export function officeOpen(at: Date = new Date()): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(at).map(x => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return p.weekday !== 'Sun' && hour >= 8 && hour < 18;
}

export function defaultGreeting(s: VoicebotSettings, contact: MatchedContact | null, at: Date = new Date()): string {
  if (s.greeting?.trim()) return s.greeting.trim();
  const company = s.company_name || (DEFAULTS[s.business_unit] ?? DEFAULTS.commercial).company;
  const first = contact?.first ?? null;
  if (first) return `Thanks for calling ${company}, this is ${s.bot_name}. Is this ${first}? How can I help you today?`;
  // Honest about why we picked up: in business hours the team is on other calls; after hours the office is closed.
  return officeOpen(at)
    ? `Thanks for calling ${company}, this is ${s.bot_name}. Everyone is helping other clients right now, so I'll take your details and get you a call back. May I have your first and last name?`
    : `Thanks for calling ${company}, this is ${s.bot_name}. Our office is closed right now, but I can take your details and an agent will call you back. May I have your first and last name?`;
}

// ── After the call ────────────────────────────────────────────────────────────
export type LeadType = 'prospective_tenant' | 'buyer' | 'property_owner' | 'seller' | 'broker' | 'current_tenant' | 'vendor' | 'other';
export const LEAD_LABEL: Record<LeadType, string> = { prospective_tenant: 'Prospective tenant', buyer: 'Buyer', property_owner: 'Property owner', seller: 'Seller', broker: 'Broker / agent', current_tenant: 'Current tenant', vendor: 'Vendor', other: 'Other' };
const LEAD_TYPES = Object.keys(LEAD_LABEL) as LeadType[];
export interface CallSummary { language: Lang; summary: string; intent: string | null; property: string | null; caller_name: string | null; callback_number: string | null; caller_email: string | null; needs_follow_up: boolean; urgency: 'low' | 'normal' | 'high'; lead_type: LeadType; hot: boolean }

export async function summarizeCall(turns: Turn[], ctx: { callerNumber: string | null; contact: MatchedContact | null }): Promise<CallSummary | null> {
  if (!turns.some(t => t.role === 'caller' && t.text.trim())) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const transcript = turns.map(t => `${t.role === 'bot' ? 'Receptionist' : 'Caller'}: ${t.text}`).join('\n');
  try {
    const res = await client.messages.create({
      model: VOICEBOT_MODEL,
      max_tokens: 1500,   // thinking shares this budget; 600 risked a truncated JSON (and a lost summary) on a long call
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: `This is the transcript of a phone call our AI receptionist answered for a real estate brokerage. Caller ID: ${ctx.callerNumber ? prettyPhone(ctx.callerNumber) : 'unknown'}${ctx.contact ? ` (CRM contact: ${ctx.contact.name})` : ''}.

${transcript}

Write the note an agent needs before calling back. Respond with ONLY JSON:
{"summary": "<2-4 plain sentences: who called, what they want, what they were told, what still needs an answer from an agent>", "intent": "<3-8 word label>", "property": "<the listing or building they asked about, or null>", "caller_name": "<name or null>", "callback_number": "<digits or null>", "caller_email": "<email they gave or null>", "needs_follow_up": true|false, "urgency": "low"|"normal"|"high", "lead_type": "prospective_tenant"|"buyer"|"property_owner"|"seller"|"broker"|"current_tenant"|"vendor"|"other", "hot": true|false, "language": "en"|"es"}
needs_follow_up is false only for wrong numbers, spam/sales calls, silent calls where the caller never said anything usable, or callers who explicitly said no callback is needed. For those, start the intent with exactly \"Silent call\", \"Wrong number\" or \"Spam / robocall\" (the Calling Log closes them on those words). urgency is "high" ONLY for a genuine emergency — flooding, fire, a break-in, no power, a gas smell, anyone in danger — or a caller who says it is an emergency. Routine maintenance (an AC not cooling), a tour request, a pricing question, a caller ready to sign, or an upset caller are "normal" (a caller ready to transact is flagged by hot, not urgency). language is "es" if the caller spoke Spanish for most of the call (then begin the summary with "Spanish-speaking caller — " and say the agent should call back in Spanish if possible), else "en". Always write the summary in English. lead_type: prospective_tenant = wants to lease space; buyer = wants to buy; property_owner = owns a property and wants to lease, list, manage or sell it (use seller only for a clear intent to sell now); broker = another broker or agent; current_tenant = already leases from us (maintenance, rent, lease question); vendor = selling us a service. hot is true only for a decision-maker with a specific, current need — an owner ready to list or sell, a tenant with a defined size, area and timeline, or anyone ready to tour or transact — never for vague enquiries, brokers fishing, vendors or spam.` }],
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
      caller_email: cleanEmail(j.caller_email),
      needs_follow_up: j.needs_follow_up !== false,
      urgency: j.urgency === 'high' ? 'high' : j.urgency === 'low' ? 'low' : 'normal',
      language: j.language === 'es' ? 'es' : 'en',
      lead_type: (LEAD_TYPES as string[]).includes(j.lead_type) ? j.lead_type as LeadType : 'other',
      hot: j.hot === true,
    };
  } catch (e) { console.error('[voicebot] summarizeCall', e); return null; }
}

/** Email the agents what just happened so a callback isn't waiting on someone opening the CRM. */
export async function notifyCallSummary(s: VoicebotSettings, call: {
  id: string; from_number: string | null; caller_name: string | null; contact: MatchedContact | null; started_at: string; duration_sec: number | null;
  summary: string; intent: string | null; property?: string | null; callback_number: string | null; urgency: string; transcript: string;
  email?: string | null; lead_type?: LeadType | null; hot?: boolean; language?: Lang | null;
}): Promise<void> {
  const to = (s.notify_emails ?? []).filter(Boolean);
  if (!to.length) return;
  const { from, apiKey } = resendConfig(s.business_unit);
  if (!apiKey) return;
  const who = call.caller_name || call.contact?.name || 'Unknown caller';
  const num = call.callback_number || call.from_number;
  const when = new Date(call.started_at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
  const label = call.lead_type && call.lead_type !== 'other' ? LEAD_LABEL[call.lead_type] : null;
  const subject = `${call.urgency === 'high' ? '🚨 ' : call.hot ? '🔥 ' : ''}📞 ${who}${call.language === 'es' ? ' 🇪🇸 (Spanish)' : ''}${label ? ` [${label}]` : ''}${call.property ? ` · ${call.property}` : ''}${call.intent ? ` — ${call.intent}` : ''}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="border-bottom:3px solid #c9922c;padding:14px 0 10px"><span style="font-size:18px;font-weight:800;color:#c9922c">${esc(s.company_name || 'CRM')} · Voice bot answered a call</span></div>
    <div style="padding:16px 2px;font-size:15px;line-height:1.55">
      <p><strong>${esc(who)}</strong>${call.contact ? ' <span style="color:#6b7280">(existing contact)</span>' : ''}<br>
      ${num ? `<a href="tel:${esc(num)}" style="color:#1d4ed8">${esc(prettyPhone(num))}</a>` : 'No number captured'}${call.email ? ` · <a href="mailto:${esc(call.email)}" style="color:#1d4ed8">${esc(call.email)}</a>` : ''} · ${esc(when)}${call.duration_sec ? ` · ${Math.round(call.duration_sec / 60)} min` : ''}</p>
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
