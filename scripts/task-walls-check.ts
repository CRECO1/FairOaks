/**
 * Checks for the task walls (src/lib/task-walls.ts) — no database, no network.
 *   npx tsx scripts/task-walls-check.ts
 * "Robert's tasks are hidden from Brian": a task belongs to whoever owns it (agent_id) or is assigned to it (assigned_to), and is hidden from a
 * walled-off person unless it ALSO belongs to them. The account owner is never walled. Exits non-zero on the first failed expectation.
 */
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dropWalledTasks, isOwnTask, ownTasksFilter, taskWalled, walledTaskOwners } from '../src/lib/task-walls';

const ROBERT = 'robert', BRIAN = 'brian', ZACK = 'zack', ED = 'ed';
const walls = new Set([ROBERT]);   // Brian is walled off from Robert
let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`  ok  ${name}`); };

// a stand-in for the service client: select('hidden_owner').eq('hidden_from', who) over a fixed list, with a call counter
type Fail = 'missing' | 'other';
const FAILURES: Record<Fail, { code: string; message: string }> = {
  missing: { code: 'PGRST205', message: "Could not find the table 'public.crm_task_walls' in the schema cache" },   // the SQL hasn't been applied yet
  other: { code: '08006', message: 'connection failure' },                                                           // the database hiccuped
};
function fakeDb(rows: Array<{ hidden_owner: string; hidden_from: string }>, opts: { fail?: Fail } = {}) {
  const calls = { n: 0 };
  const db = { from: () => ({ select: () => ({ eq: async (_c: string, who: string) => { calls.n++; return opts.fail ? { data: null, error: FAILURES[opts.fail] } : { data: rows.filter(r => r.hidden_from === who), error: null }; } }) }) } as unknown as SupabaseClient;
  return { db, calls };
}

(async () => {
  // ── which tasks are hidden from Brian ──
  await ok("Robert's own task (owner and assignee) is hidden from Brian", () => assert.equal(taskWalled({ agent_id: ROBERT, assigned_to: ROBERT }, walls, BRIAN), true));
  await ok('a task Robert owns with nobody assigned is hidden', () => assert.equal(taskWalled({ agent_id: ROBERT, assigned_to: null }, walls, BRIAN), true));
  await ok('a task only assigned to Robert (no owner) is hidden', () => assert.equal(taskWalled({ agent_id: null, assigned_to: ROBERT }, walls, BRIAN), true));
  await ok("Zack's task assigned to Robert is Robert's, so it is hidden", () => assert.equal(taskWalled({ agent_id: ZACK, assigned_to: ROBERT }, walls, BRIAN), true));
  await ok("a task Robert owns but that is assigned to Brian is Brian's (visible)", () => assert.equal(taskWalled({ agent_id: ROBERT, assigned_to: BRIAN }, walls, BRIAN), false));
  await ok("a task Brian owns that is assigned to Robert is Brian's (visible)", () => assert.equal(taskWalled({ agent_id: BRIAN, assigned_to: ROBERT }, walls, BRIAN), false));
  await ok("Brian's own task is visible", () => assert.equal(taskWalled({ agent_id: BRIAN, assigned_to: BRIAN }, walls, BRIAN), false));
  await ok("Zack's own task is visible to Brian", () => assert.equal(taskWalled({ agent_id: ZACK, assigned_to: ZACK }, walls, BRIAN), false));
  await ok("Ed's task is visible to Brian (the wall is only about Robert)", () => assert.equal(taskWalled({ agent_id: ED, assigned_to: null }, walls, BRIAN), false));
  await ok('an unowned, unassigned task is visible', () => assert.equal(taskWalled({ agent_id: null, assigned_to: null }, walls, BRIAN), false));
  await ok('missing fields count as nobody', () => assert.equal(taskWalled({}, walls, BRIAN), false));
  await ok('with no walls nothing is hidden', () => assert.equal(taskWalled({ agent_id: ROBERT, assigned_to: ROBERT }, new Set(), BRIAN), false));
  await ok('created_by is ignored (a task Brian made for Robert is still Robert\'s)', () => assert.equal(taskWalled({ agent_id: ROBERT, assigned_to: ROBERT, created_by: BRIAN } as never, walls, BRIAN), true));

  // ── who is walled ──
  const rows = [{ hidden_owner: ROBERT, hidden_from: BRIAN }];
  await ok('Brian is walled off from Robert', async () => assert.deepEqual([...(await walledTaskOwners(fakeDb(rows).db, { userId: BRIAN, role: 'admin' }))], [ROBERT]));
  await ok('Zack (super_admin) is never walled, and the table is not even read', async () => {
    const f = fakeDb([{ hidden_owner: ROBERT, hidden_from: ZACK }]);
    assert.equal((await walledTaskOwners(f.db, { userId: ZACK, role: 'super_admin' })).size, 0);
    assert.equal(f.calls.n, 0);
  });
  await ok('Ed has no walls', async () => assert.equal((await walledTaskOwners(fakeDb(rows).db, { userId: ED, role: 'agent' })).size, 0));
  await ok('Robert is not walled off from Brian (a wall is one-way)', async () => assert.equal((await walledTaskOwners(fakeDb(rows).db, { userId: ROBERT, role: 'agent' })).size, 0));
  await ok('a table that does not exist yet means no walls, not an error (code can ship before the SQL)', async () => assert.equal((await walledTaskOwners(fakeDb(rows, { fail: 'missing' }).db, { userId: 'someone-new', role: 'admin' })).size, 0));
  await ok('any OTHER failure to read the walls fails closed: an error, never "no wall"', async () => assert.rejects(walledTaskOwners(fakeDb(rows, { fail: 'other' }).db, { userId: 'blip-test', role: 'admin' }), /could not be read/));
  await ok('a failed read is not remembered: the next call reads again and finds the wall', async () => {
    const f = fakeDb([{ hidden_owner: ROBERT, hidden_from: 'blip-test' }]);
    assert.deepEqual([...(await walledTaskOwners(f.db, { userId: 'blip-test', role: 'admin' }))], [ROBERT]);
  });
  await ok('the answer is remembered for a moment (one read for two calls)', async () => {
    const f = fakeDb(rows);
    await walledTaskOwners(f.db, { userId: 'cache-test', role: 'admin' });
    await walledTaskOwners(f.db, { userId: 'cache-test', role: 'admin' });
    assert.equal(f.calls.n, 1);
  });

  // ── filtering a list ──
  const list = [
    { id: 1, agent_id: ROBERT, assigned_to: ROBERT }, { id: 2, agent_id: BRIAN, assigned_to: BRIAN }, { id: 3, agent_id: ZACK, assigned_to: null },
    { id: 4, agent_id: null, assigned_to: ROBERT }, { id: 5, agent_id: ROBERT, assigned_to: BRIAN },
  ];
  await ok("Brian's list loses Robert's tasks and keeps the rest", async () =>
    assert.deepEqual((await dropWalledTasks(fakeDb(rows).db, { userId: BRIAN, role: 'admin' }, list)).map(t => t.id), [2, 3, 5]));
  await ok("Zack's list is untouched", async () => assert.equal((await dropWalledTasks(fakeDb(rows).db, { userId: ZACK, role: 'super_admin' }, list)).length, 5));
  await ok("Robert's own list is untouched", async () => assert.equal((await dropWalledTasks(fakeDb(rows).db, { userId: ROBERT, role: 'agent' }, list)).length, 5));

  // ── agents see only their own tasks (Robert, Ed) ──
  await ok('a task filed under an agent is theirs', () => assert.equal(isOwnTask({ agent_id: ROBERT, assigned_to: null }, ROBERT), true));
  await ok('a task assigned to an agent is theirs', () => assert.equal(isOwnTask({ agent_id: BRIAN, assigned_to: ROBERT }, ROBERT), true));
  await ok("a colleague's task is not an agent's own", () => assert.equal(isOwnTask({ agent_id: BRIAN, assigned_to: BRIAN }, ROBERT), false));
  await ok("Zack's task is not an agent's own", () => assert.equal(isOwnTask({ agent_id: ZACK, assigned_to: null }, ED), false));
  await ok("a task nobody owns is not an agent's own", () => assert.equal(isOwnTask({ agent_id: null, assigned_to: null }, ROBERT), false));
  await ok('having created a task for someone else does not make it your own', () => assert.equal(isOwnTask({ agent_id: ED, assigned_to: ED, created_by: ROBERT } as never, ROBERT), false));
  await ok('the filter asks for owner or assignee and nothing else', () => assert.equal(ownTasksFilter('abc'), 'agent_id.eq.abc,assigned_to.eq.abc'));
  await ok("Robert's list, cut to his own: his tasks (owned 1, 5; assigned 4), not Brian's 2 or Zack's 3", () => assert.deepEqual(list.filter(t => isOwnTask(t, ROBERT)).map(t => t.id), [1, 4, 5]));
  await ok("Ed's list, cut to his own, is empty", () => assert.equal(list.filter(t => isOwnTask(t, ED)).length, 0));

  console.log(`\n${n} checks passed`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
