/**
 * Rules for the Tasks page, kept free of React so scripts/tasks-check.ts can run them on real rows.
 *
 * The rule that matters most: a task is DONE when its status says done OR it carries a completed_at stamp. The Tasks page used to
 * read only `status`, while the Dashboard, the Call Queue and the morning digest read only `completed_at` — so a task finished in
 * one place stayed "open" in the others (46 tasks marked Done on the Tasks page kept showing in the Call Queue; 8 finished in the
 * Call Queue kept showing as overdue on the Tasks page).
 */

export type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'nodate' | 'calllist' | 'done';
export const BUCKETS: readonly Bucket[] = ['overdue', 'today', 'week', 'later', 'nodate', 'calllist', 'done'];

export const TASK_STATUSES = ['open', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The few columns these rules read. Real rows carry more. */
export interface TaskLike {
  id?: string;
  title: string;
  description?: string | null;
  notes?: string | null;
  due_date?: string | null;
  status?: string | null;
  priority?: string | null;
  type?: string | null;
  assigned_to?: string | null;
  agent_id?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// ── dates (local, never UTC: toISOString().slice(0,10) flips to "tomorrow" every evening after ~7pm Central) ──
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayYmd = (now: Date = new Date()) => ymd(now);
/** today + n days as YYYY-MM-DD, counted on the local calendar (noon avoids daylight-saving edges). */
export const addDaysYmd = (n: number, now: Date = new Date()) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12));
/** whole days from one YYYY-MM-DD to another (positive = `to` is later). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}
export function shortDate(s: string): string {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── what a task is ──
export const isDone = (t: TaskLike): boolean => t.status === 'done' || t.status === 'completed' || !!t.completed_at;
/** Whose it is: the assignee, else the agent it was filed under (follow-ups made by the system carry only agent_id). Same rule as the sidebar badge. */
export const ownerId = (t: TaskLike): string | null => t.assigned_to || t.agent_id || null;
/** A call handed out from a list (assign-calls writes a "From: <list>" line). Those are one working pile, "carried over" rather than late. */
export const isListCall = (t: TaskLike): boolean => t.type === 'call' && /(^|\n)From:\s*\S/.test(`${t.description ?? ''}\n${t.notes ?? ''}`);
export const listName = (t: TaskLike): string | null => /^From:\s*(.+)$/m.exec(`${t.description ?? ''}\n${t.notes ?? ''}`)?.[1]?.trim() ?? null;
export const typeKey = (t: TaskLike): string => t.type || 'todo';
export const TYPE_FILTERS: readonly { key: string; label: string }[] = [
  { key: 'todo', label: 'To-dos' },
  { key: 'call', label: 'Calls' },
  { key: 'follow_up', label: 'Follow-ups' },
  { key: 'email', label: 'Emails' },
];

export function bucketOf(t: TaskLike, now: Date = new Date()): Bucket {
  if (isDone(t)) return 'done';
  if (isListCall(t)) return 'calllist';
  if (!t.due_date) return 'nodate';
  const today = todayYmd(now);
  if (t.due_date < today) return 'overdue';
  if (t.due_date === today) return 'today';
  return t.due_date <= addDaysYmd(7, now) ? 'week' : 'later';
}

/** When a finished task was finished (best guess for old rows that never got a stamp). */
export const doneAt = (t: TaskLike): string => t.completed_at ?? t.updated_at ?? t.due_date ?? t.created_at ?? '';
export const doneWithinDays = (t: TaskLike, days: number, now: Date = new Date()): boolean => {
  const at = Date.parse(doneAt(t));
  return Number.isFinite(at) && at >= now.getTime() - days * 86_400_000;
};

// ── ordering ──
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
export const priorityRank = (p?: string | null): number => PRIORITY_RANK[p ?? 'normal'] ?? 2;

/** Order inside a section: what to do first. Overdue / Today / No date: priority, then date. This week / Later: date, then priority. Done: newest first. */
export function compareFor(bucket: Bucket): (a: TaskLike, b: TaskLike) => number {
  const byDue = (a: TaskLike, b: TaskLike) => (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99');
  const byPri = (a: TaskLike, b: TaskLike) => priorityRank(a.priority) - priorityRank(b.priority);
  const byAge = (a: TaskLike, b: TaskLike) => (a.created_at ?? '').localeCompare(b.created_at ?? '');
  const byTitle = (a: TaskLike, b: TaskLike) => a.title.localeCompare(b.title);
  if (bucket === 'done') return (a, b) => doneAt(b).localeCompare(doneAt(a)) || byTitle(a, b);
  if (bucket === 'week' || bucket === 'later') return (a, b) => byDue(a, b) || byPri(a, b) || byAge(a, b) || byTitle(a, b);
  if (bucket === 'calllist') return (a, b) => (listName(a) ?? '').localeCompare(listName(b) ?? '') || byDue(a, b) || byTitle(a, b);
  return (a, b) => byPri(a, b) || byDue(a, b) || byAge(a, b) || byTitle(a, b);
}

// ── search: title + contact + company + notes, every word must appear (so "rashid camp" finds "Follow up: Camp Bullis Property" for Rashid) ──
export function taskHaystack(t: TaskLike, contact?: string | null, business?: string | null): string {
  return [t.title, contact, business, t.description, t.notes].filter(Boolean).join(' ').toLowerCase();
}
export function matchesQuery(haystack: string, query: string): boolean {
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(tok => haystack.includes(tok));
}

// ── how a due date reads ──
export type DueTone = 'late' | 'today' | 'soon' | 'later' | 'none' | 'done';
export function dueText(t: TaskLike, now: Date = new Date(), short = false): { text: string; tone: DueTone } {
  if (isDone(t)) {
    const at = new Date(doneAt(t));
    return { text: Number.isNaN(at.getTime()) ? 'Done' : `Done ${shortDate(ymd(at))}`, tone: 'done' };
  }
  if (!t.due_date) return { text: 'No date', tone: 'none' };
  const diff = daysBetween(todayYmd(now), t.due_date);
  if (diff < 0) return { text: short ? `${-diff}d late` : `${shortDate(t.due_date)} · ${-diff}d late`, tone: 'late' };
  if (diff === 0) return { text: 'Today', tone: 'today' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'soon' };
  return { text: shortDate(t.due_date), tone: diff <= 7 ? 'soon' : 'later' };
}

// ── keeping status and completed_at telling the same story (used by PATCH /api/crm/tasks/[id]; the database trigger does the same for every other writer) ──
export function normalizeStatus(v: unknown): TaskStatus | null {
  if (v === 'completed') return 'done';
  return (TASK_STATUSES as readonly string[]).includes(v as string) ? (v as TaskStatus) : null;
}
/**
 * Extra columns to write alongside a task update so it stays consistent:
 *  - status → done: stamp completed_at (keep an existing stamp);   status → open / in_progress: clear it (that is "reopen");
 *  - a new assignee also becomes the agent_id (the Call Queue and Dashboard load by agent_id, so a reassigned call must follow the person).
 */
export function syncDone(cur: { status?: string | null; completed_at?: string | null }, update: Record<string, unknown>, nowIso: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('status' in update) {
    if (update.status === 'done') out.completed_at = cur.completed_at ?? nowIso;
    else if (update.status === 'open' || update.status === 'in_progress') out.completed_at = null;
  }
  if (typeof update.assigned_to === 'string' && update.assigned_to) out.agent_id = update.assigned_to;
  return out;
}
