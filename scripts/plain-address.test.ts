// Regression test for "Send failed: "Charlie Fulton <charlie@…>" isn't a valid email address" (2026-11-18):
// Reply pre-filled the To chip with name + address and the send route only took bare addresses.
// Run:  npx tsx scripts/plain-address.test.ts
import assert from 'node:assert/strict';
import { plainAddress } from '../src/lib/mime-header';

const cases: Array<[string, string]> = [
  ['Charlie Fulton <charlie@headwallinvestments.com>', 'charlie@headwallinvestments.com'],
  ['"Fulton, Charlie" <charlie@headwallinvestments.com>', 'charlie@headwallinvestments.com'],
  ['<charlie@headwallinvestments.com>', 'charlie@headwallinvestments.com'],
  ['  charlie@headwallinvestments.com  ', 'charlie@headwallinvestments.com'],
  ['charlie@headwallinvestments.com', 'charlie@headwallinvestments.com'],
  ['Zack\r\nBcc: evil@x.com <zack@crecotx.com>', 'zack@crecotx.com'],            // line breaks flattened, no header injection
  ['Evil <a@b.com> <c@d.com>', 'Evil <a@b.com> <c@d.com>'],                         // ambiguous: left alone, caller rejects it
  ['not an address', 'not an address'],
];
for (const [input, want] of cases) assert.equal(plainAddress(input), want, input);

// The send route's list splitter (same regex): a comma inside a quoted name must not split the recipient.
const split = (v: string) => v.split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/).map(plainAddress).filter(Boolean);
assert.deepEqual(split('"Fulton, Charlie" <c@x.com>, Zack <z@y.com>; a@b.com'), ['c@x.com', 'z@y.com', 'a@b.com']);
console.log('plain-address: ok');
