// Pure helpers for /api/gmail/send (kept apart so they can be tested without sending anything).
//
// 1) Follow-ups stay in each person's own Gmail thread. The CRM sends "See who opens it" as one separate copy per person, so each
//    person has their OWN Gmail thread. A follow-up (same subject, "Re:" ignored) must reuse THAT person's earlier copy as its
//    thread + In-Reply-To, whatever the composer knew: a saved draft, a contact card, a reply opened from the Sent list.
// 2) The duplicate-send guard: the same email (same subject and text) to the same people within minutes is sent once.

export type PriorRow = { to_email?: string | null; subject?: string | null; gmail_thread_id?: string | null; rfc_message_id?: string | null; email_at?: string | null };
export type Prior = { threadId: string; rfcId: string };

export const normSubject = (s: string) => (s ?? '').replace(/^\s*((re|fwd?):\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
export const plainAddr = (a: string) => ((a ?? '').match(/<([^>]+)>/)?.[1] ?? a ?? '').trim().toLowerCase();

const THREAD_ID_RE = /^[\w-]{1,64}$/;
const MESSAGE_ID_RE = /^<[^<>\s]+>$/;

/** The most recent earlier email to this address with the same subject: its Gmail thread and Message-ID, or null. */
export function pickPriorCopy(rows: PriorRow[], subject: string, addr: string): Prior | null {
  const want = normSubject(subject), a = addr.trim().toLowerCase();
  if (!want || !a) return null;
  const hits = rows
    .filter(r => !!r.gmail_thread_id && !!r.rfc_message_id && normSubject(r.subject ?? '') === want && (r.to_email ?? '').toLowerCase().includes(a))
    .filter(r => THREAD_ID_RE.test(r.gmail_thread_id!) && MESSAGE_ID_RE.test(r.rfc_message_id!.trim()))
    .sort((x, y) => String(y.email_at ?? '').localeCompare(String(x.email_at ?? '')));
  const top = hits[0];
  return top ? { threadId: top.gmail_thread_id!, rfcId: top.rfc_message_id!.trim() } : null;
}

const flat = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim();

/** True when EVERY recipient already got this exact email (same subject and text) in the rows given (the last few minutes). */
export function isDuplicateSend(rows: Array<{ to_email?: string | null; subject?: string | null; body?: string | null }>, addrs: string[], subjects: string[], bodyPlain: string): boolean {
  if (!addrs.length) return false;
  const body = flat(bodyPlain), subs = new Set(subjects.map(s => s.trim().toLowerCase()));
  return addrs.every(a => rows.some(r => subs.has((r.subject ?? '').trim().toLowerCase()) && flat(r.body ?? '') === body && (r.to_email ?? '').toLowerCase().includes(a.toLowerCase())));
}
