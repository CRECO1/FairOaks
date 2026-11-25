import type { LiveMessage } from '@/lib/gmail-live';

// A chain (see sent-groups) is several Gmail threads: one per person per send. Read as ONE conversation, like Gmail does:
// every message in date order, and the per-person copies of one send collapse into a single message to everyone.

const SAME_SEND_MS = 60_000; // copies of one send go out a second or two apart
const splitAddrs = (s: string) => (s || '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x => x.trim()).filter(Boolean);
const emailOf = (a: string) => (a.match(/<([^>]+)>/)?.[1] ?? a).trim().toLowerCase();

export function mergeChain(lists: LiveMessage[][], me: string): { msgs: LiveMessage[]; copies: Map<string, LiveMessage[]> } {
  const seen = new Set<string>();
  const all = lists.flat().filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; }).sort((a, b) => a.date - b.date);
  const out: LiveMessage[] = [];
  const copies = new Map<string, LiveMessage[]>(); // message id shown -> the original copy messages behind it (for per-person open tracking)
  const lastAt = new Map<string, number>();          // message id shown -> time of the latest copy folded into it
  const mine = (m: LiveMessage) => emailOf(m.from) === me.toLowerCase();
  const subj = (m: LiveMessage) => m.subject.trim().toLowerCase();
  for (const m of all) {
    const rep = mine(m) ? out.find(x => copies.has(x.id) && subj(x) === subj(m) && Math.abs((lastAt.get(x.id) ?? x.date) - m.date) <= SAME_SEND_MS) : undefined;
    if (rep) {
      copies.get(rep.id)!.push(m);
      lastAt.set(rep.id, m.date);
      const have = new Set(splitAddrs(rep.to).map(emailOf));
      const extra = splitAddrs(m.to).filter(a => !have.has(emailOf(a)));
      if (extra.length) rep.to = [...splitAddrs(rep.to), ...extra].join(', ');
      continue;
    }
    const clone = { ...m };
    out.push(clone);
    if (mine(m)) { copies.set(clone.id, [m]); lastAt.set(clone.id, m.date); }
  }
  return { msgs: out, copies };
}
