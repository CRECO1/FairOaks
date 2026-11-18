// Heuristic "does this email look like a scam?" check for the CRM inbox. Pure and client-safe (no imports).
// It only WARNS — nothing is hidden, moved or deleted. Each signal has a weight; a warning shows at 3+ points (loosened 2026-11-18: Reply-To mismatch and failed sender checks, both common on legit newsletters/forwards, now count 1 each; bulk/marketing mail ignores Reply-To and tracked-link mismatches, and known click-tracker hosts never count).
export type PhishInput = {
  from: string; subject?: string; text?: string; html?: string; replyTo?: string; authFail?: boolean;
  attachments?: { name: string }[];
  teamNames?: string[];          // display names of people on our team (impersonation check)
  ownDomains?: string[];         // domains that are really ours
  senderKnown?: boolean;         // sender is a contact/deal in the CRM
  bulk?: boolean;                // marketing/automated mail (List-Unsubscribe or a no-reply style sender): a different Reply-To and tracked links are normal there
};
export type PhishResult = { score: number; reasons: string[] };

const OWN = ['crecotx.com', 'fairoaksrealtygroup.com', 'fairoaksranchplaza.com', 'elkhornpoint.com'];
const FREE = /(^|\.)(gmail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|comcast|att|sbcglobal|verizon|proton|protonmail|mail|gmx)\.(com|net|me)$/i;
const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rb\.gy|cutt\.ly|tiny\.cc|shorturl\.at)$/i;
const RISKY_EXT = /\.(exe|scr|bat|cmd|com|js|jse|vbs|vbe|wsf|jar|msi|iso|img|lnk|hta|html?|shtml|docm|xlsm|pptm|one|svg)$/i;
const DOUBLE_EXT = /\.(pdf|docx?|xlsx?|jpe?g|png|txt)\.(exe|scr|bat|cmd|js|vbs|jar|lnk|html?|zip)$/i;

const MOVE_TO_TEXT = [
  /\b(what(?:'s| is)?|which)\b[^.?\n]{0,40}\b(number|cell|mobile)\b[^.?\n]{0,40}\b(text|reach|contact|message)\b/i,
  /\b(text|message|whatsapp|telegram|signal)\s+(me|you)\b[^.?\n]{0,50}\b(number|cell|phone|different|new)\b/i,
  /\b(from|at|on)\s+(a\s+)?(different|another|new|personal)\s+(number|phone|cell)\b/i,
  /\bpreferred (number|cell|phone)\b/i,
  /\b(best|your)\s+(cell|mobile|personal)\s+(number|phone)\b[^.?\n]{0,30}\b(text|reach)/i,
];
const MONEY = [
  /\bgift\s*cards?\b/i, /\b(itunes|apple|google\s*play|amazon|steam|target)\s+cards?\b/i,
  /\bwire\s+(transfer|funds|the|me|payment)\b/i, /\b(bitcoin|btc|crypto(currency)?|usdt|zelle)\b/i,
  /\b(change|update|new)\s+(of\s+)?(our\s+|my\s+|the\s+)?(bank|banking|routing|account|payment)\s+(details|info|information|number|instructions)\b/i,
  /\bare you (available|at your desk|free)\b[^.?\n]{0,30}\b(task|favor|quick|urgent)\b/i,
  /\b(urgent|immediate|asap)\b[^.?\n]{0,40}\b(payment|transfer|purchase|invoice)\b/i,
];
const GENERIC_LABEL = /^(?:[*"'\s]*)(requires?\s+action|action\s+required|urgent|important|alert|notice|final\s+notice|security\s+(alert|team|notice)|admin(istrator)?|help\s*desk|it\s+support|support\s+team|account\s+(team|services|security)|verification|invoice|payment\s+(due|notice)|mail\s+(delivery|server)|voicemail)[\s*"'!:.-]*$/i;

// Hosts that legitimately sit between the visible link text and the destination: email-marketing click trackers and mail-security link rewriters.
const TRACKERS = /(^|\.)(rs6\.net|constantcontact\.com|ccsend\.com|cmail\d*\.com|mailchimp\.com|list-manage\.com|mcsv\.net|campaign-archive\.com|sendgrid\.net|sendgrid\.com|mailgun\.org|brevo\.com|sendinblue\.com|hubspotlinks\.com|hs-sites\.com|hubspotemail\.net|hubspot\.com|createsend\.com|cmail19\.com|klaviyo\.com|exct\.net|marketo\.com|mktotrk\.com|e2ma\.net|avanan\.click|safelinks\.protection\.outlook\.com|urldefense\.com|urldefense\.proofpoint\.com|mimecast\.com|barracudanetworks\.com|linkedin\.com|lnkd\.in)$/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const domainOf = (email: string) => (email.split('@')[1] ?? '').toLowerCase().replace(/[>\s]/g, '');
const parse = (raw: string) => {
  const m = (raw ?? '').trim().match(/^"?(.*?)"?\s*<([^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: (raw ?? '').trim() };
};
const baseDomain = (h: string) => h.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');

export function assessEmail(i: PhishInput): PhishResult {
  const reasons: string[] = []; let score = 0;
  const add = (pts: number, why: string) => { score += pts; reasons.push(why); };
  const { name, email } = parse(i.from);
  const dom = domainOf(email);
  const own = new Set([...OWN, ...(i.ownDomains ?? [])].map(d => d.toLowerCase()));
  const isOwn = !!dom && [...own].some(d => dom === d || dom.endsWith('.' + d));
  const body = `${i.subject ?? ''}\n${i.text ?? ''}`.slice(0, 20000);

  if (isOwn && !i.authFail) return { score: 0, reasons: [] };   // a real colleague, passed sender checks

  if (MOVE_TO_TEXT.some(r => r.test(body))) add(3, 'Asks to move the conversation to text or a different phone number — the usual first step of a scam.');
  if (MONEY.some(r => r.test(body))) add(3, 'Mentions gift cards, wires, crypto, changed bank details or an urgent payment.');
  if (name && GENERIC_LABEL.test(name)) add(1, `The sender's display name is just a label ("${name}"), not a person or company.`);
  const nn = norm(name);
  if (nn && !isOwn) {
    const hit = (i.teamNames ?? []).find(t => { const x = norm(t); return x.length > 3 && (nn === x || nn.includes(x)); });
    if (hit) add(3, `The display name matches ${hit}, but the address is ${email}${FREE.test(dom) ? ' (a free personal account)' : ''}, not ours.`);
  }
  if (i.replyTo && !i.bulk) {
    const r = parse(i.replyTo).email, rd = domainOf(r);
    if (rd && dom && baseDomain(rd) !== baseDomain(dom)) add(1, `Replies would go to a different address (${r}) than the one it was sent from.`);
  }
  if (i.authFail) add(isOwn ? 3 : 1,"The sender's identity checks failed (SPF/DKIM/DMARC) — it may not be from who it says.");

  // Links whose visible text names one site but go to another, raw-IP links, shorteners.
  const seen = new Set<string>();
  for (const m of (i.html ?? '').matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let host = ''; try { host = new URL(m[1]).hostname; } catch { continue; }
    const shown = m[2].replace(/<[^>]*>/g, '').trim();
    const sh = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\/\s]|$)/i.exec(shown)?.[1];
    if (sh && baseDomain(sh) !== baseDomain(host) && !seen.has(host) && !TRACKERS.test(host) && !i.bulk) { seen.add(host); add(3, `A link says "${sh}" but actually goes to ${host}.`); }
    else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !seen.has(host)) { seen.add(host); add(3, `A link goes straight to a numeric address (${host}).`); }
    else if (SHORTENERS.test(host) && !seen.has(host)) { seen.add(host); add(1, `A link uses a link-shortener (${host}) that hides where it goes.`); }
  }
  for (const a of i.attachments ?? []) {
    if (DOUBLE_EXT.test(a.name)) { add(3, `The attachment "${a.name}" is disguised as a document but is really a program or web page.`); break; }
    if (RISKY_EXT.test(a.name)) { add(2, `The attachment "${a.name}" is a file type that can run code or open a fake sign-in page.`); break; }
  }
  return { score, reasons };
}
export const looksSuspicious = (r: PhishResult) => r.score >= 3;
