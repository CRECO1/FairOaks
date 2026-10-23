// Number matching + the auto-block safety guard. Run:  npx tsx scripts/call-blocklist.test.ts
import assert from 'node:assert/strict';
import { autoBlockVerdict, blockKey } from '../src/lib/call-blocklist';
import { answererFromEvents } from '../src/lib/call-routing';

// Every way a US number shows up on a caller ID or in a card is the same key.
for (const v of ['+12105550123', '12105550123', '210-555-0123', '(210) 555-0123', '210.555.0123', ' +1 (210) 555-0123 ']) assert.equal(blockKey(v), '2105550123', v);
assert.equal(blockKey('+442071838750'), '442071838750');          // international: full digits
for (const v of ['', null, undefined, 'anonymous', 'Restricted', '266696687', '555-0123', '+1210555']) assert.equal(blockKey(v as string), null, String(v));

// The Talkroute leg answered by the call-screen forwarding number is a screened (blocked) call, never a person or the bot.
const ev = (who: string) => [{ description: `Call answered by _${who}_ - _1 (830) 555-0100_` }];
assert.deepEqual(answererFromEvents(ev('Call screen'), []), { profileId: null, bot: false, screened: true });
assert.deepEqual(answererFromEvents(ev('AI receptionist'), []), { profileId: null, bot: true });
assert.equal(answererFromEvents(ev('Call screen'), []).bot, false);

// A chainable stand-in for the supabase client: every query resolves to the rows registered for its table.
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  const q = (rows: Array<Record<string, unknown>>): any => {
    const o: any = { then: (res: (v: unknown) => void) => res({ data: rows, error: null }) };
    for (const m of ['select', 'or', 'eq', 'in', 'gte', 'lte', 'limit', 'order']) o[m] = () => o;
    return o;
  };
  return { from: (t: string) => q(tables[t] ?? []) } as never;
}
const base = { business_unit: 'residential', number: '+12105550123', contact_id: null, caller_name_said: false, callback_number: null, transferred: false };
const OURS = { crm_voicebot_settings: [{ twilio_number: '+18302514660', talkroute_numbers: ['+12103909997', '+12108173443'] }], crm_profiles: [{ phone: '(210) 355-8683' }], crm_call_log: [] };

(async () => {
  // An unknown number the bot flagged → allowed.
  assert.deepEqual(await autoBlockVerdict(fakeDb({ ...OURS, crm_clients: [] }), base), { ok: true, key: '2105550123' });
  // …but never a saved contact, in any formatting (phone or cell).
  for (const row of [{ phone: '(210) 555-0123' }, { cell_phone: '210-555-0123' }, { phone: '+1 210 555 0123' }]) {
    const v = await autoBlockVerdict(fakeDb({ ...OURS, crm_clients: [row] }), base);
    assert.equal(v.ok, false); assert.match((v as { why: string }).why, /saved contact/);
  }
  // …not a team phone, not one of our lines.
  for (const number of ['+12103558683', '+12103909997', '+18302514660']) assert.equal((await autoBlockVerdict(fakeDb({ ...OURS, crm_clients: [] }), { ...base, number })).ok, false, number);
  // …not a call linked to a contact, transferred to a person, where the caller gave a name, or asked for a call-back on another number.
  const db = fakeDb({ ...OURS, crm_clients: [] });
  assert.equal((await autoBlockVerdict(db, { ...base, contact_id: 'abc' })).ok, false);
  assert.equal((await autoBlockVerdict(db, { ...base, transferred: true })).ok, false);
  assert.equal((await autoBlockVerdict(db, { ...base, caller_name_said: true })).ok, false);
  assert.equal((await autoBlockVerdict(db, { ...base, callback_number: '+12105559999' })).ok, false);
  // …no usable number (withheld caller ID) → nothing to block.
  assert.equal((await autoBlockVerdict(db, { ...base, number: null })).ok, false);
  assert.equal((await autoBlockVerdict(db, { ...base, number: 'anonymous' })).ok, false);
  // …and a failed safety lookup means NO block, never "assume safe".
  const broken = { from: () => { throw new Error('db down'); } } as never;
  assert.equal((await autoBlockVerdict(broken, base)).ok, false);
  console.log('call-blocklist: all assertions passed');
})();
