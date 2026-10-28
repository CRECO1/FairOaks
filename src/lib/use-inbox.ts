'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// The CRM Inbox: every email that CAME IN and was filed on a contact or deal (replies the 10-minute Gmail job pulls in,
// plus whatever Sync brings). Unread is per device — what you have opened here — and only counts mail that arrived
// after you first opened the Inbox, so a new user isn't greeted by hundreds of old messages.

const supabase = createClient();
const READ_KEY = 'crm-inbox-read';
const BASE_KEY = 'crm-inbox-baseline';
const DONE_KEY = 'crm-inbox-done';      // conversations you've dealt with (Gmail's Archive); a NEW reply brings it back
const UNREAD_KEY = 'crm-inbox-unread';  // messages you marked unread again

export type InboxRow = {
  id: string; deal_id: string | null; client_id: string | null; from_email: string; to_email: string; cc_emails: string | null;
  subject: string; body: string | null; created_at: string; email_date: string; gmail_thread_id: string | null; rfc_message_id: string | null;
  attachments: Array<{ name: string }> | null;
};
export type InboxThread = { key: string; latest: InboxRow; rows: InboxRow[]; unread: number };

const loadSet = (key: string): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]); } catch { return new Set(); } };
const saveSet = (key: string, s: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...s].slice(-3000))); } catch { /* private window */ } };
const baseline = (): string => {
  try { let b = localStorage.getItem(BASE_KEY); if (!b) { b = new Date().toISOString(); localStorage.setItem(BASE_KEY, b); } return b; } catch { return new Date(0).toISOString(); }
};

export function useInbox(myAddresses: string[]) {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [forced, setForced] = useState<Set<string>>(() => new Set());
  const [base, setBase] = useState('');
  const addrKey = myAddresses.map(a => a.toLowerCase()).filter(Boolean).sort().join(',');
  const live = useRef(true);

  useEffect(() => { setRead(loadSet(READ_KEY)); setDone(loadSet(DONE_KEY)); setForced(loadSet(UNREAD_KEY)); setBase(baseline()); live.current = true; return () => { live.current = false; }; }, []);

  const reload = useCallback(async () => {
    const { data } = await supabase.from('crm_deal_emails')
      .select('id,deal_id,client_id,from_email,to_email,cc_emails,subject,body,created_at,email_date,gmail_thread_id,rfc_message_id,attachments')
      .eq('direction', 'received').order('created_at', { ascending: false }).limit(400);
    if (live.current) setRows((data ?? []) as InboxRow[]);
  }, []);

  useEffect(() => {
    void reload();
    const tick = () => { if (document.visibilityState === 'visible') void reload(); };
    const t = setInterval(tick, 3 * 60_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(t); window.removeEventListener('focus', tick); };
  }, [reload]);

  const markRead = useCallback((ids: string[]) => {
    setRead(prev => { const n = new Set(prev); ids.forEach(i => n.add(i)); saveSet(READ_KEY, n); return n; });
    setForced(prev => { if (!ids.some(i => prev.has(i))) return prev; const n = new Set(prev); ids.forEach(i => n.delete(i)); saveSet(UNREAD_KEY, n); return n; });
  }, []);
  const markUnread = useCallback((ids: string[]) => {
    setForced(prev => { const n = new Set(prev); ids.forEach(i => n.add(i)); saveSet(UNREAD_KEY, n); return n; });
    setDone(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); saveSet(DONE_KEY, n); return n; });
  }, []);
  const setDoneIds = useCallback((ids: string[], on: boolean) => setDone(prev => { const n = new Set(prev); ids.forEach(i => (on ? n.add(i) : n.delete(i))); saveSet(DONE_KEY, n); return n; }), []);

  // "Mine" = it was addressed to one of my mailboxes (To or Cc).
  const mine = useCallback((r: InboxRow) => { const hay = `${r.to_email},${r.cc_emails ?? ''}`.toLowerCase(); return addrKey.split(',').filter(Boolean).some(a => hay.includes(a)); }, [addrKey]);
  const isUnread = useCallback((r: InboxRow) => forced.has(r.id) || (!!base && r.created_at > base && !read.has(r.id)), [base, read, forced]);
  const isDone = useCallback((r: InboxRow) => done.has(r.id), [done]);

  const unreadMine = useMemo(() => (rows ?? []).filter(r => mine(r) && isUnread(r) && !done.has(r.id)).length, [rows, mine, isUnread, done]);

  const markAllRead = useCallback((list: InboxRow[]) => markRead(list.map(r => r.id)), [markRead]);

  return { rows, reload, mine, isUnread, isDone, markRead, markUnread, setDoneIds, markAllRead, unreadMine };
}

/** Group inbox rows into conversations, newest first. */
export function groupThreads(rows: InboxRow[], isUnread: (r: InboxRow) => boolean): InboxThread[] {
  const map = new Map<string, InboxRow[]>();
  for (const r of rows) { const k = r.gmail_thread_id ?? `solo_${r.id}`; (map.get(k) ?? map.set(k, []).get(k)!).push(r); }
  return [...map.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { key, latest: sorted[0], rows: sorted, unread: sorted.filter(isUnread).length };
  }).sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
}
