// Several parts of the Emails page ask for the same numbers (the drafts count is wanted by the sidebar AND the tab row, again every time
// you switch tabs or come back to the window). That used to be one request each, against a server that is sometimes slow. This shares them:
// one request per URL at a time, and the last answer is reused for a short while.

const inflight = new Map<string, Promise<unknown>>();
const recent = new Map<string, { at: number; v: unknown }>();

export function sharedJson<T = unknown>(url: string, ttlMs = 20_000, init?: RequestInit): Promise<T | null> {
  const hit = recent.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.v as T);
  const running = inflight.get(url);
  if (running) return running as Promise<T | null>;
  const p = fetch(url, init)
    .then(r => (r.ok ? r.json() : null))
    .then(j => { if (j !== null && j !== undefined) recent.set(url, { at: Date.now(), v: j }); return (j ?? null) as T | null; })
    .catch(() => null)
    .finally(() => { inflight.delete(url); });
  inflight.set(url, p);
  return p;
}

/** Drop remembered answers (after you change something, the next ask must go to the server). */
export function forgetShared(prefix: string) {
  for (const k of [...recent.keys()]) if (k.startsWith(prefix)) recent.delete(k);
}
