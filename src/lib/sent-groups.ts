// Mail sent with "See who opens it" lands in Gmail as ONE thread PER PERSON, so a single email to three people used to show up as
// three rows, sending it again doubled that, and a follow-up on top of it tripled it. This folds them back into ONE chain:
//   - a send    = copies of the same email, back to back in the list, a minute or less apart, to different people
//   - a chain   = every send with the same subject (Re: / Fwd: ignored) to the same people, within 60 days of each other,
//                 plus any single message in that conversation to one of those people
// So the email, the accidental duplicate and the follow-up sent on it always stay together.

export type SentLike = { id: string; subject: string; date: number; count?: number };
export type Addr = { name: string; email: string };

export type SendKind = 'sent' | 'again' | 'followup';
export type SentSend<T> = { at: number; threads: T[]; kind: SendKind; subject: string };
export type SentPerson<T> = { email: string; name: string; threads: T[] }; // newest send first
export type SentGroup<T> = {
  gid: string;                  // id of the lead thread
  lead: T;                      // the newest thread in the list (the row is drawn here)
  all: T[];                     // every thread in the chain, in list order
  sends: Array<SentSend<T>>;    // newest first
  people: Array<SentPerson<T>>;
  subject: string;              // the subject of the first email in the chain (no "Re:")
  count: number;                // messages in the chain, like Gmail's count (each send once, plus every reply or follow-up inside a thread)
};

export const SAME_SEND_MS = 60_000; // copies of one send go out a second or two apart
export const REPEAT_SEND_MS = 30 * 60_000;
export const CHAIN_MS = 60 * 86_400_000;

export const normSubject = (s: string) => s.replace(/^\s*((re|fwd?):\s*)+/i, '').trim().toLowerCase();
const exactSubject = (s: string) => s.trim().toLowerCase();
const usable = (s: string) => { const n = normSubject(s); return n !== '' && n !== '(no subject)'; };

export function groupSends<T extends SentLike>(list: T[], isTracked: (t: T) => boolean, other: (t: T) => Addr): Map<string, SentGroup<T>> {
  const out = new Map<string, SentGroup<T>>();
  const mail = (t: T) => other(t).email.toLowerCase();

  // 1) single sends: back-to-back copies to different people
  type Send = { threads: T[]; at: number };
  const sends: Send[] = [];
  const inSend = new Set<string>();
  let i = 0;
  while (i < list.length) {
    const a = list[i];
    const grp = [a];
    const who = new Set([mail(a)]);
    let j = i + 1;
    if (isTracked(a) && mail(a) && usable(a.subject)) {
      while (j < list.length && isTracked(list[j]) && !!mail(list[j]) && !who.has(mail(list[j]))
        && normSubject(list[j].subject) === normSubject(a.subject) && Math.abs(list[j].date - grp[grp.length - 1].date) <= SAME_SEND_MS) {
        who.add(mail(list[j])); grp.push(list[j]); j++;
      }
    }
    if (grp.length >= 2) { sends.push({ threads: grp, at: Math.max(...grp.map(t => t.date)) }); grp.forEach(t => inSend.add(t.id)); }
    i = j > i ? j : i + 1;
  }

  // 2) sends of the same conversation to overlapping people join one chain (oldest first)
  type Chain = { key: string; people: Set<string>; sends: Send[]; lastAt: number; extras: T[] };
  const chains: Chain[] = [];
  for (const s of [...sends].sort((a, b) => a.at - b.at)) {
    const ppl = new Set(s.threads.map(mail));
    const key = normSubject(s.threads[0].subject);
    const ch = chains.find(c => c.key === key && Math.abs(s.at - c.lastAt) <= CHAIN_MS
      && ([...ppl].every(x => c.people.has(x)) || [...c.people].every(x => ppl.has(x))));
    if (ch) { ch.sends.push(s); ppl.forEach(x => ch.people.add(x)); ch.lastAt = Math.max(ch.lastAt, s.at); } else chains.push({ key, people: ppl, sends: [s], lastAt: s.at, extras: [] });
  }

  // 3) a single message in the same conversation to one of those people (a follow-up to just one of them) joins its chain
  for (const t of list) {
    if (inSend.has(t.id) || !usable(t.subject) || !mail(t)) continue;
    const key = normSubject(t.subject);
    const ch = chains.find(c => c.key === key && c.people.has(mail(t)) && c.sends.some(s => Math.abs(s.at - t.date) <= CHAIN_MS));
    if (!ch) continue;
    // A thread that already holds several messages has had its date pushed forward by a reply or a follow-up inside it, so its date no
    // longer says when it was sent: it belongs to the chain but is not a new send of its own.
    if ((t.count ?? 1) > 1) ch.extras.push(t); else ch.sends.push({ threads: [t], at: t.date });
    inSend.add(t.id);
  }

  const pos = new Map(list.map((t, k) => [t.id, k]));
  for (const ch of chains) {
    const oldestFirst = [...ch.sends].sort((a, b) => a.at - b.at);
    const labelled: Array<SentSend<T>> = oldestFirst.map((s, k) => {
      const prev = oldestFirst[k - 1];
      const subj = s.threads[0].subject;
      const kind: SendKind = k === 0 ? 'sent' : (exactSubject(subj) === exactSubject(prev.threads[0].subject) && s.at - prev.at <= REPEAT_SEND_MS) ? 'again' : 'followup';
      return { at: s.at, threads: s.threads, kind, subject: subj };
    });
    const newestFirst = [...labelled].reverse();
    const all = [...labelled.flatMap(s => s.threads), ...ch.extras].sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
    // people in the order they first appear when reading newest to oldest, so the most recent recipients lead
    const seen = new Set<string>();
    const people: Array<SentPerson<T>> = [];
    for (const s of newestFirst) for (const t0 of s.threads) {
      const e = mail(t0);
      if (seen.has(e)) continue;
      seen.add(e);
      people.push({ email: other(t0).email, name: other(t0).name, threads: newestFirst.map(sd => sd.threads.find(t => mail(t) === e)).filter((t): t is T => !!t) });
    }
    for (const e of ch.extras) { const pe = people.find(x => x.email.toLowerCase() === mail(e)); if (pe) pe.threads.push(e); }
    for (const pe of people) pe.threads.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
    const count = labelled.length + all.reduce((n, t) => n + Math.max(0, (t.count ?? 1) - 1), 0);
    const g: SentGroup<T> = { gid: all[0].id, lead: all[0], all, sends: newestFirst, people, subject: labelled[0].subject, count };
    for (const t of all) out.set(t.id, g);
  }
  return out;
}
