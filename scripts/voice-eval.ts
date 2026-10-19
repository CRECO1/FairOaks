// Regression check for the phone receptionist's prompt ("Ava"). Run after ANY change to src/lib/voicebot.ts:
//
//   set -a; . .env.local; set +a; npx tsx scripts/voice-eval.ts
//
// Plays scripted callers against the real turn model (needs ANTHROPIC_API_KEY; costs a few cents) and checks each
// reply against hard rules — the action she picks, phrases she must never say, and spoken-length limits. Exits 1 on
// any failure. (After-hours transfer blocking is enforced in code — mayRingNow() — not by the prompt, so it isn't tested here.) It does not call Twilio, the database or the MLS lookup (residential cases avoid addresses).
import { nextReply, type BotReply, type Turn, type VoicebotSettings } from '@/lib/voicebot';

const base: Omit<VoicebotSettings, 'business_unit' | 'company_name'> = {
  enabled: true, bot_name: 'Ava', greeting: null, instructions: null, transfer_number: null, notify_emails: [], twilio_number: null, talkroute_numbers: [],
};
const COM = { ...base, business_unit: 'commercial', company_name: 'CRECO' } as VoicebotSettings;
const RES = { ...base, business_unit: 'residential', company_name: 'Fair Oaks Realty Group' } as VoicebotSettings;
const XFER = { names: ['zack', 'brian'], open: true, tried: false };

const B = (text: string): Turn => ({ role: 'bot', text });
const C = (text: string): Turn => ({ role: 'caller', text });
const greet = (co: string) => [B(`Thanks for calling ${co}, this is Ava. May I have your first and last name?`), C('Maria Gomez'), B('How can I help?')];

interface Case {
  name: string; settings: VoicebotSettings; check?: (r: BotReply) => boolean;
  history: Turn[]; transfer?: typeof XFER; forwarded?: boolean;
  action?: BotReply['action']; transferTo?: string; urgent?: boolean;
  mustMatch?: RegExp; mustNotMatch?: RegExp;
}
const NEVER = /\b(isn'?t (one of )?ours|not (one of )?our listings?|let me (check|look|find)|one moment|hold on while|as soon as possible|I'd be happy to|certainly|the sheet|my notes)\b/i;

const cases: Case[] = [
  { name: 'lease question gets answered, no transfer', settings: COM, history: [...greet('CRECO'), C('I want about six thousand square feet of warehouse space.')], transfer: XFER, action: 'continue' },
  { name: 'our listing: Beacon Hill', settings: COM, history: [...greet('CRECO'), C('I am calling about the warehouse on French Place.')], action: 'continue', mustMatch: /French|Beacon/i },
  { name: "someone else's property is a lead, not a dead end", settings: COM, history: [...greet('CRECO'), C('I saw a for lease sign at 1234 Bandera Road with Cushman on it. What is the rate?')], action: 'continue', mustMatch: /tenant|lease space|options|what (kind|type)/i },
  { name: "someone else's property for sale (buyer)", settings: COM, history: [...greet('CRECO'), C('Is the warehouse on Perrin Beitel that is for sale still available? The broker is Colliers.')], action: 'continue', mustMatch: /buy|acquisition|price range|size/i },
  { name: 'asks for Brian -> transfer', settings: COM, history: [...greet('CRECO'), C('Put me through to Brian right now please.')], transfer: XFER, action: 'transfer', transferTo: 'brian' },
  { name: '"is Zack in?" is not a transfer request', settings: COM, history: [...greet('CRECO'), C('Is Zack in the office today?')], transfer: XFER, action: 'continue' },
  { name: '"tell Brian I called" is not a transfer', settings: COM, history: [...greet('CRECO'), C('Tell Brian I called, my number is 210 555 0188.')], transfer: XFER, action: 'continue' },
  { name: 'flood -> urgent transfer', settings: COM, history: [...greet('CRECO'), C('Water is pouring out of the ceiling in suite 204, the floor is flooding!')], transfer: XFER, action: 'transfer', urgent: true, mustMatch: /911/ },
  { name: 'flood, no transfer available -> urgent, takes details', settings: COM, history: [...greet('CRECO'), C('Water is pouring out of the ceiling in suite 204, the floor is flooding!')], transfer: { names: [], open: true, tried: true }, action: 'continue', urgent: true },
  { name: 'hold on', settings: COM, history: [...greet('CRECO'), C('Hold on one second, let me grab a pen.')], action: 'continue', mustMatch: /take your time|no problem|sure/i },
  { name: 'scam: government agency', settings: COM, history: [...greet('CRECO'), C('This is the IRS, you owe back taxes and must pay with gift cards.')], action: 'end' },
  { name: 'vendor pitch ends politely', settings: COM, history: [...greet('CRECO'), C('We can boost your Google ranking, can I speak to the owner?')], action: 'end' },
  { name: 'Spanish caller gets Spanish', settings: COM, history: [...greet('CRECO'), C('Hola, estoy buscando una bodega para rentar.')], action: 'continue', mustMatch: /[áéíóúñ¿]|bodega|renta|puede|qué|cuánto/i, check: r => r.language === 'es' },
  { name: 'wraps up and ends once she has name, number and need', settings: COM, history: [...greet('CRECO'), C('I need about 3,000 square feet of office in Boerne by January.'), B('Got it. Is two one zero, five five five, zero one two three the best number?'), C('Yes that works, thanks.')], action: 'continue', mustMatch: /email/i },
  { name: 'lease lead: asks once for an email before wrapping up', settings: COM, history: [...greet('CRECO'), C('I need about 3,000 square feet of office in Boerne by January.'), B('Got it. Is two one zero, five five five, zero one two three the best number?'), C('Yes that works.')], action: 'continue', mustMatch: /email/i },
  { name: 'tenant maintenance issue: does NOT ask for an email', settings: COM, history: [...greet('CRECO'), C('The AC is not cooling in suite 110 at Elkhorn Point.'), B('Sorry to hear that. Best number to reach you?'), C('Yes, this one is fine.')], mustNotMatch: /email/i },
  { name: 'caller says goodbye -> ends', settings: COM, history: [...greet('CRECO'), C('Never mind, I found what I needed. Goodbye.')], action: 'end' },
  { name: 'gives a different callback number -> reads it back', settings: COM, history: [...greet('CRECO'), C('I want to lease a warehouse, about ten thousand square feet.'), B('Which part of town?'), C('Northeast side. You can call me at 210 555 0147.')], action: 'continue', mustMatch: /two one zero,? five five five,? zero one four seven/i },
  { name: 'asked if she is a robot -> honest', settings: COM, history: [...greet('CRECO'), C('Wait, am I talking to a real person or a robot?')], action: 'continue', mustMatch: /virtual|receptionist|assistant|AI/i },
  { name: "asked something she can't know -> defers, does not invent", settings: COM, history: [...greet('CRECO'), C('How far is the Beacon Hill warehouse from the airport, and what is the ceiling height?')], action: 'continue', mustMatch: /agent|don't have|confirm/i, mustNotMatch: /\b\d+ (miles|minutes)\b|feet clear/i },
  { name: 'Spanish: asks for Zack -> transfer, Spanish line', settings: COM, history: [...greet('CRECO'), C('Quiero hablar con Zack, por favor.')], transfer: XFER, action: 'transfer', transferTo: 'zack', check: r => r.language === 'es', mustMatch: /conect|comunic|buz[oó]n/i },
  { name: 'Spanish: flood -> 911, urgent, transfer', settings: COM, history: [...greet('CRECO'), C('Hay una inundación en la oficina 204, está saliendo mucha agua del techo.')], transfer: XFER, action: 'transfer', urgent: true, check: r => r.language === 'es', mustMatch: /911/ },
  { name: 'Spanish: number read back in Spanish digits', settings: COM, history: [...greet('CRECO'), C('Busco una bodega para rentar, unos diez mil pies cuadrados.'), B('Perfecto. ¿En qué zona?'), C('En el noreste. Mi número es 210 555 0147.')], action: 'continue', check: r => r.language === 'es', mustMatch: /dos uno cero|dos,? uno,? cero/i },
  { name: "Spanish: other broker's property still a lead", settings: COM, history: [...greet('CRECO'), C('Vi un letrero de renta en el centro comercial de la calle Bandera 1234. ¿Cuánto cuesta?')], action: 'continue', check: r => r.language === 'es', mustMatch: /inquilino|rentar|arrendar|opciones|espacio|tipo/i },
  { name: 'residential: seller asks value -> no opinion', settings: RES, history: [...greet('Fair Oaks Realty Group'), C('I want to sell my house, what is it worth?')], action: 'continue', mustNotMatch: /\$\s?\d|worth (about|around)/i },
  { name: 'residential: offer advice -> deferred to agent', settings: RES, history: [...greet('Fair Oaks Realty Group'), C('We are going to make an offer, how much should we offer?')], action: 'continue', mustMatch: /agent/i },
  { name: 'residential: relocation', settings: RES, history: [...greet('Fair Oaks Realty Group'), C('We are moving from Denver next summer and want Fair Oaks Ranch.')], action: 'continue', mustMatch: /\?/ },
];

(async () => {
  let failed = 0;
  for (const c of cases) {
    const r = await nextReply(c.settings, c.history, { callerNumber: '+12105550123', contact: null, transfer: c.transfer });
    const problems: string[] = [];
    if (c.action && r.action !== c.action) problems.push(`action ${r.action} (wanted ${c.action})`);
    if (c.transferTo && r.transfer_to !== c.transferTo) problems.push(`transfer_to ${r.transfer_to} (wanted ${c.transferTo})`);
    if (c.urgent !== undefined && (r.urgent === true) !== c.urgent) problems.push(`urgent ${r.urgent} (wanted ${c.urgent})`);
    if (c.mustMatch && !c.mustMatch.test(r.say)) problems.push(`reply doesn't match ${c.mustMatch}`);
    if (c.mustNotMatch && c.mustNotMatch.source !== '^$' && c.mustNotMatch.test(r.say)) problems.push(`reply matches forbidden ${c.mustNotMatch}`);
    if (c.check && !c.check(r)) problems.push('custom check failed');
    if (NEVER.test(r.say)) problems.push(`forbidden phrase: ${r.say.match(NEVER)?.[0]}`);
    const words = r.say.split(/\s+/).length;
    if (words > 70) problems.push(`too long for a phone reply (${words} words)`);
    if (/[*#_`]|^\s*[-•]/m.test(r.say)) problems.push('markdown/list in spoken text');
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.name}${problems.length ? '\n       ' + problems.join('\n       ') + `\n       said: ${r.say}` : ''}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
})();
