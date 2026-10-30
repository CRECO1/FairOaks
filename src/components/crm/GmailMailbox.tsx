'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveMessage, ThreadSummary, GLabel } from '@/lib/gmail-live';
import { sanitizeHtml } from '@/lib/sanitize';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
// CRM open tracking for emails sent from the CRM: per Gmail thread / message, so the live views can show "👁 Opened 3×".
type Track = { tracked: boolean; opens: number; opened: boolean };

// Your real Gmail inside the CRM. On a wide screen it is a two-pane inbox (list on the left, the conversation on the
// right, so you never lose your place); on a phone the list and the conversation are separate screens. Mail is read live
// from Gmail — nothing is copied — and Reply / Reply all / Forward open the CRM's Compose window, so what you send is
// still logged and tracked here. Opening a conversation only dims it locally (marking it read IN Gmail needs a wider
// Google permission). With that permission (gmail.modify) you can also mark read/unread, archive, star and trash right
// here — every change is applied to Gmail itself and can be undone.

const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-US', CT);
const when = (ms: number) => {
  const d = new Date(ms), now = new Date();
  if (dayKey(ms) === dayKey(now.getTime())) return d.toLocaleTimeString('en-US', { ...CT, hour: 'numeric', minute: '2-digit' });
  const sameYear = d.toLocaleDateString('en-US', { ...CT, year: 'numeric' }) === now.toLocaleDateString('en-US', { ...CT, year: 'numeric' });
  return d.toLocaleDateString('en-US', { ...CT, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};
const whenLong = (ms: number) => new Date(ms).toLocaleString('en-US', { ...CT, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const groupLabel = (ms: number) => {
  const now = Date.now();
  if (dayKey(ms) === dayKey(now)) return 'Today';
  if (dayKey(ms) === dayKey(now - 86_400_000)) return 'Yesterday';
  if (now - ms < 7 * 86_400_000) return 'Earlier this week';
  const d = new Date(ms), sameYear = d.toLocaleDateString('en-US', { ...CT, year: 'numeric' }) === new Date().toLocaleDateString('en-US', { ...CT, year: 'numeric' });
  return d.toLocaleDateString('en-US', { ...CT, month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
};
const parseAddr = (raw: string | null | undefined) => {
  const first = (raw ?? '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0]?.trim() ?? '';
  const m = first.match(/^"?(.*?)"?\s*<([^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: first };
};
const addrCount = (raw: string | null | undefined) => (raw ?? '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(s => s.trim()).length;
const initials = (s: string) => s.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '✉';
const fmtBytes = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const AVATARS = ['#475569', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#1d4ed8', '#4d7c0f', '#a21caf'];
const colorFor = (s: string) => { let h = 0; for (const ch of s.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AVATARS[h % AVATARS.length]; };
const decodeSnippet = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const OPENED_KEY = 'crm-gmail-opened';
const loadOpened = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(OPENED_KEY) ?? '[]') as string[]); } catch { return new Set(); } };
const ageDays = (ms: number) => Math.floor((Date.now() - ms) / 86_400_000);
const ago = (iso: string | undefined) => { if (!iso) return ''; const d = ageDays(new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso).getTime()); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`; };
// "YYYY-MM-DD" (Central time) for today + n days; nextMonday = the coming Monday.
const ymdPlus = (n: number) => { const d = new Date(`${new Date().toLocaleDateString('en-CA', CT)}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const ymdNextMonday = () => { const d = new Date(`${new Date().toLocaleDateString('en-CA', CT)}T12:00:00`); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toLocaleDateString('en-CA'); };
const ymdLabel = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const previewable = (mime: string) => /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i.test(mime);

// In-session caches (gone on a full reload, which is fine): the list paints instantly from the last visit while a quiet
// refresh runs, and a conversation you hover or reopen is already there.
type ListCacheEntry = { threads: ThreadSummary[]; next: string | null; accounts: string[]; account: string | null };
const listCache = new Map<string, ListCacheEntry>();
const threadCache = new Map<string, LiveMessage[]>();
const inflight = new Map<string, Promise<LiveMessage[] | null>>();
const threadKey = (account: string | null, id: string, date: number) => `${account ?? ''}|${id}|${date}`;
async function loadThread(account: string | null, id: string, date: number): Promise<LiveMessage[] | null> {
  const key = threadKey(account, id, date);
  const hit = threadCache.get(key); if (hit) return hit;
  const running = inflight.get(key); if (running) return running;
  const job = (async () => {
    try {
      const r = await fetch(`/api/gmail/thread?id=${id}${account ? `&account=${encodeURIComponent(account)}` : ''}`);
      if (!r.ok) return null;
      const msgs = ((await r.json()).messages ?? []) as LiveMessage[];
      threadCache.set(key, msgs);
      if (threadCache.size > 40) threadCache.delete(threadCache.keys().next().value as string);
      return msgs;
    } catch { return null; } finally { inflight.delete(key); }
  })();
  inflight.set(key, job);
  return job;
}

type Act = 'read' | 'unread' | 'archive' | 'star' | 'unstar' | 'trash';
const UNDO_OF: Record<Act, string> = { archive: 'unarchive', trash: 'untrash', star: 'unstar', unstar: 'star', read: 'unread', unread: 'read' };
const DONE: Record<Act, string> = { archive: 'Archived', trash: 'Moved to Trash', star: 'Starred', unstar: 'Star removed', read: 'Marked read', unread: 'Marked unread' };
const ICON: Record<string, React.ReactNode> = {
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  open: <><path d="M3 10 12 4l9 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="m3 10 9 6 9-6" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  tag: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.4" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></>,
};
function Ic({ n, size = 16, fill = false }: { n: keyof typeof ICON; size?: number; fill?: boolean }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>{ICON[n]}</svg>;
}

export type ContactMatch = { kind: 'deal' | 'contact'; id: string; label: string; sub?: string; phone?: string; company?: string; role?: string; tags?: string[]; touched?: string } | null;

type Props = {
  box: 'inbox' | 'sent';
  isMobile: boolean;
  contactFor: (email: string) => ContactMatch;
  searchPeople: (q: string) => Array<{ name: string; email: string; sub?: string }>;
  onOpenDeal: (id: string) => void;
  onOpenContact: (id: string) => void;
  onReply: (m: LiveMessage, threadId: string, all: boolean, account: string | null) => void;
  onForward: (m: LiveMessage, threadId: string, account: string | null) => void;
  onNewCompose: () => void;
  notify: (msg: string) => void;
  onAddContact: (email: string, name: string) => Promise<boolean>;
};

// Old replies carry their whole history: fold it behind a "⋯" pill like Gmail does, so the new text is what you see.
// Works on already-sanitized HTML (class attributes survive); <details> needs no script, so it works in the sandbox.
function collapseQuotes(html: string): string {
  if (typeof DOMParser === 'undefined' || !html) return html;
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const body = doc.body;
    const hasTextBefore = (el: Element) => {
      const r = doc.createRange(); r.setStart(body, 0); r.setEndBefore(el);
      return r.toString().replace(/\s+/g, '').length > 15;
    };
    const wrap = (nodes: Node[]) => {
      const d = doc.createElement('details'); d.className = 'q';
      const sm = doc.createElement('summary'); sm.textContent = '⋯';
      sm.setAttribute('title', 'Show quoted text');
      nodes[0].parentNode!.insertBefore(d, nodes[0]); d.appendChild(sm); nodes.forEach(n => d.appendChild(n));
    };
    const first = body.querySelector('div.gmail_quote, blockquote.gmail_quote, div.yahoo_quoted, blockquote[type="cite"]');
    if (first && hasTextBefore(first)) {
      const next = first.previousElementSibling;
      // Gmail puts the "On … wrote:" line inside .gmail_quote; Apple Mail/Thunderbird put it just before.
      wrap(next && /wrote:\s*$/i.test(next.textContent ?? '') ? [next, first] : [first]);
      return body.innerHTML;
    }
    // Outlook: everything from the "From: … Sent: …" header block onward.
    const rp = body.querySelector('#divRplyFwdMsg');
    if (rp && hasTextBefore(rp)) {
      const nodes: Node[] = []; let n: Node | null = rp.previousElementSibling?.tagName === 'HR' ? rp.previousElementSibling : rp;
      while (n) { nodes.push(n); n = n.nextSibling; }
      wrap(nodes);
      return body.innerHTML;
    }
    // Plain text: fold from the "On … wrote:" line down.
    if (body.firstElementChild?.getAttribute('style')?.includes('pre-wrap') && body.children.length === 1) {
      const el = body.firstElementChild as HTMLElement;
      const text = el.innerHTML;
      const idx = text.search(/\n(On .{5,200}wrote:)\n/);
      if (idx > 40) { el.innerHTML = `${text.slice(0, idx)}<details class="q"><summary title="Show quoted text">⋯</summary>${text.slice(idx)}</details>`; return body.innerHTML; }
    }
  } catch { /* show it unfolded */ }
  return html;
}

// Never load tracking pixels while reading. Our own open-tracking pixel sits in every email sent from the CRM, so showing
// your sent mail here would count as the RECIPIENT opening it; incoming mail's 1×1 trackers are dropped too (privacy).
function stripTrackers(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    if (/\/api\/track\//i.test(tag)) return '';
    const one = (attr: string) => new RegExp(`\\b${attr}\\s*=\\s*["']?1(px)?["']?(?=[\\s/>"'])`, 'i').test(tag) || new RegExp(`${attr}\\s*:\\s*1px`, 'i').test(tag);
    return one('width') && one('height') ? '' : tag;
  });
}

// A sandboxed frame for the message HTML: no scripts can run, links open in new tabs, and it grows to fit its content.
function MessageFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(120);
  const fit = useCallback(() => {
    const d = ref.current?.contentDocument;
    if (d?.documentElement) setH(Math.min(30000, Math.max(40, d.documentElement.scrollHeight)));
  }, []);
  // No scripts or event handlers survive; links open in a new tab, never inside the frame.
  const safe = useMemo(() => collapseQuotes(sanitizeHtml(stripTrackers(html)).replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ')), [html]);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#222;font:14px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 .8ex;border-left:2px solid #d5d9df;padding-left:1ex;color:#555}a{color:#1a56c4}details.q{margin:10px 0}details.q>summary{display:inline-block;cursor:pointer;list-style:none;background:#eceff3;color:#4b5563;border-radius:10px;padding:0 10px;font-size:13px;line-height:18px;user-select:none}details.q>summary::-webkit-details-marker{display:none}details.q[open]>summary{margin-bottom:8px}.gmail_signature{color:#555}</style></head><body>${safe}</body></html>`;
  return <iframe ref={ref} title="Message" srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    onLoad={() => {
      fit(); setTimeout(fit, 400); setTimeout(fit, 1500);
      const d = ref.current?.contentDocument;
      if (d) { d.addEventListener('toggle', fit, true); try { new ResizeObserver(fit).observe(d.documentElement); } catch { /* older browsers: the timers above cover it */ } }
    }}
    style={{ width: '100%', height: h, border: 'none', display: 'block', background: '#fff', borderRadius: 6 }} />;
}

function Avatar({ name, email, size = 36, warm = false }: { name: string; email: string; size?: number; warm?: boolean }) {
  return <div aria-hidden style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 700, color: '#fff', background: warm ? '#c9922c' : colorFor(email || name) }}>{initials(name || email)}</div>;
}

// Pick (or create) Gmail labels for a conversation — or for everything you've ticked.
function LabelMenu({ labels, current, onToggle, onCreate, buttonStyle, align = 'right', text }: {
  labels: GLabel[]; current: Set<string>; onToggle: (id: string, on: boolean) => void; onCreate: (name: string) => Promise<GLabel | null>;
  buttonStyle: React.CSSProperties; align?: 'left' | 'right'; text?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const n = name.trim(); if (!n || busy) return;
    setBusy(true);
    try { const l = await onCreate(n); if (l) { setName(''); onToggle(l.id, true); } } finally { setBusy(false); }
  };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" title="Label" aria-label="Label" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} style={buttonStyle}><Ic n="tag" />{text}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 29 }} />
          <div role="menu" style={{ position: 'absolute', [align]: 0, top: 'calc(100% + 4px)', zIndex: 30, width: 250, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.16)', overflow: 'hidden', color: 'var(--k-111)' }}>
            <div style={{ padding: '7px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', background: 'var(--k-fafafa)' }}>Label as…</div>
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {labels.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--k-9ca3af)' }}>No labels yet — make one below.</div>}
              {labels.map(l => (
                <button key={l.id} type="button" role="menuitemcheckbox" aria-checked={current.has(l.id)} onClick={() => onToggle(l.id, !current.has(l.id))}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 12px', border: 'none', borderTop: '1px solid var(--k-f0f0f0)', background: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--k-111)', fontFamily: "'DM Sans',sans-serif", textAlign: 'left' }}>
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, background: l.bg ?? '#9ca3af' }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: current.has(l.id) ? 700 : 500 }}>{l.name}</span>
                  {current.has(l.id) && <span aria-hidden style={{ color: '#c9922c', fontWeight: 800 }}>✓</span>}
                </button>
              ))}
            </div>
            <form onSubmit={e => { e.preventDefault(); void add(); }} style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid var(--k-e5e7eb)', background: 'var(--k-fafafa)' }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="New label" aria-label="New label name" maxLength={60}
                style={{ flex: 1, minWidth: 0, height: 30, padding: '0 8px', borderRadius: 6, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 13 }} />
              <button type="submit" disabled={busy || !name.trim()} style={{ padding: '0 10px', borderRadius: 6, border: 'none', background: '#c9922c', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', opacity: busy || !name.trim() ? 0.5 : 1 }}>Add</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

export default function GmailMailbox(p: Props) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'files' | 'starred'>('all');
  const [who, setWho] = useState<'all' | 'deals' | 'contacts' | 'other'>('all'); // triage by who it is from / to
  const contactsOnly = who !== 'all';
  const [labels, setLabels] = useState<GLabel[]>([]);
  const [labelId, setLabelId] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [account, setAccount] = useState<string | null>(null); // the mailbox you picked (null = your first)
  const [self, setSelf] = useState<string | null>(null);       // whose mailbox is being shown (to label your own messages "Me")
  const [connected, setConnected] = useState(true);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [open, setOpenThread] = useState<ThreadSummary | null>(null);
  const [wide, setWide] = useState(false);
  const [canModify, setCanModify] = useState<boolean | null>(null); // null = not known yet
  const [reconnect, setReconnect] = useState<string | null>(null);
  const [hideBanner, setHideBanner] = useState(true);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setOpened(loadOpened()); }, []);
  useEffect(() => { try { setHideBanner(Date.now() - Number(localStorage.getItem('crm-gmail-modify-banner') ?? 0) < 3 * 86_400_000); } catch { setHideBanner(false); } }, []);
  // Two panes only when there is room for both.
  useEffect(() => {
    const on = () => setWide(!p.isMobile && window.innerWidth >= 1180);
    on(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on);
  }, [p.isMobile]);

  const build = useCallback((pageToken?: string) => {
    const sp = new URLSearchParams({ box: p.box });
    if (filter !== 'all') sp.set('filter', filter);
    if (term) sp.set('q', term);
    if (account) sp.set('account', account);
    if (labelId) sp.set('labelId', labelId);
    if (pageToken) sp.set('pageToken', pageToken);
    return `/api/gmail/mailbox?${sp}`;
  }, [p.box, filter, term, account, labelId]);

  const cacheKey = `${p.box}|${filter}|${term}|${account ?? ''}|${labelId}`;
  const load = useCallback(async (silent = false) => {
    setErr('');
    const cached = listCache.get(cacheKey);
    if (cached && !silent) { setThreads(cached.threads); setNext(cached.next); setAccounts(cached.accounts); } // instant paint, refresh below
    else if (!silent) setThreads(null);
    try {
      const r = await fetch(build());
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (!cached) { setErr(j.error ?? 'Could not load your mail.'); setThreads([]); } return; }
      setConnected(j.connected !== false); setAccounts(j.accounts ?? []); if (j.account) setSelf(j.account);
      if (Array.isArray(j.labels)) setLabels(j.labels as GLabel[]);
      if (typeof j.canModify === 'boolean') setCanModify(j.canModify); if (j.reconnect) setReconnect(j.reconnect);
      const fresh = (j.threads ?? []) as ThreadSummary[];
      listCache.set(cacheKey, { threads: fresh, next: j.next ?? null, accounts: j.accounts ?? [], account: j.account ?? account });
      setThreads(fresh); setNext(j.next ?? null);
    } catch { if (!cached) { setErr('Could not reach Gmail — check your connection.'); setThreads([]); } }
  }, [build, account, cacheKey]);

  useEffect(() => { setOpenThread(null); setFilter(f => (p.box === 'sent' && f === 'unread' ? 'all' : f)); }, [p.box]);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { void load(); }, [load]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); try { await load(true); } finally { setRefreshing(false); } };

  // A quiet check every 2 minutes: if newer conversations arrived, offer to show them (never reshuffles the list under you).
  const [fresh, setFresh] = useState(0);
  const topIds = useRef<string[]>([]);
  useEffect(() => { topIds.current = (threads ?? []).slice(0, 25).map(t => `${t.id}:${t.date}`); setFresh(0); }, [threads]);
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible' || !topIds.current.length) return;
      try {
        const j = await (await fetch(build())).json();
        const have = new Set(topIds.current);
        const n = ((j.threads ?? []) as ThreadSummary[]).filter(t => !have.has(`${t.id}:${t.date}`)).length;
        if (n > 0) setFresh(n);
      } catch { /* try again next time */ }
    };
    const t = setInterval(tick, 2 * 60_000);
    return () => clearInterval(t);
  }, [build]);

  const [tracking, setTracking] = useState<Map<string, Track>>(() => new Map());
  useEffect(() => {
    const ids = (threads ?? []).map(t => t.id).filter(id => !tracking.has(id));
    if (!ids.length) return;
    let live = true;
    (async () => {
      const got = new Map<string, Track>(ids.map(id => [id, { tracked: false, opens: 0, opened: false }]));
      for (let i = 0; i < ids.length; i += 60) {
        const { data } = await supabase.from('crm_deal_emails').select('gmail_thread_id,opened_at,open_count,tracked').in('gmail_thread_id', ids.slice(i, i + 60)).eq('direction', 'sent').eq('tracked', true);
        for (const r of (data ?? []) as Array<{ gmail_thread_id: string; opened_at: string | null; open_count: number | null }>) {
          const t = got.get(r.gmail_thread_id); if (!t) continue;
          t.tracked = true; t.opens += r.open_count ?? (r.opened_at ? 1 : 0); t.opened = t.opened || !!r.opened_at;
        }
      }
      if (live) setTracking(prev => { const n = new Map(prev); got.forEach((v, k) => n.set(k, v)); return n; });
    })().catch(() => {});
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads]);

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const j = await (await fetch(build(next))).json();
      setThreads(prev => [...(prev ?? []), ...(j.threads ?? [])]); setNext(j.next ?? null);
    } finally { setLoadingMore(false); }
  };

  const keyOf = (t: ThreadSummary) => `${t.id}:${t.date}`;
  const isUnread = (t: ThreadSummary) => t.unread && !opened.has(keyOf(t));
  const otherOf = useCallback((t: ThreadSummary) => parseAddr(p.box === 'sent' ? t.to : t.from), [p.box]);
  const openThread = (t: ThreadSummary) => {
    setOpenThread(t);
    if (canModify && t.unread) void act(t, 'read', true); // also clears it in Gmail itself (and the sidebar badge)
    setOpened(prev => { const n = new Set(prev); n.add(keyOf(t)); try { localStorage.setItem(OPENED_KEY, JSON.stringify([...n].slice(-3000))); } catch { /* ignore */ } return n; });
  };

  const flash = (msg: string, undo?: () => void) => { setToast({ msg, undo }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 7000); };
  const send = async (id: string, action: string, quiet = false): Promise<boolean> => {
    try {
      const r = await fetch('/api/gmail/modify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, account: account ?? self ?? undefined }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { window.dispatchEvent(new Event('crm-gmail-changed')); return true; }
      if (j.needsScope) setCanModify(false);
      if (!quiet) p.notify(j.error ?? 'Could not change that conversation.');
    } catch { if (!quiet) p.notify('Could not reach Gmail — try again.'); }
    return false;
  };
  // Optimistic: the list changes at once, Gmail is updated behind it, and a failure puts everything back.
  const act = async (t: ThreadSummary, action: Act, silent = false) => {
    if (canModify === false) { p.notify('Allow the CRM to change your Gmail first — see the note above the list.'); return; }
    const before = threads;
    const removing = action === 'archive' || action === 'trash';
    if (removing) setThreads(prev => (prev ?? []).filter(x => x.id !== t.id));
    else setThreads(prev => (prev ?? []).map(x => x.id !== t.id ? x : { ...x, ...(action === 'read' ? { unread: false } : action === 'unread' ? { unread: true } : action === 'star' ? { starred: true } : { starred: false }) }));
    if (action === 'unread') setOpened(prev => { const n = new Set(prev); n.delete(keyOf(t)); try { localStorage.setItem(OPENED_KEY, JSON.stringify([...n].slice(-3000))); } catch { /* ignore */ } return n; });
    listCache.clear();
    if (!(await send(t.id, action))) { setThreads(before); return; }
    if (silent) return;
    flash(DONE[action], removing ? () => { setThreads(before); listCache.clear(); void send(t.id, UNDO_OF[action]); setToast(null); } : undefined);
  };

  // Labels: optimistic toggle on one conversation, create a new one, or add one to everything ticked.
  const labelThread = async (t: ThreadSummary, id: string, on: boolean) => {
    if (canModify === false) { p.notify('Allow the CRM to change your Gmail first — see the note above the list.'); return; }
    const before = threads;
    setThreads(prev => (prev ?? []).map(x => x.id !== t.id ? x : { ...x, labels: on ? [...new Set([...(x.labels ?? []), id])] : (x.labels ?? []).filter(l => l !== id) }));
    listCache.clear();
    if (!(await send(t.id, `${on ? 'label' : 'unlabel'}:${id}`))) setThreads(before);
  };
  const createLabel = async (name: string): Promise<GLabel | null> => {
    try {
      const r = await fetch('/api/gmail/labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, account: account ?? self ?? undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (j.needsScope) setCanModify(false); p.notify(j.error ?? 'Could not create the label.'); return null; }
      setLabels(prev => [...prev.filter(x => x.id !== j.label.id), j.label as GLabel].sort((a, b) => a.name.localeCompare(b.name)));
      return j.label as GLabel;
    } catch { p.notify('Could not reach Gmail — try again.'); return null; }
  };
  const [noReply, setNoReply] = useState(false);
  const [sugOpen, setSugOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const sugs = useMemo(() => (/[:"(]/.test(q) ? [] : p.searchPeople(q)), [q, p]);
  const visible = useMemo(() => {
    let list = threads ?? [];
    if (who !== 'all') list = list.filter(t => { const a = otherOf(t), m = a.email ? p.contactFor(a.email) : null; return who === 'deals' ? m?.kind === 'deal' : who === 'contacts' ? !!m : !m; });
    if (noReply) list = list.filter(t => t.lastMine && ageDays(t.date) >= 3);
    return list;
  }, [threads, who, noReply, otherOf, p]);

  // Bulk select: tick several conversations (shift-click for a range), then one action for all of them.
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const lastTick = useRef<number>(-1);
  useEffect(() => { setSel(new Set()); lastTick.current = -1; }, [p.box, filter, term, account, who, noReply, labelId]);
  const tick = (id: string, idx: number, range: boolean) => setSel(prev => {
    const n = new Set(prev);
    if (range && lastTick.current >= 0) { const [a, b] = [Math.min(lastTick.current, idx), Math.max(lastTick.current, idx)]; const on = !prev.has(id); for (const x of visible.slice(a, b + 1)) { if (on) n.add(x.id); else n.delete(x.id); } }
    else if (n.has(id)) n.delete(id); else n.add(id);
    lastTick.current = idx; return n;
  });
  const bulk = async (action: Act) => {
    if (canModify === false) { p.notify('Allow the CRM to change your Gmail first — see the note above the list.'); return; }
    const ids = [...sel], idSet = new Set(ids), before = threads, removing = action === 'archive' || action === 'trash';
    setSel(new Set());
    if (removing) setThreads(prev => (prev ?? []).filter(x => !idSet.has(x.id)));
    else setThreads(prev => (prev ?? []).map(x => !idSet.has(x.id) ? x : { ...x, ...(action === 'read' ? { unread: false } : action === 'unread' ? { unread: true } : action === 'star' ? { starred: true } : { starred: false }) }));
    if (action === 'unread') setOpened(prev => { const n = new Set(prev); for (const x of before ?? []) if (idSet.has(x.id)) n.delete(keyOf(x)); try { localStorage.setItem(OPENED_KEY, JSON.stringify([...n].slice(-3000))); } catch { /* ignore */ } return n; });
    listCache.clear();
    const failed: string[] = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => { while (i < ids.length) { const id = ids[i++]; if (!(await send(id, action, true))) failed.push(id); } }));
    window.dispatchEvent(new Event('crm-gmail-changed'));
    const okIds = ids.filter(x => !failed.includes(x));
    if (failed.length) { void load(true); p.notify(`${failed.length} of ${ids.length} could not be changed — they are back in the list.`); }
    if (!okIds.length) return;
    flash(`${DONE[action]} · ${okIds.length} conversation${okIds.length === 1 ? '' : 's'}`, removing ? () => { setThreads(before); listCache.clear(); okIds.forEach(id => void send(id, UNDO_OF[action], true)); setToast(null); } : undefined);
  };
  const bulkLabel = async (id: string) => {
    const ids = [...sel], idSet = new Set(ids), name = labels.find(l => l.id === id)?.name ?? 'label';
    setThreads(prev => (prev ?? []).map(x => !idSet.has(x.id) ? x : { ...x, labels: [...new Set([...(x.labels ?? []), id])] }));
    listCache.clear();
    const failed: string[] = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => { while (i < ids.length) { const t = ids[i++]; if (!(await send(t, `label:${id}`, true))) failed.push(t); } }));
    if (failed.length) { void load(true); p.notify(`${failed.length} of ${ids.length} could not be labeled.`); }
    else flash(`Labeled “${name}” · ${ids.length} conversation${ids.length === 1 ? '' : 's'}`);
  };
  // A filter that only finds a few matches in what is loaded keeps reading older mail (a few pages at most) so it isn't empty by accident.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setHelp(false); return; }
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault(); setHelp(v => !v);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  const autoPages = useRef(0);
  useEffect(() => { autoPages.current = 0; }, [p.box, filter, term, account, who, noReply, labelId]);
  useEffect(() => {
    if (!(contactsOnly || noReply) || !next || loadingMore || visible.length >= 8 || autoPages.current >= 6) return;
    autoPages.current += 1; void more();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, noReply, next, loadingMore, visible.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && sel.size) setSel(new Set()); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [sel.size]);

  // j / k step through the list, / jumps to search (two-pane only; the reader has its own r / a / f / Esc).
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key !== 'j' && e.key !== 'k') return;
      const i = open ? visible.findIndex(x => x.id === open.id) : -1;
      const n = visible[e.key === 'j' ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1)];
      if (n) { e.preventDefault(); openThread(n); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, open, visible]);

  // From the reader: after archiving/trashing, move on to the next conversation (like Gmail) or back to the list.
  const readerAct = (action: Act) => {
    if (!open) return;
    const i = visible.findIndex(x => x.id === open.id), nxt = visible[i + 1] ?? visible[i - 1];
    void act(open, action);
    if (action === 'archive' || action === 'trash') { if (wide && nxt) openThread(nxt); else setOpenThread(null); }
  };

  const chip = (on: boolean): React.CSSProperties => ({
    padding: p.isMobile ? '8px 14px' : '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? '#111' : 'var(--k-e5e7eb)'}`, background: on ? '#111' : 'var(--k-fff)', color: on ? '#fff' : 'var(--k-374151)',
    fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  });

  const reader = (embedded: boolean) => open && (
    <ThreadReader key={open.id} t={threads?.find(x => x.id === open.id) ?? open} box={p.box} canModify={canModify === true} onAct={readerAct} labels={labels} onLabel={(id, on) => void labelThread(open, id, on)} onCreateLabel={createLabel} account={account} self={self ?? account} isMobile={p.isMobile} embedded={embedded} contactFor={p.contactFor} onOpenDeal={p.onOpenDeal} onOpenContact={p.onOpenContact}
      onReply={p.onReply} onForward={p.onForward} notify={p.notify} onAddContact={p.onAddContact} onBack={() => setOpenThread(null)} />
  );

  // Phone / narrow: the conversation replaces the list.
  if (open && !wide) return <div>{reader(false)}{toast && <div role="status" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: p.isMobile ? 84 : 24, zIndex: 80, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', background: '#111', color: '#fff', borderRadius: 10, fontSize: 13.5, fontWeight: 600 }}>{toast.msg}{toast.undo && <button type="button" onClick={toast.undo} style={{ border: 'none', background: 'none', color: '#e8b563', fontWeight: 800, cursor: 'pointer', fontSize: 13.5 }}>Undo</button>}</div>}</div>;

  const toolbar = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <div className="crm-tabs-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
        <button onClick={() => setFilter('all')} style={chip(filter === 'all')}>{p.box === 'inbox' ? 'All inbox' : 'All sent'}</button>
        {p.box === 'inbox' && <button onClick={() => setFilter('unread')} style={chip(filter === 'unread')}>Unread</button>}
        <button onClick={() => setFilter('files')} style={chip(filter === 'files')}>📎 Files</button>
        <button onClick={() => setFilter('starred')} style={chip(filter === 'starred')}>★ Starred</button>
        {p.box === 'sent' && <button onClick={() => setNoReply(v => !v)} aria-pressed={noReply} title="Conversations where you sent the last message 3+ days ago and nobody has answered (of what is loaded)" style={chip(noReply)}>⏳ No reply</button>}
        <button onClick={() => setWho(v => (v === 'deals' ? 'all' : 'deals'))} aria-pressed={who === 'deals'} title="People with a deal (of what is loaded)" style={chip(who === 'deals')}>💼 Deals</button>
        <button onClick={() => setWho(v => (v === 'contacts' ? 'all' : 'contacts'))} aria-pressed={who === 'contacts'} title="Anyone who is in your CRM (of what is loaded)" style={chip(who === 'contacts')}>👤 Contacts</button>
        <button onClick={() => setWho(v => (v === 'other' ? 'all' : 'other'))} aria-pressed={who === 'other'} title="People who are NOT in your CRM — newsletters, notices, strangers (of what is loaded)" style={chip(who === 'other')}>📭 Not in CRM</button>
        {labels.length > 0 && (
          <select value={labelId} onChange={e => setLabelId(e.target.value)} aria-label="Show one Gmail label"
            style={{ height: p.isMobile ? 38 : 32, borderRadius: 999, border: `1px solid ${labelId ? '#111' : 'var(--k-e5e7eb)'}`, background: labelId ? '#111' : 'var(--k-fff)', color: labelId ? '#fff' : 'var(--k-374151)', fontSize: 13, fontWeight: 600, padding: '0 10px', fontFamily: "'DM Sans',sans-serif" }}>
            <option value="">🏷 All labels</option>
            {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: p.isMobile || wide ? 0 : 'auto', flexWrap: 'wrap', width: p.isMobile || wide ? '100%' : undefined }}>
        <div style={{ position: 'relative', flex: p.isMobile || wide ? '1 1 0' : '0 1 300px', minWidth: 0 }}>
          <input ref={searchRef} value={q} onChange={e => { setQ(e.target.value); setSugOpen(true); }} onFocus={() => setSugOpen(true)} onBlur={() => setTimeout(() => setSugOpen(false), 150)}
            placeholder="Search mail or type a name  ·  press /" aria-label="Search Gmail" aria-autocomplete="list"
            style={{ width: '100%', boxSizing: 'border-box', height: p.isMobile ? 42 : 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 14 }} />
          {sugOpen && sugs.length > 0 && (
            <div role="listbox" aria-label="People in your CRM" style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 20, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden', minWidth: 240 }}>
              <div style={{ padding: '6px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', background: 'var(--k-fafafa)' }}>Mail with…</div>
              {sugs.map(g => (
                <div key={g.email} role="option" aria-selected={false} onMouseDown={e => { e.preventDefault(); setQ(`(from:${g.email} OR to:${g.email})`); setSugOpen(false); }}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', cursor: 'pointer', borderTop: '1px solid var(--k-f0f0f0)' }}>
                  <Avatar name={g.name} email={g.email} size={26} warm />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.email}{g.sub ? ` · ${g.sub}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {accounts.length > 1 && (
          <select value={account ?? self ?? ''} onChange={e => setAccount(e.target.value)} aria-label="Gmail account"
            style={{ height: p.isMobile ? 42 : 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 8px' }}>
            {accounts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <button type="button" onClick={() => void refresh()} title="Refresh" aria-label="Refresh"
          style={{ height: p.isMobile ? 42 : 34, width: p.isMobile ? 42 : 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 15, cursor: 'pointer', opacity: refreshing ? 0.5 : 1 }}>{refreshing ? '…' : '↻'}</button>
        {!p.isMobile && <button type="button" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"
          style={{ height: 34, width: 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 15, cursor: 'pointer' }}>⌨</button>}
      </div>
    </div>
  );

  const list = (
    <>
      <style>{'.gm-chk{display:none;position:absolute;inset:0;align-items:center;justify-content:center}.gm-row:hover .gm-av,.gm-sel .gm-av{display:none}.gm-row:hover .gm-chk,.gm-sel .gm-chk{display:flex}.gm-acts{display:none}.gm-row:hover .gm-acts,.gm-row:focus-within .gm-acts{display:flex}@media (hover:none){.gm-acts{display:none!important}}'}</style>
      {canModify === false && reconnect && !hideBanner && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10, padding: '10px 12px', background: 'var(--k-fffbeb)', border: '1px solid var(--k-fde68a)', borderRadius: 10, fontSize: 13, color: 'var(--k-92400e)' }}>
          <span style={{ flex: '1 1 220px', minWidth: 0 }}><b>Work your Gmail from here.</b> Mark read, archive, star and trash without leaving the CRM — it needs your OK once.</span>
          <a href={reconnect} style={{ padding: '7px 14px', borderRadius: 8, background: '#c9922c', color: '#fff', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>Allow</a>
          <button type="button" aria-label="Not now" onClick={() => { setHideBanner(true); try { localStorage.setItem('crm-gmail-modify-banner', String(Date.now())); } catch { /* ignore */ } }}
            style={{ border: 'none', background: 'none', color: 'var(--k-92400e)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>Not now</button>
        </div>
      )}
      {fresh > 0 && (
        <button type="button" onClick={() => void load(true)}
          style={{ width: '100%', marginBottom: 10, padding: '10px', border: '1px solid var(--k-fde68a)', background: 'var(--k-fdf6e8)', color: 'var(--k-92400e)', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          ↑ {fresh} new {fresh === 1 ? 'conversation' : 'conversations'} — show
        </button>
      )}
      {sel.size > 0 && (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8, padding: '8px 10px', background: '#111', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
          <span style={{ marginRight: 4 }}>{sel.size} selected</span>
          {sel.size < visible.length && <button type="button" onClick={() => setSel(new Set(visible.map(x => x.id)))} style={{ border: 'none', background: 'none', color: '#e8b563', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>All {visible.length}</button>}
          <span style={{ flex: 1 }} />
          {([p.box === 'inbox' ? ['archive', 'Archive', 'archive'] : null, ['read', 'Mark read', 'open'], ['unread', 'Mark unread', 'mail'], ['star', 'Star', 'star'], ['trash', 'Trash', 'trash']] as Array<[Act, string, string] | null>).filter((x): x is [Act, string, string] => !!x).map(([a2, label, icon]) => (
            <button key={a2} type="button" onClick={() => void bulk(a2)} title={label} aria-label={label}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 32, padding: 0, border: '1px solid #3a3a3f', borderRadius: 8, background: '#1c1c1f', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}><Ic n={icon as keyof typeof ICON} size={16} /></button>
          ))}
          <LabelMenu labels={labels} current={new Set()} onToggle={(id, on) => { if (on) void bulkLabel(id); }} onCreate={createLabel}
            buttonStyle={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 32, padding: 0, border: '1px solid #3a3a3f', borderRadius: 8, background: '#1c1c1f', color: '#fff', cursor: 'pointer' }} />
          <button type="button" onClick={() => setSel(new Set())} aria-label="Clear selection" title="Clear (Esc)" style={{ width: 32, height: 32, border: 'none', borderRadius: 8, background: 'none', color: '#bbb', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}
      {threads === null ? <ListSkeleton />
      : !connected ? <Empty title="Gmail isn’t connected" sub="Connect your Google account (bottom of the sidebar) and your mail shows up here." />
      : err ? <Empty title="Couldn’t load your mail" sub={err} />
      : visible.length === 0 ? <Empty title={term || contactsOnly || filter !== 'all' ? 'Nothing matches' : p.box === 'inbox' ? 'You’re all caught up' : 'Nothing here yet'} sub={contactsOnly && threads.length ? 'None of the loaded conversations are with people in your CRM — try “Load older mail”.' : term ? 'Try different words.' : 'Nothing to show.'} />
      : (
        <div className={sel.size ? 'gm-sel' : undefined} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
          {visible.map((t, i) => {
            const a = otherOf(t);
            const name = a.name || a.email || '(unknown)';
            const unread = isUnread(t);
            const match = a.email ? p.contactFor(a.email) : null;
            const selected = open?.id === t.id;
            const label = groupLabel(t.date);
            const showHeader = i === 0 || groupLabel(visible[i - 1].date) !== label;
            return (
              <React.Fragment key={t.id}>
                {showHeader && <div style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', background: 'var(--k-fafafa)', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none', borderBottom: '1px solid var(--k-f0f0f0)' }}>{label}</div>}
                <div role="button" tabIndex={0} className="gm-row" onClick={() => openThread(t)} onKeyDown={e => { if (e.key === 'Enter') openThread(t); }}
                  onMouseEnter={() => { if (!p.isMobile) void loadThread(account, t.id, t.date); }}
                  style={{ position: 'relative', display: 'flex', gap: 12, alignItems: 'flex-start', padding: '11px 14px', borderTop: !showHeader && i ? '1px solid var(--k-f0f0f0)' : 'none', cursor: 'pointer', borderLeft: `3px solid ${selected ? '#c9922c' : 'transparent'}`, background: sel.has(t.id) ? 'var(--k-fdf6e8)' : selected ? 'var(--k-fef9f0)' : unread ? 'var(--k-fffdf7)' : 'var(--k-fff)' }}>
                  <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
                    <div className="gm-av"><Avatar name={name} email={a.email} warm={!!match} /></div>
                    {canModify && !p.isMobile && (
                      <div className="gm-chk" onClick={e => { e.stopPropagation(); tick(t.id, i, e.shiftKey); }} title="Select (shift-click for a range)">
                        <input type="checkbox" aria-label={`Select ${name}`} checked={sel.has(t.id)} onChange={() => {}} style={{ width: 18, height: 18, accentColor: '#c9922c', cursor: 'pointer' }} />
                      </div>
                    )}
                    {(!canModify || p.isMobile) && <style>{'.gm-row .gm-av{display:block!important}'}</style>}
                  </div>
                  {canModify && !p.isMobile && (
                    <div className="gm-acts" onClick={e => e.stopPropagation()} style={{ position: 'absolute', right: 8, top: 6, gap: 2, padding: 2, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
                      {([p.box === 'inbox' ? ['archive', 'Archive', 'archive'] : null, [unread ? 'read' : 'unread', unread ? 'Mark read' : 'Mark unread', unread ? 'open' : 'mail'], [t.starred ? 'unstar' : 'star', t.starred ? 'Remove star' : 'Star', 'star'], ['trash', 'Trash', 'trash']] as Array<[Act, string, string] | null>).filter((x): x is [Act, string, string] => !!x).map(([act2, label, icon]) => (
                        <button key={act2} type="button" title={label} aria-label={label} onClick={() => void act(t, act2)}
                          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 6, background: 'none', cursor: 'pointer', color: icon === 'star' && t.starred ? '#c9922c' : 'var(--k-6b7280)' }}><Ic n={icon as keyof typeof ICON} fill={icon === 'star' && t.starred} /></button>
                      ))}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 14, fontWeight: unread ? 800 : 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                        {unread && <span aria-label="Unread" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#c9922c', marginRight: 6, verticalAlign: 'middle' }} />}
                        {p.box === 'sent' ? <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}>To: </span> : null}{name}
                        {t.count > 1 && <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> {t.count}</span>}
                        {t.starred && <span aria-label="Starred" style={{ display: 'inline-block', marginLeft: 6, verticalAlign: 'middle', color: '#c9922c' }}><Ic n="star" size={13} fill /></span>}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }} title={whenLong(t.date)}>{t.files && <span aria-label="Has attachments" title="Has attachments" style={{ marginRight: 5 }}>📎</span>}{when(t.date)}</span>
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--k-111)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: unread ? 700 : 500 }}>{t.subject}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--k-9ca3af)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decodeSnippet(t.snippet)}</div>
                    {(match || tracking.get(t.id)?.tracked || (t.labels?.length ?? 0) > 0 || (p.box === 'sent' && t.lastMine && ageDays(t.date) >= 3)) && (
                      <div style={{ marginTop: 4, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, fontWeight: 700 }}>
                        {match && <span style={{ color: 'var(--k-a06a12)' }}>{match.kind === 'deal' ? '💼 Deal' : `👤 ${match.role || 'Contact'}`} · {match.label}</span>}
                        {(t.labels ?? []).slice(0, 2).map(id => { const l = labels.find(x => x.id === id); return l ? <span key={id} style={{ background: l.bg ?? '#e5e7eb', color: l.fg ?? '#374151', borderRadius: 4, padding: '0 6px', fontWeight: 600, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name.split('/').pop()}</span> : null; })}
                        {(t.labels?.length ?? 0) > 2 && <span style={{ color: 'var(--k-9ca3af)' }}>+{(t.labels?.length ?? 0) - 2}</span>}
                        {p.box === 'sent' && t.lastMine && ageDays(t.date) >= 3 && <span title="You sent the last message and nobody has answered" style={{ color: 'var(--k-92400e)', background: 'var(--k-fdf6e8)', border: '1px solid var(--k-fde68a)', borderRadius: 10, padding: '0 7px' }}>⏳ No reply · {ageDays(t.date)}d</span>}
                        {tracking.get(t.id)?.tracked && (tracking.get(t.id)!.opened
                          ? <span title="Opened by the recipient (CRM open tracking)" style={{ color: 'var(--k-065f46)', background: 'var(--k-d1fae5)', borderRadius: 10, padding: '0 7px' }}>👁 Opened{tracking.get(t.id)!.opens > 1 ? ` ${tracking.get(t.id)!.opens}×` : ''}</span>
                          : <span title="Not opened yet" style={{ color: 'var(--k-9ca3af)', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: '0 7px', fontWeight: 600 }}>Not opened</span>)}
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          {next && (
            <button type="button" onClick={() => void more()} disabled={loadingMore}
              style={{ width: '100%', padding: '13px', border: 'none', borderTop: '1px solid var(--k-f0f0f0)', background: 'var(--k-fafafa)', color: 'var(--k-374151)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
              {loadingMore ? 'Loading…' : 'Load older mail'}
            </button>
          )}
        </div>
      )}
    </>
  );

  const helpEl = help && (
    <div role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelp(false)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--k-fff)', borderRadius: 14, padding: '20px 24px', width: 'min(460px, 100%)', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--k-111)', flex: 1 }}>Keyboard shortcuts</div>
          <button type="button" onClick={() => setHelp(false)} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--k-6b7280)' }}>✕</button>
        </div>
        {([['Move through the list', 'j / k'], ['Open the conversation', 'Enter'], ['Search', '/'], ['Compose a new email', 'c'], ['Reply', 'r'], ['Reply all', 'a'], ['Forward', 'f'], ['Archive', 'e'], ['Move to Trash', '#'], ['Star / unstar', 's'], ['Mark unread', 'Shift + U'], ['Back / clear selection / close', 'Esc'], ['This list', '?']] as Array<[string, string]>).map(([what, keys]) => (
          <div key={what} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderTop: '1px solid var(--k-f0f0f0)', fontSize: 14, color: 'var(--k-374151)' }}>
            <span>{what}</span><kbd style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, background: 'var(--k-f3f4f6)', border: '1px solid var(--k-e5e7eb)', borderRadius: 6, padding: '1px 8px', color: 'var(--k-111)', whiteSpace: 'nowrap' }}>{keys}</kbd>
          </div>
        ))}
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--k-9ca3af)' }}>Archive, trash and star need the Gmail “Allow” step. Tip: type a contact’s name in the search box to see all your mail with them.</div>
      </div>
    </div>
  );
  const toastEl = toast && (
    <div role="status" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: p.isMobile ? 84 : 24, zIndex: 80, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', background: '#111', color: '#fff', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,.25)', fontSize: 13.5, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>
      {toast.msg}
      {toast.undo && <button type="button" onClick={toast.undo} style={{ border: 'none', background: 'none', color: '#e8b563', fontWeight: 800, cursor: 'pointer', fontSize: 13.5, fontFamily: "'DM Sans',sans-serif" }}>Undo</button>}
    </div>
  );
  if (!wide) return <div>{toolbar}{list}{toastEl}{helpEl}</div>;

  // Two panes: each scrolls on its own, like Gmail.
  const paneH = 'calc(100vh - 250px)';
  return (
    <div>
      {toolbar}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 400px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ height: paneH, minHeight: 480, overflowY: 'auto', paddingRight: 2 }}>{list}</div>
        <div style={{ height: paneH, minHeight: 480, overflowY: 'auto' }}>
          {open ? reader(true) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--k-9ca3af)', background: 'var(--k-fff)', border: '1px dashed var(--k-e5e7eb)', borderRadius: 12, textAlign: 'center', padding: 24 }}>
              <div style={{ fontSize: 34 }} aria-hidden>✉️</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-374151)' }}>Select a conversation to read it</div>
              <div style={{ fontSize: 12.5 }}>j / k to move · r reply · a reply all · f forward · e archive · s star · # trash · / search</div>
            </div>
          )}
        </div>
      </div>
      {toastEl}{helpEl}
    </div>
  );
}

function ListSkeleton() {
  const bar = (w: string, h = 10): React.CSSProperties => ({ width: w, height: h, borderRadius: 5, background: 'var(--k-eef0f2)', animation: 'crmPulse 1.2s ease-in-out infinite' });
  return (
    <div aria-busy="true" aria-label="Loading your Gmail" style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
      <style>{'@keyframes crmPulse{0%,100%{opacity:.55}50%{opacity:1}}'}</style>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '13px 14px', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none' }}>
          <div style={{ ...bar('36px', 36), borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={bar(`${40 + (i * 13) % 30}%`, 12)} />
            <div style={bar(`${70 - (i * 7) % 25}%`)} />
            <div style={bar(`${55 + (i * 11) % 30}%`, 8)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px dashed var(--k-e5e7eb)', borderRadius: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-374151)' }}>{title}</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function ThreadReader(p: {
  t: ThreadSummary; box: 'inbox' | 'sent'; canModify: boolean; onAct: (a: Act) => void; labels: GLabel[]; onLabel: (id: string, on: boolean) => void; onCreateLabel: (name: string) => Promise<GLabel | null>; account: string | null; self: string | null; isMobile: boolean; embedded: boolean; contactFor: (email: string) => ContactMatch;
  onOpenDeal: (id: string) => void; onOpenContact: (id: string) => void;
  onReply: Props['onReply']; onForward: Props['onForward']; onBack: () => void;
  notify: Props['notify']; onAddContact: Props['onAddContact'];
}) {
  const [msgs, setMsgs] = useState<LiveMessage[] | null>(null);
  const [err, setErr] = useState('');
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [filed, setFiled] = useState<Set<string>>(() => new Set());
  const [savedAtt, setSavedAtt] = useState<Set<string>>(() => new Set());
  const [remindOpen, setRemindOpen] = useState(false);
  const [opens, setOpens] = useState<Map<string, { opened: boolean; n: number; last: string | null }>>(() => new Map());
  useEffect(() => {
    let live = true;
    supabase.from('crm_deal_emails').select('gmail_message_id,opened_at,last_opened_at,open_count').eq('gmail_thread_id', p.t.id).eq('direction', 'sent').eq('tracked', true)
      .then(({ data }) => {
        if (!live) return;
        const m = new Map<string, { opened: boolean; n: number; last: string | null }>();
        for (const r of (data ?? []) as Array<{ gmail_message_id: string | null; opened_at: string | null; last_opened_at: string | null; open_count: number | null }>)
          if (r.gmail_message_id) m.set(r.gmail_message_id, { opened: !!r.opened_at, n: r.open_count ?? (r.opened_at ? 1 : 0), last: r.last_opened_at ?? r.opened_at });
        setOpens(m);
      });
    return () => { live = false; };
  }, [p.t.id]);

  useEffect(() => {
    let live = true;
    setErr('');
    const cached = threadCache.get(threadKey(p.account, p.t.id, p.t.date));
    const show = (list: LiveMessage[]) => { setMsgs(list); setFolded(new Set(list.slice(0, -1).map(m => m.id))); }; // older messages fold like Gmail
    if (cached) { show(cached); return () => { live = false; }; }
    setMsgs(null);
    loadThread(p.account, p.t.id, p.t.date).then(list => {
      if (!live) return;
      if (!list) { setErr('Could not open this conversation.'); setMsgs([]); } else show(list);
    });
    return () => { live = false; };
  }, [p.t.id, p.t.date, p.account]);

  // PDFs and pictures open in a new tab; everything else downloads. ⬇ always downloads.
  const fetchFile = async (m: LiveMessage, a: { part: string; mime: string }) => {
    const r = await fetch(`/api/gmail/mailbox-attachment?messageId=${m.id}&part=${encodeURIComponent(a.part)}${p.account ? `&account=${encodeURIComponent(p.account)}` : ''}`);
    if (!r.ok) throw new Error(String(r.status));
    return URL.createObjectURL(new Blob([await r.blob()], { type: a.mime }));
  };
  const openAtt = async (m: LiveMessage, a: { part: string; name: string; mime: string }, asDownload = false) => {
    setBusy(`${m.id}:${a.part}`); setErr('');
    const tab = !asDownload && previewable(a.mime) ? window.open('', '_blank') : null; // must open inside the click
    try {
      const url = await fetchFile(m, a);
      if (tab) tab.location.href = url;
      else { const link = document.createElement('a'); link.href = url; link.download = a.name; document.body.appendChild(link); link.click(); link.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch { tab?.close(); setErr(`Couldn’t open ${a.name} — try again.`); }
    finally { setBusy(null); }
  };

  // File to CRM: copy this one message onto the deal/contact card (attachments included) — the whole team sees it there.
  const fileTo = async (m: LiveMessage, target: NonNullable<ContactMatch>) => {
    setWorking(m.id);
    try {
      const r = await fetch('/api/gmail/file-message', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: m.id, account: p.account ?? undefined, ...(target.kind === 'deal' ? { dealId: target.id } : { clientId: target.id }) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { p.notify(j.error ?? 'Could not file this message.'); return; }
      setFiled(prev => new Set(prev).add(m.id));
      p.notify(j.already ? `Already on ${target.label}` : `Filed to ${target.label}`);
    } finally { setWorking(null); }
  };
  // File the whole conversation at once (every message; the route skips ones already on the card).
  const [filingAll, setFilingAll] = useState(false);
  const fileAll = async (target: NonNullable<ContactMatch>) => {
    if (!msgs?.length) return;
    setFilingAll(true);
    let added = 0, already = 0, failed = 0;
    try {
      for (const m of msgs) {
        const r = await fetch('/api/gmail/file-message', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: m.id, account: p.account ?? undefined, ...(target.kind === 'deal' ? { dealId: target.id } : { clientId: target.id }) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { failed++; continue; }
        if (j.already) already++; else added++;
        setFiled(prev => new Set(prev).add(m.id));
      }
    } finally { setFilingAll(false); }
    p.notify(failed ? `Filed ${added + already} of ${msgs.length} to ${target.label} — ${failed} failed, try again`
      : added ? `Filed ${added} message${added === 1 ? '' : 's'} to ${target.label}${already ? ` (${already} already there)` : ''}`
      : `All ${msgs.length} already on ${target.label}`);
  };
  // Save to Docs: put this attachment on the deal's Docs tab (the only place outgoing email can attach files from).
  const saveToDeal = async (m: LiveMessage, a: { part: string; name: string }, deal: NonNullable<ContactMatch>) => {
    const key = `${m.id}:${a.part}`;
    setBusy(key);
    try {
      const r = await fetch('/api/gmail/save-attachment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'gmail', messageId: m.id, part: a.part, dealId: deal.id, account: p.account ?? undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { p.notify(j.error ?? 'Could not save the file.'); return; }
      setSavedAtt(prev => new Set(prev).add(key));
      p.notify(j.duplicate ? `Already in ${deal.label}’s Docs` : `Saved to ${deal.label}’s Docs`);
    } finally { setBusy(null); }
  };
  const addContact = async (m: LiveMessage, email: string, name: string) => {
    setWorking(m.id);
    try { await p.onAddContact(email, name); } finally { setWorking(null); }
  };

  // Gmail's shortcuts: r reply · a reply all · f forward · Esc back (ignored while typing or when a modifier is held).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const last = msgs && msgs.length ? msgs[msgs.length - 1] : null;
      if (e.key === 'Escape') { p.onBack(); return; }
      if (!last) return;
      if (e.key === 'r') { e.preventDefault(); p.onReply(last, p.t.id, false, p.account); }
      else if (e.key === 'a') { e.preventDefault(); p.onReply(last, p.t.id, true, p.account); }
      else if (e.key === 'f') { e.preventDefault(); p.onForward(last, p.t.id, p.account); }
      else if (p.canModify && e.key === 'e' && p.box === 'inbox') { e.preventDefault(); p.onAct('archive'); }
      else if (p.canModify && (e.key === '#' || e.key === 'Delete')) { e.preventDefault(); p.onAct('trash'); }
      else if (p.canModify && e.key === 's') { e.preventDefault(); p.onAct(p.t.starred ? 'unstar' : 'star'); }
      else if (p.canModify && e.key === 'U') { e.preventDefault(); p.onAct('unread'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [msgs, p]);

  const btn: React.CSSProperties = {
    minHeight: p.isMobile ? 40 : 32, padding: '0 14px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  };
  const last = msgs && msgs.length ? msgs[msgs.length - 1] : null;
  const me = (p.self ?? p.account ?? '').toLowerCase();
  const toSummary = (m: LiveMessage) => {
    const list = (m.to || '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s => parseAddr(s)).filter(a => a.email);
    const names = list.map(a => (a.email.toLowerCase() === me ? 'me' : (a.name || a.email)));
    const cc = addrCount(m.cc);
    return `to ${names.slice(0, 2).join(', ') || '—'}${names.length > 2 ? ` +${names.length - 2}` : ''}${cc ? ` · cc ${cc}` : ''}`;
  };

  // ⏰ Remind me: a real CRM follow-up task (shows on Tasks and your dashboard), linked to the contact/deal when we know them.
  const remind = async (due: string) => {
    setRemindOpen(false);
    try {
      const uid = (await supabase.auth.getSession()).data.session?.user?.id;
      const l = msgs && msgs.length ? msgs[msgs.length - 1] : null;
      const other = l ? (me && parseAddr(l.from).email.toLowerCase() === me ? parseAddr(l.to) : parseAddr(l.from)) : { name: '', email: '' };
      const who = threadTarget?.label ?? (other.name || other.email || 'this email');
      const r = await fetch('/api/crm/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        title: `Follow up: ${p.t.subject}`.slice(0, 140),
        description: `Email conversation with ${who}${l ? ` — last message ${whenLong(l.date)}` : ''}. Find it in Emails by searching “${p.t.subject.slice(0, 60)}”.`,
        due_date: due, type: 'follow_up', priority: 'normal', assigned_to: uid || undefined,
        ...(threadTarget ? (threadTarget.kind === 'deal' ? { deal_id: threadTarget.id } : { client_id: threadTarget.id }) : {}),
      }) });
      if (!r.ok) { p.notify('Could not set the reminder — try again.'); return; }
      p.notify(`Reminder set for ${ymdLabel(due)} — it’s on your Tasks`);
    } catch { p.notify('Could not set the reminder — try again.'); }
  };

  // Who this conversation is with: the first outside party we know (a deal wins over a contact card).
  const threadTarget: NonNullable<ContactMatch> | null = (() => {
    let found: NonNullable<ContactMatch> | null = null;
    for (const m of msgs ?? []) {
      const f = parseAddr(m.from);
      const o = me && f.email.toLowerCase() === me ? parseAddr(m.to) : f;
      const hit = o.email ? p.contactFor(o.email) : null;
      if (hit && (!found || (hit.kind === 'deal' && found.kind !== 'deal'))) found = hit;
    }
    return found;
  })();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {!p.embedded && <button type="button" onClick={p.onBack} title="Back to the list (Esc)" style={btn}>← Back</button>}
        <h2 style={{ margin: 0, flex: '1 1 240px', minWidth: 0, fontSize: p.isMobile ? 18 : 21, fontWeight: 700, color: 'var(--k-111)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
          {p.t.subject}
          {msgs && msgs.length > 1 && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--k-9ca3af)', whiteSpace: 'nowrap' }}>{msgs.length} messages</span>}
        </h2>
        {last && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            <a href={`https://mail.google.com/mail/${p.account ? `?authuser=${encodeURIComponent(p.account)}` : ''}#all/${p.t.id}`} target="_blank" rel="noopener noreferrer" title="Open this conversation in Gmail (labels, trash…)"
              style={{ ...btn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Gmail ↗</a>
            <button type="button" style={btn} onClick={() => p.onReply(last, p.t.id, false, p.account)} title="Reply (r)">↩ Reply</button>
            <button type="button" style={btn} onClick={() => p.onReply(last, p.t.id, true, p.account)} title="Reply all (a)">↩↩ All</button>
            <button type="button" style={btn} onClick={() => p.onForward(last, p.t.id, p.account)} title="Forward (f)">↪</button>
            <div style={{ position: 'relative' }}>
              <button type="button" style={btn} onClick={() => setRemindOpen(v => !v)} aria-haspopup="menu" aria-expanded={remindOpen} title="Create a follow-up task for this conversation">⏰ Remind me</button>
              {remindOpen && (
                <>
                  <div onClick={() => setRemindOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 29 }} />
                  <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 30, minWidth: 220, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.14)', overflow: 'hidden' }}>
                    <div style={{ padding: '7px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', background: 'var(--k-fafafa)' }}>Follow up on…</div>
                    {([['Tomorrow', ymdPlus(1)], ['In 3 days', ymdPlus(3)], ['Next Monday', ymdNextMonday()], ['In 2 weeks', ymdPlus(14)]] as Array<[string, string]>).map(([label, ymd]) => (
                      <button key={label} role="menuitem" type="button" onClick={() => void remind(ymd)}
                        style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 12, padding: '9px 12px', border: 'none', borderTop: '1px solid var(--k-f0f0f0)', background: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--k-111)', fontFamily: "'DM Sans',sans-serif", textAlign: 'left' }}>
                        <span style={{ fontWeight: 600 }}>{label}</span><span style={{ color: 'var(--k-9ca3af)' }}>{ymdLabel(ymd)}</span>
                      </button>
                    ))}
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', borderTop: '1px solid var(--k-f0f0f0)', fontSize: 13.5, fontWeight: 600, color: 'var(--k-111)' }}>
                      Pick a date
                      <input type="date" min={ymdPlus(1)} onChange={e => { if (e.target.value) void remind(e.target.value); }} style={{ fontSize: 13, border: '1px solid var(--k-e5e7eb)', borderRadius: 6, padding: '3px 6px', background: 'var(--k-fff)', color: 'var(--k-111)' }} />
                    </label>
                  </div>
                </>
              )}
            </div>
            {p.canModify && (
              <div role="group" aria-label="Change this conversation" style={{ display: 'inline-flex', gap: 4 }}>
                {p.box === 'inbox' && <button type="button" style={{ ...btn, padding: '0 10px' }} onClick={() => p.onAct('archive')} title="Archive (e)" aria-label="Archive"><Ic n="archive" /></button>}
                <button type="button" style={{ ...btn, padding: '0 10px' }} onClick={() => p.onAct('unread')} title="Mark unread (Shift+U)" aria-label="Mark unread"><Ic n="mail" /></button>
                <button type="button" style={{ ...btn, padding: '0 10px', color: p.t.starred ? '#c9922c' : undefined }} onClick={() => p.onAct(p.t.starred ? 'unstar' : 'star')} title={p.t.starred ? 'Remove star (s)' : 'Star (s)'} aria-label={p.t.starred ? 'Remove star' : 'Star'}><Ic n="star" fill={p.t.starred} /></button>
                <LabelMenu labels={p.labels} current={new Set(p.t.labels ?? [])} onToggle={p.onLabel} onCreate={p.onCreateLabel} buttonStyle={{ ...btn, padding: '0 10px', display: 'inline-flex', alignItems: 'center' }} />
                <button type="button" style={{ ...btn, padding: '0 10px' }} onClick={() => p.onAct('trash')} title="Move to Trash (#)" aria-label="Move to Trash"><Ic n="trash" /></button>
              </div>
            )}
          </div>
        )}
      </div>
      {threadTarget && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12, padding: '9px 12px', background: 'var(--k-fffbeb)', border: '1px solid var(--k-fde68a)', borderRadius: 10 }}>
          <button type="button" onClick={() => (threadTarget.kind === 'deal' ? p.onOpenDeal(threadTarget.id) : p.onOpenContact(threadTarget.id))}
            style={{ flex: '1 1 200px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: 'var(--k-92400e)', fontWeight: 700, fontFamily: "'DM Sans',sans-serif", overflowWrap: 'anywhere' }}>
            {threadTarget.kind === 'deal' ? '💼' : '👤'} {threadTarget.label}{threadTarget.sub ? <span style={{ fontWeight: 500 }}> · {threadTarget.sub}</span> : null} →
          </button>
          {(threadTarget.phone || threadTarget.company || threadTarget.role || threadTarget.touched || (threadTarget.tags && threadTarget.tags.length > 0)) && (
            <div style={{ flexBasis: '100%', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: 'var(--k-92400e)' }}>
              {threadTarget.phone && <a href={`tel:${threadTarget.phone.replace(/[^\d+]/g, '')}`} style={{ color: 'inherit', fontWeight: 700, textDecoration: 'none' }}>📞 {threadTarget.phone}</a>}
              {threadTarget.company && <span>🏢 {threadTarget.company}</span>}
              {threadTarget.role && <span>{threadTarget.role}</span>}
              {threadTarget.touched && <span>Last contact {ago(threadTarget.touched)}</span>}
              {(threadTarget.tags ?? []).map(tg => <span key={tg} style={{ background: 'rgba(146,64,14,.1)', borderRadius: 10, padding: '0 8px', fontWeight: 600 }}>{tg}</span>)}
            </div>
          )}
          {msgs && msgs.length > 1 && (
            <button type="button" disabled={filingAll || (msgs.length > 0 && msgs.every(m => filed.has(m.id)))} onClick={() => void fileAll(threadTarget)} style={btn}
              title="Copy every message in this conversation onto the card so the team sees the whole thread">
              {filingAll ? 'Filing…' : msgs.every(m => filed.has(m.id)) ? '✓ All filed' : `📁 File all ${msgs.length}`}
            </button>
          )}
        </div>
      )}
      {last && me && parseAddr(last.from).email.toLowerCase() === me && ageDays(last.date) >= 3 && !parseAddr(last.to).email.toLowerCase().includes(me) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12, padding: '9px 12px', background: 'var(--k-fdf6e8)', border: '1px solid var(--k-fde68a)', borderRadius: 10 }}>
          <span style={{ flex: '1 1 220px', minWidth: 0, fontSize: 13, color: 'var(--k-92400e)', fontWeight: 600 }}>⏳ No reply yet — you sent the last message {ageDays(last.date)} days ago.</span>
          <button type="button" style={{ ...btn, background: '#c9922c', color: '#fff', border: 'none' }} onClick={() => p.onReply(last, p.t.id, false, p.account)}>↩ Follow up</button>
        </div>
      )}
      {msgs === null && <div style={{ color: 'var(--k-9ca3af)', fontSize: 14, padding: 24 }}>Opening conversation…</div>}
      {err && <div style={{ color: 'var(--k-dc2626)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(msgs ?? []).map(m => {
          const from = parseAddr(m.from);
          const name = from.name || from.email;
          const mine = !!me && from.email.toLowerCase() === me;
          const isFolded = folded.has(m.id);
          const match = from.email ? p.contactFor(from.email) : null;
          if (isFolded) {
            return (
              <div key={m.id} role="button" tabIndex={0} onClick={() => setFolded(prev => { const n = new Set(prev); n.delete(m.id); return n; })}
                style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, cursor: 'pointer' }}>
                <Avatar name={name} email={from.email} size={26} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-111)', flexShrink: 0 }}>{mine ? 'Me' : name}</span>
                <span style={{ fontSize: 13, color: 'var(--k-9ca3af)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.text.replace(/\s+/g, ' ').slice(0, 140)}</span>
                {m.attachments.length > 0 && <span aria-label="Has attachments" style={{ fontSize: 12 }}>📎</span>}
                <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }}>{when(m.date)}</span>
              </div>
            );
          }
          const showDetails = details.has(m.id);
          const other = mine ? parseAddr(m.to) : from;
          const target = other.email ? p.contactFor(other.email) : null;
          return (
            <div key={m.id} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, padding: p.isMobile ? '12px' : '16px 18px' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
                <Avatar name={name} email={from.email} size={40} warm={!!match} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div onClick={() => setFolded(prev => new Set(prev).add(m.id))} title="Fold this message" style={{ cursor: 'pointer' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-111)' }}>{mine ? 'Me' : name}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--k-9ca3af)', marginLeft: p.isMobile ? 0 : 7, display: p.isMobile ? 'block' : 'inline', wordBreak: 'break-all' }}>&lt;{from.email}&gt;</span>
                  </div>
                  <button type="button" onClick={() => setDetails(prev => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} aria-expanded={showDetails}
                    style={{ background: 'none', border: 'none', padding: 0, marginTop: 2, cursor: 'pointer', fontSize: 12.5, color: 'var(--k-6b7280)', fontFamily: "'DM Sans',sans-serif", textAlign: 'left' }}>
                    {toSummary(m)} <span style={{ fontSize: 10 }}>{showDetails ? '▴' : '▾'}</span>
                  </button>
                  {showDetails && (
                    <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--k-f9fafb)', border: '1px solid var(--k-eef0f2)', borderRadius: 8, fontSize: 12.5, color: 'var(--k-374151)', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', overflowWrap: 'anywhere' }}>
                      <span style={{ color: 'var(--k-9ca3af)' }}>From</span><span>{m.from}</span>
                      <span style={{ color: 'var(--k-9ca3af)' }}>To</span><span>{m.to || '—'}</span>
                      {m.cc && <><span style={{ color: 'var(--k-9ca3af)' }}>Cc</span><span>{m.cc}</span></>}
                      <span style={{ color: 'var(--k-9ca3af)' }}>Date</span><span>{whenLong(m.date)}</span>
                    </div>
                  )}
                  {match && (
                    <button type="button" onClick={() => (match.kind === 'deal' ? p.onOpenDeal(match.id) : p.onOpenContact(match.id))}
                      style={{ marginTop: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--k-a06a12)', fontWeight: 700, fontFamily: "'DM Sans',sans-serif", display: 'block' }}>
                      {match.kind === 'deal' ? '💼 Deal' : '👤 Contact'} · {match.label} →
                    </button>
                  )}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--k-9ca3af)' }} title={whenLong(m.date)}>{p.isMobile ? when(m.date) : whenLong(m.date)}</span>
                  {opens.has(m.id) && (opens.get(m.id)!.opened
                    ? <span title={opens.get(m.id)!.last ? `Last opened ${whenLong(new Date(opens.get(m.id)!.last!).getTime())}` : 'Opened'} style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--k-065f46)', background: 'var(--k-d1fae5)', borderRadius: 10, padding: '1px 8px' }}>👁 Opened{opens.get(m.id)!.n > 1 ? ` ${opens.get(m.id)!.n}×` : ''}{opens.get(m.id)!.last ? ` · ${when(new Date(opens.get(m.id)!.last!).getTime())}` : ''}</span>
                    : <span style={{ fontSize: 11.5, color: 'var(--k-9ca3af)', background: 'var(--k-f3f4f6)', borderRadius: 10, padding: '1px 8px' }}>Not opened</span>)}
                </div>
              </div>
              <MessageFrame html={m.html} />
              {m.attachments.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--k-9ca3af)', marginBottom: 6 }}>{m.attachments.length} attachment{m.attachments.length === 1 ? '' : 's'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {m.attachments.map(a => {
                      const key = `${m.id}:${a.part}`;
                      return (
                        <div key={a.part} style={{ display: 'inline-flex', alignItems: 'stretch', maxWidth: '100%', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, background: 'var(--k-f9fafb)', overflow: 'hidden' }}>
                          <button type="button" onClick={() => void openAtt(m, a)} disabled={busy === key} title={previewable(a.mime) ? `Open ${a.name}` : `Download ${a.name}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: p.isMobile ? 44 : 34, padding: '0 11px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif", minWidth: 0 }}>
                            <span aria-hidden>{busy === key ? '⏳' : /pdf/i.test(a.mime) ? '📕' : /^image\//i.test(a.mime) ? '🖼️' : /sheet|excel|csv/i.test(a.mime) ? '📊' : /word|document/i.test(a.mime) ? '📃' : '📎'}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, fontWeight: 600 }}>{a.name}</span>
                            <span style={{ color: 'var(--k-9ca3af)', flexShrink: 0 }}>{fmtBytes(a.size)}</span>
                          </button>
                          {target?.kind === 'deal' && /\.(pdf|docx?|jpe?g|png|webp)$/i.test(a.name) && (
                            <button type="button" disabled={busy === key || savedAtt.has(key)} onClick={() => void saveToDeal(m, a, target)} aria-label={`Save ${a.name} to ${target.label}’s Docs`} title={`Save to ${target.label}’s Docs`}
                              style={{ minWidth: p.isMobile ? 44 : 34, padding: '0 9px', border: 'none', borderLeft: '1px solid var(--k-e5e7eb)', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: savedAtt.has(key) ? 'var(--k-065f46)' : 'var(--k-a06a12)', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>{savedAtt.has(key) ? '✓ Saved' : '📁 Docs'}</button>
                          )}
                          {previewable(a.mime) && (
                            <button type="button" onClick={() => void openAtt(m, a, true)} aria-label={`Download ${a.name}`} title="Download"
                              style={{ width: p.isMobile ? 44 : 34, border: 'none', borderLeft: '1px solid var(--k-e5e7eb)', background: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--k-6b7280)' }}>⬇</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button type="button" style={btn} onClick={() => p.onReply(m, p.t.id, false, p.account)}>↩ Reply</button>
                <button type="button" style={btn} onClick={() => p.onReply(m, p.t.id, true, p.account)}>↩↩ Reply all</button>
                <button type="button" style={btn} onClick={() => p.onForward(m, p.t.id, p.account)}>↪ Forward</button>
                {other.email && (target ? (
                  <button type="button" disabled={working === m.id || filed.has(m.id)} style={{ ...btn, marginLeft: p.isMobile ? 0 : 'auto' }} onClick={() => void fileTo(m, target)}
                    title="Copy this message onto the card so the team sees it there">{filed.has(m.id) ? '✓ Filed' : working === m.id ? 'Filing…' : `📁 File to ${target.label.length > 22 ? target.label.slice(0, 21) + '…' : target.label}`}</button>
                ) : (
                  <button type="button" disabled={working === m.id} style={{ ...btn, marginLeft: p.isMobile ? 0 : 'auto' }} onClick={() => void addContact(m, other.email, other.name)}
                    title="Create a CRM contact for this address, then you can file the email on it">{working === m.id ? 'Adding…' : '＋ Add contact'}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
