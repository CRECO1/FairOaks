/**
 * Property tags in contact notes: `#1222Chulie` tags the listing at "1222 Chulie Dr".
 *
 * The tag is the street NUMBER + street NAME, no spaces and no "Dr/St/Pkwy" ending — what a person would type.
 * A longer form (`#1222ChulieDr`) or any prefix of it that still has the number and 3+ letters also works.
 * Tagging is silent: nobody is notified, it only records which property a contact asked about.
 *
 * Safe to import on the client and the server (pure functions, no I/O).
 */
export interface TagListing { id: string; name?: string | null; address?: string | null }

const SUFFIX = new Set([
  'st', 'street', 'dr', 'drive', 'rd', 'road', 'ave', 'avenue', 'blvd', 'boulevard', 'pkwy', 'parkway', 'cir', 'circle',
  'ln', 'lane', 'ct', 'court', 'way', 'pl', 'place', 'hwy', 'highway', 'trl', 'trail', 'loop', 'pass', 'plz', 'plaza',
  'sq', 'square', 'ter', 'terrace',
]);

const alnum = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '');

/** The street part of the address ("2250 Chipley Cir, San Antonio, TX" -> "2250 Chipley Cir"); falls back to the name. */
function streetPart(l: TagListing): string {
  const a = (l.address ?? '').split(',')[0].trim();
  return a || (l.name ?? '').trim();
}

/** Full address with no spaces: "1222ChulieDr". */
export function listingAddressSlug(l: TagListing): string { return alnum(streetPart(l)); }

/** The tag inserted by the picker: number + street name, suffix dropped: "1222Chulie". */
export function listingTagToken(l: TagListing): string {
  const words = streetPart(l).split(/\s+/).filter(Boolean);
  if (words.length > 2 && SUFFIX.has(words[words.length - 1].toLowerCase().replace(/\./g, ''))) words.pop();
  return alnum(words.join(''));
}

/** What a chip / the picker shows: the street address ("1222 Chulie Dr"). */
export function listingTagLabel(l: TagListing): string {
  return (l.address ?? '').split(',')[0].trim() || (l.name ?? '').trim() || 'Property';
}

// A `#` that starts a word. "Unit #3" or "call #2" never match a property (a tag needs a number AND 3+ letters).
const TAG_RE = /(?:^|[^\w&])#([A-Za-z0-9]+)/g;
const looksLikeAddressTag = (t: string) => /^\d+[a-z]{3,}/i.test(t);

/**
 * Listings tagged in `text`. An EXACT tag (the picker's short tag, or the full address with no spaces) always counts,
 * even for land or a listing with no street number. A partial tag only counts when it starts with a street number
 * and has 3+ letters ("#1222Chu"), so "Unit #3" or "#urgent" can never tag anything.
 * A tag that fits two different addresses tags neither (the picker never produces one).
 */
export function parseListingTagIds(text: string, listings: TagListing[]): string[] {
  if (!text || !text.includes('#') || !listings.length) return [];
  const tokens = new Set([...text.matchAll(TAG_RE)].map(m => m[1].toLowerCase()));
  if (!tokens.size) return [];
  const out = new Set<string>();
  for (const t of tokens) {
    const partialOk = looksLikeAddressTag(t) && t.length >= 6;
    const cands = listings.filter(l => {
      const s = listingAddressSlug(l).toLowerCase();
      return !!s && (s === t || listingTagToken(l).toLowerCase() === t || (partialOk && s.startsWith(t)));
    });
    if (!cands.length) continue;
    const bySlug = new Map<string, TagListing[]>();
    for (const l of cands) { const s = listingAddressSlug(l).toLowerCase(); bySlug.set(s, [...(bySlug.get(s) ?? []), l]); }
    let pick: TagListing[] | undefined;
    if (bySlug.size === 1) pick = [...bySlug.values()][0];                       // one address (several rows for it are all tagged)
    else pick = cands.filter(l => listingTagToken(l).toLowerCase() === t || listingAddressSlug(l).toLowerCase() === t);   // several: only an exact match wins
    if (pick && new Set(pick.map(l => listingAddressSlug(l).toLowerCase())).size === 1) pick.forEach(l => out.add(l.id));
  }
  return [...out];
}

/** Picker search: matches the address or the property name, ignoring spaces and punctuation. */
export function searchListingsForTag(listings: TagListing[], query: string, limit = 8): TagListing[] {
  const q = alnum(query).toLowerCase();
  const rows = q ? listings.filter(l => listingAddressSlug(l).toLowerCase().includes(q) || alnum(l.name ?? '').toLowerCase().includes(q)) : listings;
  return [...rows].sort((a, b) => listingTagLabel(a).localeCompare(listingTagLabel(b), undefined, { numeric: true })).slice(0, limit);
}
