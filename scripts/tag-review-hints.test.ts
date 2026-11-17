// The "Tag old notes" hints, run on real note styles. Run:  npx tsx scripts/tag-review-hints.test.ts
import assert from 'node:assert/strict';
import { verdictFor, isPlainLogLine, looksLikeOutreach } from '../src/lib/tag-review-hints';

const v = (t: string, named = 1, owner = false) => verdictFor(t, named, owner).verdict;

// Real inquiries stay inquiries.
assert.equal(v("Brian's Gmail sheet 10/7/2026 9:23: asked if 7830 Louis Pasteur Dr was available. Zack said a lease was already executed."), 'inquiry');
assert.equal(v('looked at 2250 Chipley cir. Never heard back'), 'inquiry');
assert.equal(v('Came on the tour of 7830 Louis pasteur. works for Harmony hospice account exec'), 'inquiry');
assert.equal(v('Property: 1353 W French Pl\nMessage: Hi Zack, What\'s the asking price here? Does the paint booth stay with the property?'), 'inquiry');

// An outreach-list line is us reaching out, even when it says "tour" about the property (the Stream Realty case).
const stream = 'Beacon Hill (1353 W French Pl) prospect — Industrial Broker / Executive Vice President, industrial project leasing & tenant rep. 350+ transactions; he tracks the prospects that tour his parks and lose out on size or price.';
assert.equal(looksLikeOutreach(stream), true);
const sv = verdictFor(stream, 1);
assert.equal(sv.verdict, 'general');
assert.match(sv.hint, /outreach list entry/);
assert.equal(v('📞 ASK FOR: Cecilia Johnson — Franchisee / Owner, JDH Ventures LLC · available spaces'), 'general');
assert.equal(v('TOP TARGET - Primrose runs a SUBMIT A SITE channel and is interested in new sites'), 'general');

// A broker or landlord talking about THEIR OWN space is not someone asking about ours (the Keller Williams case).
const kw = 'Spoke to him about his 30ksqft space at 8026 vantage it is fully built out office space so won\'t work for the client but he is looking at buying 2819 nw loop 410';
assert.equal(v(kw), 'general');
assert.match(verdictFor(kw, 1).hint, /OWN space/);
// ...but a plain ask is still an ask.
assert.equal(v('Wants to see the space at 8026 Vantage next week, looking for 30,000 sq ft'), 'inquiry');

// Owner links, owner research and landlords.
assert.equal(v('Call about the unit, owner', 1, true), 'owner');
assert.equal(v('Owner of record per Bexar CAD (2026) for 4946 Center Park Blvd'), 'research');
assert.equal(v('Landlord contact for Blanco Plaza, 6609 Blanco Rd. Sent the Suite 210 floor plan'), 'owner');

// CRM log lines are plain log lines (kept out of the queue) unless a person's ask is in them.
for (const t of ['✅ Task completed: Call Josh about 1353 W French Pl', 'Stage moved to LOI — 2250 Chipley Cir', 'Sent email: Re: LOI for 1346 Parkridge', 'Email sent: 2250 Chipley flyer attached']) {
  assert.equal(v(t), 'system', t);
}
assert.equal(isPlainLogLine('Stage moved to LOI — 2250 Chipley Cir'), true);
assert.equal(isPlainLogLine('✅ Task completed: Call Josh about 1353 W French Pl'), true);
assert.equal(isPlainLogLine('Email received: asked about 1222 Chulie Dr, is it still available?'), false);   // a real inbound ask logged as an email
assert.equal(isPlainLogLine('Sent email: Re: 2250 Chipley availability'), false);                                 // "availability" is an ask word: a person looks at it
assert.equal(isPlainLogLine('Lead from website: asked about 1222 Chulie'), false);

// Two properties in one note always go to a person.
assert.equal(v('asked about 1222 Chulie and 2250 Chipley', 2), 'two');

console.log('tag-review-hints: all checks passed');
