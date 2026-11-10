// Direct inquiries: a PERSON writes to one of our inboxes about one of our listings ("your listing for 2250 Chipley Circle caught my attention").
// The platform feeds (LoopNet, Crexi, the website form…) were the only things the lead sync ever read, so these emails sat in the inbox
// and never became a contact or a Prospect. This file is the pure part (no database, no Gmail): deciding whether an email IS one, and which listing it names.

export interface ListingLite { id: string; name: string | null; address: string | null }

const SUFFIX: Array<[RegExp, string]> = [
  [/\bcircle\b/g, 'cir'], [/\bdrive\b/g, 'dr'], [/\bstreet\b/g, 'st'], [/\broad\b/g, 'rd'], [/\bboulevard\b/g, 'blvd'], [/\bparkway\b/g, 'pkwy'],
  [/\bavenue\b/g, 'ave'], [/\blane\b/g, 'ln'], [/\bhighway\b/g, 'hwy'], [/\bcourt\b/g, 'ct'], [/\bplace\b/g, 'pl'], [/\btrail\b/g, 'trl'],
  [/\bfreeway\b/g, 'fwy'], [/\binterstate\b/g, 'i'], [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\beast\b/g, 'e'], [/\bwest\b/g, 'w'],
];
/** Lower-case, punctuation gone, street-type words shortened — so "2250 Chipley Circle" and "2250 Chipley Cir." compare equal. */
export function normStreet(s: string): string {
  let t = (s ?? '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of SUFFIX) t = t.replace(re, to);
  return t;
}

/** "<number> <street word>" ("2250 chipley"). A one-letter directional ("104 E Main") isn't distinctive on its own, so it takes the next word too ("104 e main"). */
function numberKey(addr: string): string | null {
  const m = /^(\d{2,6})\s+(.+)$/.exec(addr.trim());
  if (!m) return null;
  const w = m[2].split(' ').filter(Boolean);
  if (!w.length) return null;
  return w[0].length >= 3 || !w[1] ? `${m[1]} ${w[0]}` : `${m[1]} ${w[0]} ${w[1]}`;
}

/** The phrases that identify a listing in an email: "<number> <first street word>" ("2250 chipley"), the street address, and a distinctive name ("elkhorn point"). */
export function listingKeys(l: ListingLite): string[] {
  const keys = new Set<string>();
  for (const raw of [l.address, l.name]) {
    if (!raw) continue;
    const first = normStreet(raw.split(',')[0]);
    const k = numberKey(first);
    if (k) { keys.add(k); if (first.length >= 8) keys.add(first); }
    else if (first.length >= 8) keys.add(first);   // a name with no street number: only when it is distinctive enough not to match ordinary words
  }
  return [...keys];
}

/** The listing an email names (the one with the longest matching phrase), or null. */
export function matchListing(text: string, listings: ListingLite[]): ListingLite | null {
  const t = ` ${normStreet(text)} `;
  let best: { l: ListingLite; len: number } | null = null;
  for (const l of listings) for (const k of listingKeys(l)) {
    if (t.includes(` ${k} `) || t.includes(` ${k}s `)) { if (!best || k.length > best.len) best = { l, len: k.length }; }
  }
  return best?.l ?? null;
}

/** Gmail search terms that pre-select the candidates (so each run looks at a handful of messages, not the whole inbox). */
export function gmailListingTerms(listings: ListingLite[], max = 40): string[] {
  const out = new Set<string>();
  for (const l of listings) for (const raw of [l.address, l.name]) {
    if (!raw) continue;
    const first = raw.split(',')[0].replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim();
    const k = numberKey(first);
    if (k) out.add(`"${k}"`); else if (first.length >= 8) out.add(`"${first}"`);
    if (out.size >= max) return [...out];
  }
  return [...out];
}

type Header = { name: string; value: string };
const h = (headers: Header[], name: string) => headers.find(x => x.name.toLowerCase() === name.toLowerCase())?.value ?? '';

/** Bulk, automatic or system mail — never a person writing to us. */
export function isAutomated(headers: Header[], fromAddr: string): boolean {
  if (h(headers, 'list-unsubscribe') || h(headers, 'list-id')) return true;
  if (/bulk|list|junk/i.test(h(headers, 'precedence'))) return true;
  const auto = h(headers, 'auto-submitted'); if (auto && !/^no$/i.test(auto.trim())) return true;
  if (h(headers, 'x-auto-response-suppress') || h(headers, 'x-autoreply') || h(headers, 'x-autorespond')) return true;
  return /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce[s]?|notifications?|alerts?|news(letter)?|marketing|info@.*\.(?:mail|email))\b/i.test(fromAddr.split('@')[0] ?? '') || /@(?:.*\.)?(mailchimp|sendgrid|constantcontact|hubspot|mailgun|amazonses)\b/i.test(fromAddr);
}

/** The person's name from a From header: `"Justin Morris" <j@x.com>` → "Justin Morris". Empty when the header carries only an address. */
export function displayName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from);
  const n = (m?.[1] ?? '').replace(/\s+/g, ' ').trim();
  return n && !n.includes('@') && n.length <= 80 ? n : '';
}

/** What the person wrote, without the quoted thread underneath. */
export function freshText(body: string): string {
  return (body.split(/\n\s*(?:On .{5,160}wrote:|-{2,}\s*(?:Original|Forwarded)|From:\s.+\nSent:|>{1})/)[0] ?? body).trim();
}

// Mail that names one of our addresses to SELL us something (a contractor, a cleaner, an SEO shop…) rather than to rent or buy from us.
const PITCH = /\b(virtual assistant|seo\b|lead generation|web ?site design|web design|marketing services|we help (?:brokers|agents|landlords|owners)|boost your|increase your (?:leads|traffic)|guest post|backlinks?|loans?\b|financing solutions?|merchant|staffing|finish[- ]?out (?:numbers|estimates?|pricing|costs?)|cost range|free (?:quote|estimate|walkthrough|consultation|audit|page|inspection|assessment)|window cleaning|pressure washing|janitorial|landscap\w+|pest control|roofing|signage|photography services|our (?:services|team can)|i can (?:help|turn|provide a (?:quote|bid|estimate))|(?:happy|glad) to (?:bid|quote)|get you a (?:quote|bid|estimate)|insurance (?:quote|rates)|energy (?:savings|audit)|property management services)\b/i;
export const looksLikePitch = (text: string) => PITCH.test(text);

// A real inquiry reads like someone who wants the space or the building. Without any of these it is correspondence ABOUT the property
// (a city letter, an escrow note, a vendor) and stays out of the pipeline.
const INTENT = /\b(interested in|interest in|looking (?:for|to|at)|lease|leasing|leased|rent(?:al|ing)?|tenant|tour|viewing|showing|availab\w+|square (?:feet|foot)|sq\.? ?ft|sf\b|asking (?:rent|price)|nnn|purchase|buy(?:ing|er)?|acquire|acquisition|occupy|occupancy|(?:my|our) (?:business|client|company|concept|group|investor)|floor ?plan|site ?plan|price|pricing|terms)\b/i;
export const hasInquiryIntent = (text: string) => INTENT.test(text);
