/**
 * Checks for the Matchmaker engine (src/lib/matchmaker/match.ts) with made-up properties — no database, no network.
 *   npx tsx scripts/matchmaker-check.ts
 * Exits non-zero on the first failed expectation, so it can sit in front of a deploy like the other *-check scripts.
 */
import assert from 'node:assert/strict';
import { criteriaFromRow, describeCriteria, EMPTY_NEED, matchProperties, parseRate, propertyLine, type MatchProperty, type NeedCriteria } from '../src/lib/matchmaker/match';

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

console.log(`\n${n} checks passed`);
