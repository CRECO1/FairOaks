// Checks for src/lib/retry-read.ts — run: npx tsx scripts/retry-read.test.ts
import { readWithRetry } from '../src/lib/retry-read';

let bad = 0;
const ok = (c: unknown, what: string) => { console.log(c ? 'ok  ' : 'FAIL', what); if (!c) bad++; };

// A read that fails `failures` times, then succeeds. Records every call and every wait.
const flaky = (failures: number) => {
  const waits: number[] = []; let calls = 0;
  const read = async () => (++calls <= failures ? { data: null, error: { message: 'canceling statement due to statement timeout' } } : { data: ['a', 'b'], error: null });
  const sleep = async (ms: number) => { waits.push(ms); };
  return { read, sleep, waits, calls: () => calls };
};

(async () => {
  let f = flaky(0);
  let r = await readWithRetry(f.read, [700, 2500], f.sleep);
  ok(!r.error && f.calls() === 1 && f.waits.length === 0, 'a good read is used at once: one call, no waiting');

  f = flaky(1);
  r = await readWithRetry(f.read, [700, 2500], f.sleep);
  ok(!r.error && r.data?.length === 2 && f.calls() === 2 && f.waits.join() === '700', 'one failure: waits 700 ms, second try succeeds');

  f = flaky(2);
  r = await readWithRetry(f.read, [700, 2500], f.sleep);
  ok(!r.error && f.calls() === 3 && f.waits.join() === '700,2500', 'two failures: waits 700 then 2500 ms, third try succeeds');

  f = flaky(99);
  r = await readWithRetry(f.read, [700, 2500], f.sleep);
  ok(!!r.error && f.calls() === 3 && f.waits.join() === '700,2500', 'three failures: gives up after three tries and hands back the error');
  ok((r.error as { message: string }).message.includes('statement timeout'), '…with the real error message');

  f = flaky(99);
  r = await readWithRetry(f.read, [], f.sleep);
  ok(!!r.error && f.calls() === 1, 'no waits given: a single try');

  // a thenable that is not a real Promise (what the Supabase query builder is)
  let n = 0;
  const thenable = () => ({ then: (res: (v: { data: number; error: null | { message: string } }) => void) => res(++n < 2 ? { data: 0, error: { message: 'x' } } : { data: 7, error: null }) }) as PromiseLike<{ data: number; error: null | { message: string } }>;
  const t = await readWithRetry(thenable, [1], async () => {});
  ok(!t.error && t.data === 7 && n === 2, 'works with a query-builder style thenable');

  // default sleep really waits
  const t0 = Date.now(); let c = 0;
  await readWithRetry(async () => ({ error: ++c < 2 ? 'x' : null }), [60]);
  ok(Date.now() - t0 >= 50 && c === 2, 'the default wait is a real pause');

  console.log(bad ? `${bad} problem(s)` : 'all 8 retry-read checks passed');
  process.exit(bad ? 1 : 0);
})();
