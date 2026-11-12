/**
 * Checks for the Tasks page rules (src/lib/tasks-view.ts) with made-up tasks — no database, no network.
 *   npx tsx scripts/tasks-check.ts
 *   TASKS_DUMP=/path/to/dump.json npx tsx scripts/tasks-check.ts     (also prints how a real export sorts into sections)
 * Exits non-zero on the first failed expectation, so it can sit in front of a deploy like the other *-check scripts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addDaysYmd, bucketOf, compareFor, daysBetween, doneWithinDays, dueText, isDone, isListCall, listName, matchesQuery, normalizeStatus, ownerId, syncDone, taskHaystack, todayYmd, type TaskLike } from '../src/lib/tasks-view';

const NOW = new Date(2026, 10, 12, 20, 30);   // Nov 12 2026, 8:30 pm LOCAL — after 7pm Central the UTC date is already Nov 13
let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; };
const task = (o: Partial<TaskLike> & { title?: string }): TaskLike => ({ title: 'x', status: 'open', priority: 'normal', ...o });

// ── dates are local, never UTC ──
t('today is the local date even in the evening', () => assert.equal(todayYmd(NOW), '2026-11-12'));
t('today + 7 / +1 / month and year rollovers / daylight-saving end', () => {
  assert.equal(addDaysYmd(7, NOW), '2026-11-19');
  assert.equal(addDaysYmd(1, new Date(2026, 11, 31, 22, 0)), '2027-01-01');
  assert.equal(addDaysYmd(2, new Date(2026, 9, 30, 23, 59)), '2026-11-01');
  assert.equal(addDaysYmd(1, new Date(2026, 10, 1, 0, 30)), '2026-11-02');   // 2026-11-01 is the 25-hour day
  assert.equal(daysBetween('2026-11-12', '2026-11-03'), -9);
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
});

// ── done = status OR a stamp ──
t('done: status done, old "completed", a stamp alone, and not for plain open', () => {
  assert.equal(isDone(task({ status: 'done' })), true);
  assert.equal(isDone(task({ status: 'completed' })), true);
  assert.equal(isDone(task({ status: 'open', completed_at: '2026-11-02T10:00:00Z' })), true);   // finished in the Call Queue
  assert.equal(isDone(task({ status: 'in_progress' })), false);
  assert.equal(isDone(task({ status: 'open', completed_at: null })), false);
});
t('owner: assignee first, then the agent it was filed under, else nobody', () => {
  assert.equal(ownerId(task({ assigned_to: 'a', agent_id: 'b' })), 'a');
  assert.equal(ownerId(task({ assigned_to: null, agent_id: 'b' })), 'b');
  assert.equal(ownerId(task({})), null);
});

// ── sections ──
t('sections by date', () => {
  assert.equal(bucketOf(task({ due_date: '2026-11-11' }), NOW), 'overdue');
  assert.equal(bucketOf(task({ due_date: '2026-11-12' }), NOW), 'today');
  assert.equal(bucketOf(task({ due_date: '2026-11-13' }), NOW), 'week');
  assert.equal(bucketOf(task({ due_date: '2026-11-19' }), NOW), 'week');
  assert.equal(bucketOf(task({ due_date: '2026-11-20' }), NOW), 'later');
  assert.equal(bucketOf(task({ due_date: null }), NOW), 'nodate');
});
t('a task finished elsewhere never shows as overdue', () => {
  assert.equal(bucketOf(task({ due_date: '2026-10-31', status: 'open', completed_at: '2026-11-02T10:00:00Z' }), NOW), 'done');
  assert.equal(bucketOf(task({ due_date: '2026-10-31', status: 'done' }), NOW), 'done');
});
t('list calls are one pile, not overdue — but a plain dated call still is', () => {
  const listed = task({ type: 'call', due_date: '2026-10-12', description: 'Ask for: Bob\nFrom: Elkhorn Point' });
  assert.equal(isListCall(listed), true);
  assert.equal(listName(listed), 'Elkhorn Point');
  assert.equal(bucketOf(listed, NOW), 'calllist');
  assert.equal(bucketOf(task({ type: 'call', due_date: '2026-11-11', description: null }), NOW), 'overdue');
  assert.equal(isListCall(task({ type: 'follow_up', description: 'From: x' })), false);
  assert.equal(bucketOf({ ...listed, completed_at: '2026-11-01T00:00:00Z' }, NOW), 'done');
});

// ── order ──
t('overdue/today: priority first, then the older date; week/later: date first; done: newest first', () => {
  const a = task({ title: 'a', priority: 'normal', due_date: '2026-11-01' });
  const b = task({ title: 'b', priority: 'high', due_date: '2026-11-10' });
  const c = task({ title: 'c', priority: 'urgent', due_date: '2026-11-11' });
  assert.deepEqual([a, b, c].sort(compareFor('overdue')).map(x => x.title), ['c', 'b', 'a']);
  const w1 = task({ title: 'w1', priority: 'high', due_date: '2026-11-16' });
  const w2 = task({ title: 'w2', priority: 'normal', due_date: '2026-11-14' });
  assert.deepEqual([w1, w2].sort(compareFor('week')).map(x => x.title), ['w2', 'w1']);
  const d1 = task({ title: 'old', status: 'done', completed_at: '2026-10-01T10:00:00Z' });
  const d2 = task({ title: 'new', status: 'done', completed_at: '2026-11-09T10:00:00Z' });
  const d3 = task({ title: 'unstamped', status: 'done', updated_at: '2026-10-28T17:19:00Z' });
  assert.deepEqual([d1, d2, d3].sort(compareFor('done')).map(x => x.title), ['new', 'unstamped', 'old']);
  assert.deepEqual([task({ title: 'nodate-low', priority: 'low' }), task({ title: 'nodate-high', priority: 'high' })].sort(compareFor('nodate')).map(x => x.title), ['nodate-high', 'nodate-low']);
});
t('done in the last week', () => {
  assert.equal(doneWithinDays(task({ status: 'done', completed_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() }), 7, NOW), true);
  assert.equal(doneWithinDays(task({ status: 'done', completed_at: new Date(NOW.getTime() - 9 * 86_400_000).toISOString() }), 7, NOW), false);
});

// ── search ──
t('search finds a task by the contact or company, not just the title (62 tasks are just "Follow up")', () => {
  const hay = taskHaystack(task({ title: 'Follow up', description: 'ask about the Chipley LOI' }), 'Randall Rogers', 'Rogers Holdings');
  assert.equal(matchesQuery(hay, 'randall'), true);
  assert.equal(matchesQuery(hay, 'rogers holdings'), true);
  assert.equal(matchesQuery(hay, 'randall chipley'), true);   // words in any order, across fields
  assert.equal(matchesQuery(hay, 'randall zzz'), false);
  assert.equal(matchesQuery(hay, '   '), true);
});

// ── due labels ──
t('due labels', () => {
  assert.deepEqual(dueText(task({ due_date: '2026-11-03' }), NOW), { text: 'Nov 3 · 9d late', tone: 'late' });
  assert.deepEqual(dueText(task({ due_date: '2026-11-03' }), NOW, true), { text: '9d late', tone: 'late' });   // the narrow board card
  assert.deepEqual(dueText(task({ due_date: '2026-11-12' }), NOW), { text: 'Today', tone: 'today' });
  assert.deepEqual(dueText(task({ due_date: '2026-11-13' }), NOW), { text: 'Tomorrow', tone: 'soon' });
  assert.deepEqual(dueText(task({ due_date: '2026-11-17' }), NOW), { text: 'Nov 17', tone: 'soon' });
  assert.deepEqual(dueText(task({ due_date: '2026-12-25' }), NOW), { text: 'Dec 25', tone: 'later' });
  assert.deepEqual(dueText(task({}), NOW), { text: 'No date', tone: 'none' });
  assert.equal(dueText(task({ status: 'done', completed_at: new Date(2026, 10, 9, 15, 0).toISOString() }), NOW).text, 'Done Nov 9');
});

// ── status ⇄ completed_at ──
t('status values: "completed" (old Copilot) is done; anything unknown is rejected', () => {
  assert.equal(normalizeStatus('completed'), 'done');
  assert.equal(normalizeStatus('open'), 'open');
  assert.equal(normalizeStatus('in_progress'), 'in_progress');
  assert.equal(normalizeStatus('banana'), null);
  assert.equal(normalizeStatus(undefined), null);
});
t('marking done stamps completed_at; an existing stamp is kept', () => {
  assert.deepEqual(syncDone({ status: 'open', completed_at: null }, { status: 'done' }, 'NOW'), { completed_at: 'NOW' });
  assert.deepEqual(syncDone({ status: 'open', completed_at: 'EARLIER' }, { status: 'done' }, 'NOW'), { completed_at: 'EARLIER' });   // finished in the Call Queue, now healed
  assert.deepEqual(syncDone({ status: 'done', completed_at: 'EARLIER' }, { status: 'done', title: 'renamed' }, 'NOW'), { completed_at: 'EARLIER' });   // editing a done task keeps its stamp
});
t('reopening clears completed_at — even for the 8 rows that were stamped but still said open', () => {
  assert.deepEqual(syncDone({ status: 'done', completed_at: 'EARLIER' }, { status: 'open' }, 'NOW'), { completed_at: null });
  assert.deepEqual(syncDone({ status: 'done', completed_at: 'EARLIER' }, { status: 'in_progress' }, 'NOW'), { completed_at: null });
  assert.deepEqual(syncDone({ status: 'open', completed_at: 'EARLIER' }, { status: 'open' }, 'NOW'), { completed_at: null });
});
t('an edit with no status leaves completion alone; a new assignee becomes the agent', () => {
  assert.deepEqual(syncDone({ status: 'done', completed_at: 'EARLIER' }, { due_date: '2026-11-20' }, 'NOW'), {});
  assert.deepEqual(syncDone({ status: 'open' }, { assigned_to: 'brian' }, 'NOW'), { agent_id: 'brian' });
  assert.deepEqual(syncDone({ status: 'open' }, { assigned_to: null }, 'NOW'), {});   // unassigning keeps the agent it is filed under
});

// ── optional: how a real export sorts ──
if (process.env.TASKS_DUMP && fs.existsSync(process.env.TASKS_DUMP)) {
  const { tasks } = JSON.parse(fs.readFileSync(process.env.TASKS_DUMP, 'utf8')) as { tasks: TaskLike[] };
  const counts: Record<string, number> = {};
  for (const x of tasks) { const b = bucketOf(x); counts[b] = (counts[b] ?? 0) + 1; }
  console.log(`real export (${tasks.length} tasks, sections as of now):`, JSON.stringify(counts));
}

console.log(`tasks-check: ${n} groups of checks passed`);
