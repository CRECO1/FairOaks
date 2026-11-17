// "Who to call first" scoring. Run:  npx tsx scripts/follow-up-heat.test.ts
import assert from 'node:assert/strict';
import { heatFor, signalsFrom } from '../src/lib/follow-up-heat';

// Signals come from the words around the ask.
assert.deepEqual(signalsFrom('Lead from website: tour request: move-in-ready-medical-building'), ['toured']);
assert.ok(signalsFrom('Came on the tour of 7830 Louis Pasteur').includes('toured'));
assert.ok(signalsFrom('asked Zack for flyer, rent, NNNs and TI allowance on 1346 Parkridge for a client').includes('asked about price'));
assert.ok(signalsFrom('asked Zack for flyer, rent, NNNs and TI allowance on 1346 Parkridge for a client').includes('broker with a client'));
assert.ok(signalsFrom('Opened Brochure Last Action: 2024-02-26').includes('opened the brochure'));
assert.ok(signalsFrom('hello', 'Broker').includes('broker with a client'));
assert.deepEqual(signalsFrom('called about the building'), []);
assert.ok(signalsFrom('hi', null, true).includes('met with us'));

// A recent tour beats a stale one-off ask.
const hot = heatFor({ asks: 2, signals: ['toured', 'asked about price'], days: 9, wroteBack: true });
const cold = heatFor({ asks: 1, signals: [], days: 200, wroteBack: false });
assert.equal(hot.label, 'hot');
assert.equal(cold.label, 'cool');
assert.ok(hot.score > cold.score);
assert.ok(hot.reasons.includes('toured') && hot.reasons.includes('asked 2 times') && hot.reasons.includes('wrote us back'));
// Recency matters on its own.
assert.ok(heatFor({ asks: 1, signals: [], days: 10, wroteBack: false }).score > heatFor({ asks: 1, signals: [], days: 50, wroteBack: false }).score);
// Many asks are capped, so one chatty contact cannot run away with the list.
assert.equal(heatFor({ asks: 9, signals: [], days: 100, wroteBack: false }).score, heatFor({ asks: 4, signals: [], days: 100, wroteBack: false }).score);
console.log('follow-up-heat: all checks passed');
