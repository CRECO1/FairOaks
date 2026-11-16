/**
 * Checks for the Matchmaker engine (src/lib/matchmaker/match.ts) with made-up properties — no database, no network.
 *   npx tsx scripts/matchmaker-check.ts
 * Exits non-zero on the first failed expectation, so it can sit in front of a deploy like the other *-check scripts.
 */
import assert from 'node:assert/strict';
import { criteriaFromRow, describeCriteria, displayName, EMAIL_MIN_SCORE, EMPTY_NEED, matchProperties, parseRate, possessive, propertyLine, propertyTitle, suiteOf, type MatchProperty, type NeedCriteria } from '../src/lib/matchmaker/match';
import { buildMatchEmail } from '../src/lib/matchmaker/email';
import { buildExtractInput, heuristicExtract, normalizeType, sanitizeExtraction, summarizeExtraction } from '../src/lib/matchmaker/extract';

const NOW = new Date('2026-11-11T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ok  ${name}`); };

// ── reading the free-text rate the Property DB stores ──────────────────────────────────────────────────────────────────────────
ok('rates: per SF per year', () => { const r = parseRate('$22 SF/YR'); assert.equal(r.perSfYr, 22); assert.equal(r.perSfYrMax, 22); assert.equal(r.salePrice, null); assert.equal(r.saysMonthly, false); });
ok('rates: "$2.23/SF/Month" is a per-SF monthly rate', () => { const r = parseRate('$2.23/SF/Month'); assert.equal(Math.round(r.perSfYr! * 100) / 100, 26.76); assert.equal(r.saysMonthly, true); });
ok('rates: "$1,000 /MO" is a monthly total, not a rate', () => { const r = parseRate('$1,000 /MO'); assert.equal(r.perSfYr, null); assert.equal(r.monthlyTotal, true); assert.equal(parseRate('$1,108 - $3,247 /MO').monthlyTotal, true); });
ok('rates: a range', () => { const r = parseRate('$18 - $24 SF/YR'); assert.equal(r.perSfYr, 18); assert.equal(r.perSfYrMax, 24); });
ok('rates: per SF per MONTH becomes a yearly rate', () => assert.equal(parseRate('$2 SF/MO').perSfYr, 24));
ok('rates: a big bare number is a sale price', () => assert.equal(parseRate('$1,250,000').salePrice, 1_250_000));
ok('rates: "For Sale $450,000" is a sale price', () => assert.equal(parseRate('For Sale $450,000').salePrice, 450_000));
ok('rates: undisclosed / unpriced carry no number', () => { assert.equal(parseRate('Undisclosed').unpriced, true); assert.equal(parseRate('Unpriced').perSfYr, null); });
ok('rates: a monthly dollar total is not a $/SF rate', () => { const r = parseRate('$2,500/mo'); assert.equal(r.perSfYr, null); assert.equal(r.salePrice, null); });
ok('rates: empty and null', () => { assert.equal(parseRate(null).perSfYr, null); assert.equal(parseRate('').salePrice, null); });

// ── a search against a handful of made-up properties ───────────────────────────────────────────────────────────────────────────
const base: MatchProperty = { id: 'x', address: '1 Main St', city: 'Boerne', submarket: 'Boerne / Hill Country', asset_type: 'Office', listing_type: 'For Lease', transaction_status: 'Available', created_at: day(10), listing_url: 'https://example.com/a' };
const P = (id: string, over: Partial<MatchProperty>): MatchProperty => ({ ...base, id, address: `${id} Test Dr`, ...over });
const need: NeedCriteria = { ...EMPTY_NEED, dealType: 'lease', assetTypes: ['Office'], sizeMin: 3000, sizeMax: 5000, rateMax: 26, areas: ['Boerne / Hill Country'] };
const props: MatchProperty[] = [
  P('fits', { available_sf: 4200, lease_rate_min: 22, lease_type: 'NNN', photos: ['p.jpg'], listing_agent_name: 'A Broker', listing_agent_phone: '210-555-0100' }),
  P('toosmall', { available_sf: 1200, lease_rate_min: 22 }),
  P('toobig', { available_sf: 20000, lease_rate_min: 22 }),
  P('overbudget', { available_sf: 4000, lease_rate_min: 40 }),
  P('norate', { available_sf: 4000 }),
  P('nosize', { lease_rate_min: 20 }),
  P('leased', { available_sf: 4000, lease_rate_min: 20, transaction_status: 'Leased' }),
  P('wrongarea', { available_sf: 4000, lease_rate_min: 20, city: 'Houston', submarket: 'Houston' }),
  P('saleonly', { available_sf: 4000, listing_type: 'For Sale', sale_price: 900000 }),
  P('divisible', { available_sf: 8000, divisible: true, lease_rate_min: 22 }),
  P('flex', { available_sf: 4000, lease_rate_min: 22, asset_type: 'Flex' }),
  P('retail', { available_sf: 4000, lease_rate_min: 22, asset_type: 'Retail' }),
  P('monthly', { available_sf: 4000, asking_rate: '$2 SF/MO' }),
];
const res = matchProperties(need, props, { now: NOW });
const byId = new Map(res.map(r => [r.property.id, r]));
const ids = res.map(r => r.property.id);

ok('drops what clearly does not fit', () => { for (const id of ['toosmall', 'toobig', 'overbudget', 'leased', 'wrongarea', 'saleonly', 'retail']) assert.ok(!byId.has(id), `${id} should be dropped`); });
ok('keeps what fits, ranked first, as a strong fit', () => { assert.equal(ids[0], 'fits'); assert.equal(byId.get('fits')!.fit, 'strong'); });
ok('explains why it fits in plain words', () => { const r = byId.get('fits')!; assert.ok(r.reasons.some(x => /4,200 SF.*3,000–5,000/.test(x))); assert.ok(r.reasons.some(x => /\$22\/SF\/yr NNN.*\$26/.test(x))); assert.ok(r.reasons.some(x => /Boerne/.test(x))); });
ok('keeps a missing rate, with a caveat, ranked lower', () => { const r = byId.get('norate')!; assert.ok(r); assert.ok(r.caveats.includes('Rate not listed')); assert.ok(r.score < byId.get('fits')!.score); });
ok('keeps a missing size, with a caveat', () => assert.ok(byId.get('nosize')!.caveats.includes('Size not listed')));
ok('a divisible space bigger than the ask is offered', () => assert.ok(byId.get('divisible')!.reasons.some(x => /divisible/.test(x))));
ok('but not a huge "divisible" building', () => assert.equal(matchProperties(need, [P('huge', { available_sf: 360000, divisible: true, lease_rate_min: 22 })], { now: NOW }).length, 0));
ok('a neighbouring type is kept but marked', () => { const r = byId.get('flex')!; assert.ok(r); assert.ok(r.caveats.some(x => /flex space/.test(x))); });
ok('a monthly per-SF rate is converted before the budget check', () => { const r = byId.get('monthly')!; assert.ok(r); assert.ok(r.reasons.some(x => /\$24\/SF\/yr/.test(x))); });
ok('a junk rate column is ignored when the listing says per month', () => {
  const r = matchProperties(need, [P('m', { available_sf: 4000, lease_rate_min: 1, asking_rate: '$1,000 /MO' })], { now: NOW })[0];
  assert.ok(r.caveats.includes('Rent quoted per month, not per SF')); assert.ok(!r.reasons.some(x => /\$1\/SF/.test(x)));
});
ok('old listings carry a "confirm it is still available" caveat', () => {
  const old = matchProperties(need, [P('old', { available_sf: 4000, lease_rate_min: 22, created_at: day(100) })], { now: NOW })[0];
  assert.ok(old.caveats.some(x => /Added 3 months ago.*still available/.test(x)));
});
ok('the same suite listed twice shows once, the better copy', () => {
  const twice = matchProperties(need, [P('a1', { address: '9 Dup Ln', available_sf: 4000, lease_rate_min: 22 }), P('a2', { address: '9 Dup Ln', available_sf: 4000 })], { now: NOW });
  assert.equal(twice.length, 1); assert.equal(twice[0].property.id, 'a1');
});

// ── must-haves, ZIP areas, empty searches, lease/sale inference ────────────────────────────────────────────────────────────────
ok('must-haves match the listing text and its synonyms', () => {
  const r = matchProperties({ ...EMPTY_NEED, assetTypes: ['Retail'], mustHaves: 'drive-thru' }, [P('dt', { asset_type: 'Retail', description: 'Second generation restaurant with drive thru lane' }), P('no', { asset_type: 'Retail', description: 'Inline space' })], { now: NOW });
  assert.equal(r[0].property.id, 'dt'); assert.ok(r[0].reasons.some(x => /drive-thru/i.test(x)));
  assert.ok(r.find(x => x.property.id === 'no')!.caveats.some(x => /Couldn’t confirm: drive-thru/.test(x)));
});
ok('a ZIP code works as an area', () => {
  const r = matchProperties({ ...EMPTY_NEED, areas: ['78006'] }, [P('z1', { zip: '78006', submarket: null }), P('z2', { zip: '78258', submarket: null })], { now: NOW });
  assert.deepEqual(r.map(x => x.property.id), ['z1']);
});
ok('an empty search matches nothing (never "everything")', () => assert.equal(matchProperties(EMPTY_NEED, props, { now: NOW }).length, 0));
ok('a rate budget alone means a lease search', () => {
  const r = matchProperties({ ...EMPTY_NEED, rateMax: 25 }, [P('l', { lease_rate_min: 20 }), P('s', { listing_type: 'For Sale', sale_price: 500000 })], { now: NOW });
  assert.deepEqual(r.map(x => x.property.id), ['l']);
});
ok('a sale budget filters by price', () => {
  const r = matchProperties({ ...EMPTY_NEED, dealType: 'sale', priceMax: 1_000_000 }, [P('cheap', { listing_type: 'For Sale', sale_price: 800000 }), P('dear', { listing_type: 'For Sale', sale_price: 2_000_000 })], { now: NOW });
  assert.deepEqual(r.map(x => x.property.id), ['cheap']);
});

// ── turning a contact row into a search, and a search into words ───────────────────────────────────────────────────────────────
ok('a contact row becomes a search (and zero/blank means "no limit")', () => {
  const c = criteriaFromRow({ asset_types: ['Retail'], req_size_min: 1500, req_size_max: 0, req_deal_type: 'lease', req_rate_max: 30, req_submarkets: ['Boerne'], req_must_haves: ' corner ' });
  assert.equal(c.dealType, 'lease'); assert.equal(c.sizeMax, null); assert.equal(c.rateMax, 30); assert.equal(c.mustHaves, 'corner');
});
ok('a search reads back as one line', () => assert.equal(describeCriteria(need), 'Lease · Office · 3,000–5,000 SF · up to $26/SF/yr · Boerne / Hill Country'));
ok('a property reads back as one line', () => assert.equal(propertyLine(props[0]), 'Office · 4,200 SF · $22/SF/yr NNN · Boerne / Hill Country'));
ok('possessives: a name ending in s takes just the apostrophe', () => { assert.equal(possessive('Maria Alvarez'), 'Maria Alvarez’s'); assert.equal(possessive('Package Cues'), 'Package Cues’'); assert.equal(possessive('  Lloyd Pearson IV '), 'Lloyd Pearson IV’s'); });
ok('the alert email says "Package Cues’ search", not "Cues’s"', () => {
  const broker = { name: 'Zachary Stovall', email: 'z@example.com', phone: '(210) 555-0100', title: 'Broker' };
  const e = buildMatchEmail({ audience: 'agent', broker, tenant: { name: 'Lloyd Pearson IV', firstName: 'Lloyd', business: 'Package Cues' }, criteria: need, results: res.slice(0, 1) });
  assert.ok(e.text.includes('Package Cues’ search')); assert.ok(e.html.includes('Package Cues</strong>&rsquo; search')); assert.ok(!/Cues(’|'|&rsquo;)s/.test(e.text + e.html));
});

// ── how a listing is named, and a name that says it is something else ───────────────────────────────────────────────────────────
ok('names: one that only repeats the address is not shown twice', () => {
  assert.equal(displayName({ name: '140 industrial dr Ste103', address: '140 Industrial Drive' }), '');
  assert.equal(displayName({ name: '11630 South U.S Hwy 181', address: '11630 S U.S. Hwy 181' }), '');
  assert.equal(displayName({ name: '116 N. Plant Ave.', address: '116 N. Plant Ave.' }), '');
  assert.equal(displayName({ name: 'Fair Oaks Crossing', address: '29250 Old Fredericksburg Rd' }), 'Fair Oaks Crossing');
});
ok('names: "Suite 500" kept in the name column becomes the suite', () => {
  assert.equal(displayName({ name: 'Suite 500', address: '15501 Ranch Rd 620 N' }), '');
  assert.equal(suiteOf({ name: 'Suite 500' }), '500'); assert.equal(suiteOf({ suite: 'Suite 204', name: null }), '204');
  assert.equal(propertyTitle({ address: '15501 Ranch Rd 620 N', name: 'Suite 500' }), '15501 Ranch Rd 620 N, Suite 500');
  assert.equal(propertyTitle({ address: null, name: 'Boerne Personal Warehouse' }), 'Boerne Personal Warehouse');
  assert.equal(propertyTitle({ address: null, name: '5,237 SF Flex Warehouse For Lease', suite: '204' }), '5,237 SF Flex Warehouse For Lease, Suite 204');   // a headline stands in for the address
  assert.equal(propertyTitle({ address: null, name: 'Suite 500' }), 'Suite 500'); assert.equal(propertyTitle({ address: null, name: null }), 'Property');
});
ok('a storage facility filed under Office is not a strong fit for an office search', () => {
  const r = matchProperties({ ...EMPTY_NEED, assetTypes: ['Office', 'Medical'], sizeMin: 2000, sizeMax: 4000 }, [P('s', { name: 'Extra Space Storage', asset_type: 'Office', available_sf: 3000, lease_rate_min: 20, photos: ['p.jpg'] }), P('o', { available_sf: 3000, lease_rate_min: 20 })], { now: NOW });
  const s = r.find(x => x.property.id === 's')!;
  assert.ok(s); assert.equal(s.fit, 'possible'); assert.ok(s.caveats[0].includes('looks like a storage facility')); assert.ok(s.score < EMAIL_MIN_SCORE); assert.equal(r[0].property.id, 'o');
});
ok('…but a tenant who wants storage / industrial space, or asks for it, still sees it normally', () => {
  const sp = P('s', { name: 'Extra Space Storage', asset_type: 'Industrial', available_sf: 3000, lease_rate_min: 8 });
  assert.ok(!matchProperties({ ...EMPTY_NEED, assetTypes: ['Industrial'], sizeMin: 2000, sizeMax: 4000 }, [sp], { now: NOW })[0].caveats.some(c => /storage facility/.test(c)));
  assert.ok(!matchProperties({ ...EMPTY_NEED, assetTypes: ['Office'], mustHaves: 'storage' }, [{ ...sp, asset_type: 'Office' }], { now: NOW })[0].caveats.some(c => /storage facility/.test(c)));
});
ok('a headline that says "for sale" keeps a sale listing out of a lease search (and vice versa)', () => {
  const sale = P('fs', { name: 'Fully Leased Retail Building for Sale', asset_type: 'Retail', listing_type: null, available_sf: 4000 });
  const lease = P('fl', { name: '5,237 SF Warehouse Available For Lease', asset_type: 'Retail', listing_type: null, available_sf: 4000 });
  const leaseSearch = matchProperties({ ...EMPTY_NEED, dealType: 'lease', assetTypes: ['Retail'], sizeMin: 3000, sizeMax: 5000 }, [sale, lease], { now: NOW });
  assert.deepEqual(leaseSearch.map(r => r.property.id), ['fl']); assert.ok(!leaseSearch[0].caveats.includes('Not stated whether it is for lease'));
  const saleSearch = matchProperties({ ...EMPTY_NEED, dealType: 'sale', assetTypes: ['Retail'], sizeMin: 3000, sizeMax: 5000 }, [sale, lease], { now: NOW });
  assert.deepEqual(saleSearch.map(r => r.property.id), ['fs']);
});
const broker = { name: 'Zachary Stovall', email: 'z@example.com', phone: '(210) 555-0100', title: 'Broker' };
ok('the broker copy says "Email to Lloyd", and only an alert claims the switch is on', () => {
  const base = { audience: 'agent' as const, broker, tenant: { name: 'Lloyd Pearson IV', firstName: 'Lloyd', business: 'Package Cues' }, criteria: need, results: res.slice(0, 1) };
  const copy = buildMatchEmail(base), alert = buildMatchEmail({ ...base, isNew: true });
  assert.ok(copy.html.includes('<strong>Email to Lloyd</strong>')); assert.ok(copy.html.includes('You asked Matchmaker to email you a copy')); assert.ok(!copy.html.includes('Email me new matches'));
  assert.ok(alert.html.includes('Email me new matches') && alert.html.includes('Matchmaker alert'));
});
ok('a client email says "To confirm: …", not the broker-facing "Couldn’t confirm"', () => {
  const dt: NeedCriteria = { ...EMPTY_NEED, assetTypes: ['Retail'], mustHaves: 'drive-thru' };
  const e = buildMatchEmail({ audience: 'client', broker, tenant: { name: 'Sam Ortega', firstName: 'Sam', business: null }, criteria: dt, results: matchProperties(dt, [P('dt', { asset_type: 'Retail', description: 'Inline space' })], { now: NOW }) });
  assert.ok(e.html.includes('To confirm: drive-thru') && e.text.includes('To confirm: drive-thru')); assert.ok(!e.html.includes('Couldn’t confirm') && !e.text.includes('Couldn’t confirm'));
});

// ── turning words into a search (src/lib/matchmaker/extract.ts) ──────────────────────────────────────────────────────────
const AREAS = ['Boerne', 'San Antonio', 'Boerne / Hill Country', 'Stone Oak', 'New Braunfels'];
const NOW_X = new Date('2026-11-13T12:00:00Z');
ok('extract: type names the model or a person might use become the seven types', () => {
  assert.equal(normalizeType('industrial'), 'Industrial'); assert.equal(normalizeType('Warehouse'), 'Industrial'); assert.equal(normalizeType('dental office'), 'Medical');
  assert.equal(normalizeType('restaurant'), 'Retail'); assert.equal(normalizeType('mixed use'), 'Mixed-Use'); assert.equal(normalizeType('banana'), null); assert.equal(normalizeType(''), null);
});
ok('extract: sanitize keeps a sound search, fixes a swapped range, drops junk', () => {
  const s = sanitizeExtraction({ found: true, dealType: 'lease', assetTypes: ['office', 'Medical', 'office', 'spaceship'], sizeMin: 4000, sizeMax: 2000, rateMax: 32, areas: ['Boerne', 'boerne', ' ', 'x'], moveInBy: '2027-03-01', mustHaves: ['medical build-out', 'corner'], confidence: 'medium', evidence: ['looking for 2,000-4,000 SF', '', 'a'.repeat(400)] });
  assert.equal(s.found, true); assert.deepEqual(s.assetTypes, ['Office', 'Medical']); assert.equal(s.sizeMin, 2000); assert.equal(s.sizeMax, 4000); assert.equal(s.rateMax, 32);
  assert.deepEqual(s.areas, ['Boerne']); assert.equal(s.moveInBy, '2027-03-01'); assert.equal(s.mustHaves, 'medical build-out, corner'); assert.equal(s.confidence, 'medium');
  assert.equal(s.evidence.length, 2); assert.ok(s.evidence[1].length <= 180);
});
ok('extract: one target size (min = max, as Claude returns "3,000 SF") becomes a band, a real range is left alone', () => {
  const one = sanitizeExtraction({ found: true, assetTypes: ['Retail'], sizeMin: 3000, sizeMax: 3000 }); assert.equal(one.sizeMin, 2400); assert.equal(one.sizeMax, 3750);
  const tiny = sanitizeExtraction({ found: true, sizeMin: 120, sizeMax: 120 }); assert.equal(tiny.sizeMin, 100); assert.equal(tiny.sizeMax, 150);
  const range = sanitizeExtraction({ found: true, sizeMin: 2500, sizeMax: 4000 }); assert.equal(range.sizeMin, 2500); assert.equal(range.sizeMax, 4000);
  const lone = sanitizeExtraction({ found: true, sizeMin: 8000 }); assert.equal(lone.sizeMin, 8000); assert.equal(lone.sizeMax, null);
});
ok('extract: sanitize rejects nonsense numbers, bad dates and "found" with nothing in it', () => {
  const s = sanitizeExtraction({ found: true, sizeMin: 3, sizeMax: 999_999_999, rateMax: 9000, priceMax: 12, moveInBy: 'March', dealType: 'swap', confidence: 'certain' });
  assert.equal(s.sizeMin, null); assert.equal(s.sizeMax, null); assert.equal(s.rateMax, null); assert.equal(s.priceMax, null); assert.equal(s.moveInBy, null); assert.equal(s.dealType, ''); assert.equal(s.confidence, 'low'); assert.equal(s.found, false);
  assert.equal(sanitizeExtraction(null).found, false); assert.equal(sanitizeExtraction('hi').found, false); assert.equal(sanitizeExtraction({ found: false, sizeMin: 2000 }).found, false);
});
ok('rules: one typed sentence fills the form', () => {
  const s = heuristicExtract("Dr. Alvarez wants to lease 2,500-3,500 sf of medical office in Boerne, up to $32/SF, by March 2027. Needs a medical build-out.", AREAS, NOW_X);
  assert.equal(s.found, true); assert.equal(s.dealType, 'lease'); assert.equal(s.sizeMin, 2500); assert.equal(s.sizeMax, 3500); assert.equal(s.rateMax, 32);
  assert.ok(s.assetTypes.includes('Medical') && s.assetTypes.includes('Office')); assert.deepEqual(s.areas, ['Boerne']); assert.equal(s.moveInBy, '2027-03-01'); assert.ok(s.mustHaves.includes('medical build-out')); assert.equal(s.confidence, 'medium');
});
ok('rules: "CEO looking for 2500-4000 SQ ft of office with yard" (a real note)', () => {
  const s = heuristicExtract('Sign Call. CEO of Harmony hospice looking for 2500-4000 SQ ft of office with yard around it', AREAS, NOW_X);
  assert.equal(s.found, true); assert.equal(s.sizeMin, 2500); assert.equal(s.sizeMax, 4000); assert.deepEqual(s.assetTypes, ['Office']); assert.ok(s.mustHaves.includes('yard'));
});
ok('rules: a single size becomes a band, "up to" and "at least" become one-sided', () => {
  const one = heuristicExtract('Tenant needs 3,000 SF retail', AREAS, NOW_X); assert.equal(one.sizeMin, 2400); assert.equal(one.sizeMax, 3750);
  const upTo = heuristicExtract('Looking for up to 5,000 SF of industrial', AREAS, NOW_X); assert.equal(upTo.sizeMin, null); assert.equal(upTo.sizeMax, 5000);
  const atLeast = heuristicExtract('Wants at least 8,000 sf warehouse', AREAS, NOW_X); assert.equal(atLeast.sizeMin, 8000); assert.equal(atLeast.sizeMax, null);
  const plus = heuristicExtract('Seeking 10,000+ SF flex', AREAS, NOW_X); assert.equal(plus.sizeMin, 10000); assert.equal(plus.sizeMax, null);
});
ok('rules: where a prospect IS today is not what they want (real notes from the CRM)', () => {
  for (const t of [
    'Southern Warehousing & Distribution · 265,000 SF main facility at 3232 N Panam Expy (78219) plus 250,000 SF off-site; also lease',
    'Moved Nov 17, 2025 into an 8,894 SF tenant finish-out at 28615 I-10 W, double its old space, so it just signed a lease',
    'Leased 40,800 SF of 112,500 SF building at 5410 Dietrich Rd, San Antonio, reported 9/21/2022',
    'Building 42,365 SF facility at 3139 IH-35 New Braunfels (due 9/30/2026) - weak lease prospect.',
    'Chipley fit: WEAK (Only 11 trucks and 8 drivers; 29,750 SF cross-dock likely oversized.)',
  ]) assert.equal(heuristicExtract(t, AREAS, NOW_X).found, false, t.slice(0, 50));
});
ok('rules: a negated type does not count; a stated requirement does', () => {
  const s = heuristicExtract('Site needs ~1.5 acres + 12,500 SF prototype, so it may not fit inline retail.', AREAS, NOW_X);
  assert.ok(!s.assetTypes.includes('Retail')); assert.equal(s.sizeMin, 10000); assert.equal(s.sizeMax, 15650);
  const e = heuristicExtract('Seen elsewhere seeking freestanding or end-cap units of about 3,400-5,500 SF with a patio.', AREAS, NOW_X);
  assert.equal(e.sizeMin, 3400); assert.equal(e.sizeMax, 5500); assert.ok(e.assetTypes.includes('Retail')); assert.ok(e.mustHaves.includes('patio') && e.mustHaves.includes('end cap'));
});
ok('rules: buying reads a price, not a rate; unit-less "under $30" is a lease rate', () => {
  const buy = heuristicExtract('Looking to buy a retail building, $1M-$3M, in Boerne', AREAS, NOW_X); assert.equal(buy.dealType, 'sale'); assert.equal(buy.priceMin, 1_000_000); assert.equal(buy.priceMax, 3_000_000); assert.equal(buy.rateMax, null);
  const lease = heuristicExtract('Needs to lease an office, budget under $28', AREAS, NOW_X); assert.equal(lease.dealType, 'lease'); assert.equal(lease.rateMax, 28);
});
ok('rules: a ZIP code and a month without a year (this year if ahead, else next)', () => {
  const s = heuristicExtract('Looking for retail near 78006 by January', AREAS, NOW_X); assert.deepEqual(s.areas, ['78006']); assert.equal(s.moveInBy, '2027-01-01');
  const t = heuristicExtract('Wants an office by December', AREAS, NOW_X); assert.equal(t.moveInBy, '2026-12-01');
});
ok('rules: nothing that says they want something → not found', () => {
  assert.equal(heuristicExtract('Called, left voicemail. Nice guy. Follow up Tuesday.', AREAS, NOW_X).found, false);
  assert.equal(heuristicExtract('', AREAS, NOW_X).found, false);
});
ok('extract: what is sent to the model keeps the start and end of long notes and says today', () => {
  const long = 'A'.repeat(2500) + 'MIDDLE' + 'B'.repeat(4000);
  const text = buildExtractInput({ who: 'Maria (Tenant)', notes: long, activity: ['Call — wants 3,000 SF'], today: '2026-11-13' });
  assert.ok(text.includes('Today is 2026-11-13') && text.includes('Client: Maria (Tenant)') && text.includes('<notes>') && text.includes('wants 3,000 SF'));
  assert.ok(!text.includes('MIDDLE') && text.length < 9000);
  assert.ok(buildExtractInput({ typed: 'x'.repeat(5000), today: '2026-11-13' }).length < 2700);
});
ok('extract: the banner line reads like the search', () => {
  assert.equal(summarizeExtraction(sanitizeExtraction({ found: true, dealType: 'lease', assetTypes: ['Office'], sizeMin: 2000, sizeMax: 4000, rateMax: 30, areas: ['Boerne'], mustHaves: 'yard' })), 'Lease · Office · 2,000–4,000 SF · up to $30/SF/yr · Boerne · needs yard');
});

console.log(`\n${n} checks passed`);
