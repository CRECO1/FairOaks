// Mail sent with "See who opens it" lands in Gmail as ONE thread PER PERSON, so a single email to three people used to
// show up as three rows, and sending it twice as six. This folds them back into units:
//   - one send   = copies of the same email, back to back in the list, within 2 minutes, to different people
//   - one group  = repeat sends of the same email (same subject, same people, within 30 minutes of each other)
// A reply keeps its own "Re:" subject, so it stays a separate unit from the email it answers.

export type SentLike = { id: string; subject: string; date: number };
export type Addr = { name: string; email: string };

export type SentPerson<T> = { email: string; name: string; threads: T[] }; // threads: newest send first
export type SentGroup<T> = {
  gid: string;                                  // id of the lead thread
  lead: T;                                      // first thread of the newest send (the row is drawn here)
  all: T[];                                     // every thread in the group, in list order
  sends: Array<{ at: number; threads: T[] }>;   // newest send first
  people: Array<SentPerson<T>>;                 // in the order of the newest send
};

export const SAME_SEND_MS = 120_000;
export const REPEAT_SEND_MS = 30 * 60_000;

const normSubject = (s: string) => s.replace(/^\s*((re|fwd?):\s*)+/i, '').trim().toLowerCase();
const exactSubject = (s: string) => s.trim().toLowerCase();

export function groupSends<T extends SentLike>(list: T[], isTracked: (t: T) => boolean, other: (t: T) => Addr): Map<string, SentGroup<T>> {
  const out = new Map<string, SentGroup<T>>();
  const mail = (t: T) => other(t).email.toLowerCase();

  // 1) single sends: back-to-back copies to different people
  type Send = { threads: T[]; at: number };
  const sends: Send[] = [];
  let i = 0;
  while (i < list.length) {
    const a = list[i];
    const grp = [a];
    const who = new Set([mail(a)]);
    let j = i + 1;
    if (isTracked(a) && mail(a)) {
      while (j < list.length && isTracked(list[j]) && !!mail(list[j]) && !who.has(mail(list[j]))
        && normSubject(list[j].subject) === normSubject(a.subject) && Math.abs(list[j].date - a.date) <= SAME_SEND_MS) {
        who.add(mail(list[j])); grp.push(list[j]); j++;
      }
    }
    if (grp.length >= 2) sends.push({ threads: grp, at: Math.max(...grp.map(t => t.date)) });
    i = j > i ? j : i + 1;
  }

  // 2) repeat sends of the same email to the same people join one group
  const accs: Array<{ key: string; sends: Send[] }> = [];
  for (const s of sends) {
    const people = [...new Set(s.threads.map(mail))].sort().join(',');
    const key = `${exactSubject(s.threads[0].subject)}|${people}`;
    const acc = accs.find(x => x.key === key && Math.abs(x.sends[x.sends.length - 1].at - s.at) <= REPEAT_SEND_MS);
    if (acc) acc.sends.push(s); else accs.push({ key, sends: [s] });
  }

  const pos = new Map(list.map((t, k) => [t.id, k]));
  for (const acc of accs) {
    const all = acc.sends.flatMap(s => s.threads).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
    const newestFirst = [...acc.sends].sort((a, b) => b.at - a.at);
    const people: Array<SentPerson<T>> = newestFirst[0].threads.map(t0 => {
      const e = mail(t0);
      return { email: other(t0).email, name: other(t0).name, threads: newestFirst.map(s => s.threads.find(t => mail(t) === e)).filter((t): t is T => !!t) };
    });
    const g: SentGroup<T> = { gid: all[0].id, lead: all[0], all, sends: newestFirst, people };
    for (const t of all) out.set(t.id, g);
  }
  return out;
}
