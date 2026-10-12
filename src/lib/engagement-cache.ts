import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { createHash } from 'node:crypto';

/**
 * Persistent stale-while-revalidate cache for expensive CRM read models, in
 * crm_engagement_cache. Unlike the per-instance Maps in front of it, it survives a cold
 * start and is shared by every instance: the first request after a lull answers from one
 * row instead of recomputing (~1.2s of sequential reads).
 *
 *   age < freshMs   → served as is
 *   age < staleMs   → served now, refreshed in the background
 *   older / absent  → computed inline (and stored)
 *   force           → recompute, store, ignore what's cached (the explicit refresh)
 */
const inflight = new Map<string, Promise<unknown>>();

export const cacheKey = (...parts: (string | number | null | undefined)[]) =>
  parts.map(p => String(p ?? '')).join('|');
export const hashKey = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 24);

export async function cachedCompute<T>(
  db: SupabaseClient,
  key: string,
  compute: () => Promise<T>,
  opts: { freshMs: number; staleMs: number; force?: boolean },
  shouldStore: (v: T) => boolean = () => true,
): Promise<{ value: T; source: 'fresh' | 'stale' | 'computed' }> {
  let row = null as { payload: T; computed_at: string } | null;
  if (!opts.force) {
    try {
      const { data } = await db.from('crm_engagement_cache').select('payload, computed_at').eq('key', key).maybeSingle();
      row = (data as { payload: T; computed_at: string } | null) ?? null;
    } catch { /* no cache → compute */ }
  }
  const age = row ? Date.now() - new Date(row.computed_at).getTime() : Infinity;

  const run = (): Promise<T> => {
    let p = inflight.get(key) as Promise<T> | undefined;
    if (!p) {
      p = compute().then(async v => {
        if (shouldStore(v)) {
          try { await db.from('crm_engagement_cache').upsert({ key, payload: v as unknown as object, computed_at: new Date().toISOString() }); } catch { /* optimisation only */ }
        }
        return v;
      }).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  };

  if (row && age < opts.freshMs) return { value: row.payload, source: 'fresh' };
  if (row && age < opts.staleMs) {
    // after() keeps the function alive only until the promise the callback RETURNS settles —
    // a detached `void run()` would be cut off with the response and never refresh.
    const bg = async () => { await run().catch(() => {}); };
    try { after(bg); } catch { void bg(); }
    return { value: row.payload, source: 'stale' };
  }
  return { value: await run(), source: 'computed' };
}
