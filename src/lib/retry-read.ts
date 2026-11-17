/**
 * Runs a read that reports failure in its result instead of throwing (Supabase style: `{ data, error }`), and tries again
 * after each wait while it keeps failing. Returns the first good result, or the last failed one once the waits run out.
 *
 * Why: a database read can fail for a moment (a slow statement is cancelled, the connection drops). The Contacts list
 * treated one such failure as "this book is empty" until the page was reloaded.
 */
export async function readWithRetry<T extends { error: unknown }>(
  read: () => PromiseLike<T>,
  waits: readonly number[] = [700, 2500],
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<T> {
  let res = await read();
  for (const wait of waits) {
    if (!res.error) break;
    await sleep(wait);
    res = await read();
  }
  return res;
}
