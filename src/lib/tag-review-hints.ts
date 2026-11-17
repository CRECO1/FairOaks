/**
 * The "Tag old notes" review: pure text rules that decide what a note most likely is, so the review can suggest an answer (a person still decides)
 * and keep obvious system log lines out of the queue altogether. No network, no database: scripts/tag-review-hints.test.ts runs real note styles through it.
 */

/** Notes that are OUTREACH LISTS ("Auto Brite – French Pl (1353 W French Pl) lease prospect — Roofing"), not someone asking about the property.
 *  Tagging those would make "asked about" mean "we targeted them", so the one-tap "Tag all" leaves them out (each can still be tagged by hand). */
export const OUTREACH = /\blease prospect\b|\bsale prospect\b|outbound prospect|\bprospect\s*[—–-]|\bprospect for\b|\bprospect list\b|\boutreach\b|\bhit list\b|\benriched \d{4}-\d{2}-\d{2}|\bask for:|\btop target\b/i;
/** A CURRENT TENANT's rent-roll line ("… | Unit: 3100 | Rent: $615/mo | Lease …"): they already lease from us, so they are neither inquiries nor outreach targets. */
export const TENANT = /\|\s*unit:\s*\S/i;
export const INQUIRY = /engaged:|crexi lead|loopnet lead|inquir|asked about|called about|requested info|viewed space/i;
export const looksLikeOutreach = (t: string) => OUTREACH.test(t) && !INQUIRY.test(t);
export const looksLikeTenant = (t: string) => TENANT.test(t) && !INQUIRY.test(t);
/** Softer "someone is interested" words: a hint, never proof. */
export const ASKISH = /\b(asked|asking|interested|wants?|wanted|looking (for|at|to)|inquir|requested?|available|availability|tour|toured|showing|lease rate|how much|call(ed)? (me|back)|returned (a )?call|follow(ed)? up|looked at|visited|came on the tour|found your listing|brochure|flyer|asking price)\b/i;
/** Research about who owns the property (county records). */
export const RESEARCH = /\bowner of record\b|\bper bexar cad\b|\bcounty owner\b|\bprop(erty)? id\b\s*\d|\bmailing address\b.*\bsos file\b/i;
/** A log line the CRM wrote itself (a finished task, a stage change, an email it sent or filed). */
export const SYSTEM = /^\s*(✅\s*)?(task completed:|stage moved to\b|sent email:|email (sent|received)\b|deal (created|moved|stage))/i;
/** About the property's own landlord / manager / owner. */
export const OWNERISH = /\blandlord contact\b|\bproperty manager\b|\bhandles (the )?[^.]{0,40}tenants\b|\bowner of the\b|\bowns\b/i;
/** "…about HIS 30ksqft space at 8026 Vantage": the person is talking about their own space (a landlord or a broker's own listing), not asking about ours. */
export const LISTING_SIDE = /\b(?:his|her|their|the owner'?s)\s+(?:\S+\s+){0,2}?(?:\w*sq\s?ft|\w*sf|space|building|property|listing|center|plaza|warehouse)\b/i;

export type Verdict = 'inquiry' | 'two' | 'general' | 'owner' | 'research' | 'system';

/** What a note most likely is, with a one-line reason for the review screen. Order matters: the first rule that fits wins. */
export function verdictFor(text: string, namedCount: number, ownerLinked = false): { verdict: Verdict; hint: string } {
  if (namedCount >= 2) return { verdict: 'two', hint: 'Names more than one property' };
  if (SYSTEM.test(text)) return { verdict: 'system', hint: 'System note (a completed task), not a person asking' };
  if (INQUIRY.test(text) && !RESEARCH.test(text)) return { verdict: 'inquiry', hint: 'Looks like an inquiry' };
  if (ownerLinked) return { verdict: 'owner', hint: 'Linked to this property as its landlord / owner, so not an inquiry' };
  if (RESEARCH.test(text)) return { verdict: 'research', hint: 'Looks like owner research (county records)' };
  // An outreach-list line ("prospect — …", "ASK FOR: …", "TOP TARGET") is us reaching out, even when it says "tour" or "available" about the property.
  if (looksLikeOutreach(text)) return { verdict: 'general', hint: 'Looks like an outreach list entry (we contacted them): mark as targeted, not asked' };
  if (OWNERISH.test(text) && !ASKISH.test(text)) return { verdict: 'owner', hint: 'Looks like a landlord / owner / property contact' };
  if (LISTING_SIDE.test(text)) return { verdict: 'general', hint: 'Talks about their OWN space (a landlord or a broker\'s own listing), so it may not be about ours' };
  if (ASKISH.test(text)) return { verdict: 'inquiry', hint: 'Looks like an inquiry' };
  return { verdict: 'general', hint: 'Looks like a general note' };
}

/** A pure CRM log line with no sign of anyone asking for anything: kept out of the review queue entirely (nothing is hidden or changed in the note). */
export const isPlainLogLine = (t: string) => SYSTEM.test(t) && !INQUIRY.test(t) && !ASKISH.test(t);
