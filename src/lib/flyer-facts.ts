// "At a glance" rows for the flyer's first page, drawn from listing fields plus the
// highlight lines agents already type. crm_listings has no parking / demising /
// clear-height columns, so those are read out of the highlights by keyword — a
// highlight that is nothing but the fact (short, and matched) is then dropped from the
// bullet list so it doesn't print twice.
export interface FlyerFact { label: string; value: string }

interface Rule { label: string; test: RegExp; value: (m: RegExpMatchArray, line: string) => string }

const num = '(\\d[\\d,.]*)';
const RULES: Rule[] = [
  { label: 'Parking', test: /\bpark(ing)?\b/i,
    value: (_m, l) => (l.match(new RegExp(`${num}\\s*(?:\\/\\s*1,?000(?:\\s*SF)?|spaces?|stalls?|cars?)`, 'i'))?.[0].replace(/\s+/g, ' ')
      ?? l.match(/±?\s*\d[\d,]*\s*(?:parking\s*)?spaces?/i)?.[0] ?? 'On-site') },
  { label: 'Demising', test: /demis|divisible|subdivid|multi-?tenant|\b\d+\s*suites?\b/i,
    value: (_m, l) => (l.match(/\b(\d+|two|three|four)\s*(?:\(\d+\)\s*)?(suites?|units?|bays?)\b/i)?.[0] ?? 'Demisable') },
  { label: 'Clear height', test: /clear(?:\s*height)?/i,
    value: (_m, l) => (l.match(new RegExp(`${num}\\s*(?:'|ft\\.?|feet|foot)?\\s*clear`, 'i'))?.[1] ? `${l.match(new RegExp(`${num}\\s*(?:'|ft\\.?|feet|foot)?\\s*clear`, 'i'))![1]}' clear` : '') },
  { label: 'Dock / grade doors', test: /\b(dock|grade[- ]level|drive[- ]in|overhead)\b/i,
    value: (_m, l) => (l.match(/\b\d+\s*(?:\(\d+\)\s*)?(?:dock(?:-high)?|grade(?:-level)?|drive-in|overhead)[^,;.]{0,18}/i)?.[0].trim() ?? '') },
  { label: 'Power', test: /\b(3-?phase|three-?phase|\d{2,4}\s*(?:amps?|A)\b)/i,
    value: (_m, l) => (l.match(/\b(?:3-?phase|three-?phase)[^,;.]{0,18}|\b\d{2,4}\s*(?:amps?|A)\b[^,;.]{0,14}/i)?.[0].trim() ?? '') },
  { label: 'Frontage', test: /\bfrontage\b/i,
    value: (_m, l) => (l.match(new RegExp(`${num}\\s*(?:'|ft\\.?|feet|linear feet|lf)\\s*(?:of\\s*)?frontage`, 'i'))?.[0] ?? '') },
  { label: 'Signage', test: /\b(pylon|monument)\b/i,
    value: (_m, l) => (l.match(/\b(pylon|monument)\b/i)?.[0].replace(/^./, c => c.toUpperCase()) ?? '') },
];

export function flyerFacts(
  listing: { type?: unknown; year_built?: unknown },
  highlights: string[],
  max = 6,
): { facts: FlyerFact[]; highlights: string[] } {
  const facts: FlyerFact[] = [];
  const yr = Number(String(listing.year_built ?? '').replace(/\D/g, ''));
  if (yr >= 1800 && yr <= 2100) facts.push({ label: 'Year built', value: String(yr) });

  const used = new Set<number>();
  RULES.forEach(rule => {
    if (facts.length >= max) return;
    const idx = highlights.findIndex((h, i) => !used.has(i) && rule.test.test(h));
    if (idx < 0) return;
    const value = rule.value(highlights[idx].match(rule.test)!, highlights[idx]).trim();
    if (!value) return;
    facts.push({ label: rule.label, value: value.charAt(0).toUpperCase() + value.slice(1) });
    used.add(idx);
  });
  // Property type is the least informative row (the banner and badge already frame
  // it), so it only fills a slot nobody else wanted.
  const type = String(listing.type ?? '').trim();
  if (type && facts.length < max) facts.push({ label: 'Type', value: type });
  // A highlight that was only the fact ("Ample parking") is now redundant; a longer
  // one still says more than the callout does, so it stays.
  const kept = highlights.filter((h, i) => !(used.has(i) && h.length < 48));
  return { facts, highlights: kept };
}
