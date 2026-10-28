import { createClient } from '@/lib/supabase/client';

// "Needs reply" (Zack, 2026-10-28): inbound mail now files itself into the CRM every 10 minutes, so the CRM can
// say which conversations are waiting on US (their message is the last word) and which are waiting on THEM
// (ours is, and it has sat for a few days). Pure read of crm_deal_emails; nothing is written except a per-device
// "done" list for threads that need no answer.

const supabase = createClient();

export type MailRow = {
  id: string; deal_id: string | null; client_id: string | null; direction: 'sent' | 'received';
  from_email: string; to_email: string; cc_emails: string | null; subject: string;
  email_date: string; created_at: string; gmail_thread_id: string | null;
};
export type MailThread = { key: string; latest: MailRow; count: number; ageDays: number; mine: boolean };

export const NEEDS_REPLY_DAYS = 30;   // older than this is stale, not "needs a reply"
export const WAITING_AFTER_DAYS = 3;  // our last email unanswered this long = "waiting on them"

const DAY = 86_400_000;
const norm = (s: string) => s.replace(/^\s*((re|fwd?|aw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
// The date column has no time; created_at breaks ties within a day (a manual backfill stamps old mail with today's
// created_at, which is why the date leads).
const stamp = (r: MailRow) => `${r.email_date}|${r.created_at}`;

export async function loadMailRows(days = 45): Promise<MailRow[]> {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const { data } = await supabase.from('crm_deal_emails')
    .select('id,deal_id,client_id,direction,from_email,to_email,cc_emails,subject,email_date,created_at,gmail_thread_id')
    .gte('email_date', since).order('email_date', { ascending: false }).order('created_at', { ascending: false }).limit(2500);
  return (data ?? []) as MailRow[];
}

export function buildThreads(rows: MailRow[], myAddrs: string[], scope: 'mine' | 'team'): { needsReply: MailThread[]; waiting: MailThread[] } {
  const me = myAddrs.map(a => a.toLowerCase()).filter(Boolean);
  const touchesMe = (r: MailRow) => {
    const hay = (r.direction === 'sent' ? r.from_email : `${r.to_email},${r.cc_emails ?? ''}`).toLowerCase();
    return me.some(a => hay.includes(a));
  };
  // One conversation = same Gmail thread, OR same deal/contact + same subject: an email sent from two mailboxes
  // (or to several people as individual copies) lands in separate Gmail threads but is one conversation to us.
  const parent = new Map<string, string>();
  const find = (k: string): string => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(k, r); return r; };
  const union = (a: string, b: string) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
  for (const r of rows) {
    const ctx = r.client_id ?? r.deal_id;
    const byThread = r.gmail_thread_id ? `g:${r.gmail_thread_id}` : `r:${r.id}`;
    union(byThread, byThread);
    if (ctx && norm(r.subject)) union(byThread, `s:${ctx}|${norm(r.subject)}`);
  }
  const groups = new Map<string, MailRow[]>();
  for (const r of rows) {
    const key = find(r.gmail_thread_id ? `g:${r.gmail_thread_id}` : `r:${r.id}`);
    const g = groups.get(key); if (g) g.push(r); else groups.set(key, [r]);
  }
  const needsReply: MailThread[] = [], waiting: MailThread[] = [];
  const now = Date.now();
  groups.forEach(g => {
    // Stable id for the "done" list: the smallest member id, which doesn't depend on row order.
    const key = g.map(r => (r.gmail_thread_id ? `g:${r.gmail_thread_id}` : `r:${r.id}`)).sort()[0];
    const latest = g.reduce((a, b) => (stamp(b) > stamp(a) ? b : a));
    const mine = g.some(touchesMe);
    if (scope === 'mine' && !mine) return;
    // email_date is a Chicago calendar date; read it as local noon so day counts don't flip on timezone edges.
    const ageDays = Math.max(0, Math.floor((now - new Date(`${latest.email_date}T12:00:00`).getTime()) / DAY));
    const t: MailThread = { key, latest, count: g.length, ageDays, mine };
    if (latest.direction === 'received' && ageDays <= NEEDS_REPLY_DAYS) needsReply.push(t);
    else if (latest.direction === 'sent' && ageDays >= WAITING_AFTER_DAYS && ageDays <= NEEDS_REPLY_DAYS) waiting.push(t);
  });
  needsReply.sort((a, b) => stamp(b.latest).localeCompare(stamp(a.latest)));
  waiting.sort((a, b) => stamp(b.latest).localeCompare(stamp(a.latest)));
  return { needsReply, waiting };
}

// ── per-device "no reply needed" list: thread key → id of the message dismissed, so a NEW reply brings it back ──
const DONE_KEY = 'crm_needs_reply_done_v1';
const DONE_EVENT = 'crm-needs-reply-done';
export function loadDone(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}') || {}; } catch { return {}; }
}
export function setDone(key: string, messageId: string | null) {
  const d = loadDone();
  if (messageId) d[key] = messageId; else delete d[key];
  try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(DONE_EVENT));
}
export function onDoneChanged(fn: () => void) {
  window.addEventListener(DONE_EVENT, fn);
  return () => window.removeEventListener(DONE_EVENT, fn);
}
export const isDone = (done: Record<string, string>, t: MailThread) => done[t.key] === t.latest.id;

export async function countNeedsReply(myAddrs: string[]): Promise<number> {
  const rows = await loadMailRows();
  const done = loadDone();
  return buildThreads(rows, myAddrs, 'mine').needsReply.filter(t => !isDone(done, t)).length;
}
