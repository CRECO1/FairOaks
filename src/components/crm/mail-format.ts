// Small date / address / avatar helpers shared by the mailbox list and the sent-mail panels.
export const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
export const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-US', CT);
export const when = (ms: number) => {
  const d = new Date(ms), now = new Date();
  if (dayKey(ms) === dayKey(now.getTime())) return d.toLocaleTimeString('en-US', { ...CT, hour: 'numeric', minute: '2-digit' });
  const sameYear = d.toLocaleDateString('en-US', { ...CT, year: 'numeric' }) === now.toLocaleDateString('en-US', { ...CT, year: 'numeric' });
  return d.toLocaleDateString('en-US', { ...CT, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};
export const whenLong = (ms: number) => new Date(ms).toLocaleString('en-US', { ...CT, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const parseAddr = (raw: string | null | undefined) => {
  const first = (raw ?? '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0]?.trim() ?? '';
  const m = first.match(/^"?(.*?)"?\s*<([^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: first };
};
export const initials = (s: string) => s.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '✉';
export const AVATARS = ['#475569', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#1d4ed8', '#4d7c0f', '#a21caf'];
export const colorFor = (s: string) => { let h = 0; for (const ch of s.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AVATARS[h % AVATARS.length]; };
// "6:29 PM" for today, "Nov 23, 6:29 PM" otherwise (no weekday or year): short enough to list several send times in a sentence.
export const whenShort = (ms: number) => {
  const d = new Date(ms), now = new Date();
  const t = d.toLocaleTimeString('en-US', { ...CT, hour: 'numeric', minute: '2-digit' });
  if (dayKey(ms) === dayKey(now.getTime())) return t;
  return `${d.toLocaleDateString('en-US', { ...CT, month: 'short', day: 'numeric' })}, ${t}`;
};
