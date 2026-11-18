// Phone-alert links: every link the server builds must read back, in the app's own parser, as the right page + the right thing to open.
// Run: npx tsx scripts/alert-links.test.ts
import assert from 'node:assert/strict';
import { crmLink, chatLink } from '../src/lib/push';
import { parseAlertLink } from '../src/lib/alert-link';

const U = '11111111-2222-3333-4444-555555555555', V = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PAGES = ['deals', 'contacts', 'tasks', 'properties', 'transaction-docs', 'esign', 'calls', 'teamchat', 'emails'];

// An alert about one row opens that row, on its page.
for (const [page, type] of [['contacts', 'contact'], ['deals', 'deal'], ['tasks', 'task'], ['tasks', 'calls'], ['properties', 'listing'], ['transaction-docs', 'drive_doc']] as const) {
  const l = parseAlertLink(crmLink(page, { type, id: U }))!;
  assert.equal(l.hash, page); assert.deepEqual(l.open, { type, id: U }); assert.equal(l.chat, null);
}
// A call-list / task alert with no row id still opens the right Tasks tab.
for (const type of ['calls', 'task']) { const l = parseAlertLink(crmLink('tasks', { type, id: null }))!; assert.equal(l.hash, 'tasks'); assert.deepEqual(l.open, { type, id: '' }); }
// A list-level alert (digest) lands on its page and opens nothing in particular.
{ const l = parseAlertLink(crmLink('properties'))!; assert.equal(l.hash, 'properties'); assert.equal(l.open, null); }
// A row alert with a bad id never opens a wrong thing.
assert.equal(parseAlertLink(crmLink('contacts', { type: 'contact', id: 'not-a-uuid' }))!.open, null);
// Team chat: team room and a DM open that conversation; junk falls back to the chat page, never an arbitrary room.
for (const room of ['team', `dm:${U}:${V}`]) { const l = parseAlertLink(chatLink(room))!; assert.equal(l.hash, 'teamchat'); assert.equal(l.chat, room); }
assert.equal(parseAlertLink(chatLink('dm:evil'))!.chat, null);
assert.equal(parseAlertLink(chatLink('dm:evil'))!.hash, 'teamchat');
// Only links inside the CRM are read.
assert.equal(parseAlertLink('https://evil.example/x?open=contact:' + U), null);
assert.equal(parseAlertLink('/elsewhere?open=contact:' + U), null);
// Every page a link can name is a real CRM page.
for (const p of PAGES) assert.ok(parseAlertLink(crmLink(p))!.hash === p);
console.log('alert-links: ok');
