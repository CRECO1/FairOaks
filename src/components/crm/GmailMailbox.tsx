'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveMessage, ThreadSummary } from '@/lib/gmail-live';
import { sanitizeHtml } from '@/lib/sanitize';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
// CRM open tracking for emails sent from the CRM: per Gmail thread / message, so the live views can show "👁 Opened 3×".
type Track = { tracked: boolean; opens: number; opened: boolean };

// Your real Gmail inside the CRM. On a wide screen it is a two-pane inbox (list on the left, the conversation on the
// right, so you never lose your place); on a phone the list and the conversation are separate screens. Mail is read live
// from Gmail — nothing is copied — and Reply / Reply all / Forward open the CRM's Compose window, so what you send is
// still logged and tracked here. Opening a conversation only dims it locally (marking it read IN Gmail needs a wider
// Google permission we haven't asked for).

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
const previewable = (mime: string) => /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i.test(mime);

export type ContactMatch = { kind: 'deal' | 'contact'; id: string; label: string } | null;

type Props = {
  box: 'inbox' | 'sent';
  isMobile: boolean;
  contactFor: (email: string) => ContactMatch;
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

// A sandboxed frame for the message HTML: no scripts can run, links open in new tabs, and it grows to fit its content.
function MessageFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(120);
  const fit = useCallback(() => {
    const d = ref.current?.contentDocument;
    if (d?.documentElement) setH(Math.min(30000, Math.max(40, d.documentElement.scrollHeight)));
  }, []);
  // No scripts or event handlers survive; links open in a new tab, never inside the frame.
  const safe = useMemo(() => collapseQuotes(sanitizeHtml(html).replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ')), [html]);
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

export default function GmailMailbox(p: Props) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'files'>('all');
  const [contactsOnly, setContactsOnly] = useState(false);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [account, setAccount] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [open, setOpenThread] = useState<ThreadSummary | null>(null);
  const [wide, setWide] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setOpened(loadOpened()); }, []);
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
    if (pageToken) sp.set('pageToken', pageToken);
    return `/api/gmail/mailbox?${sp}`;
  }, [p.box, filter, term, account]);

  const load = useCallback(async () => {
    setThreads(null); setErr('');
    try {
      const r = await fetch(build());
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? 'Could not load your mail.'); setThreads([]); return; }
      setConnected(j.connected !== false); setAccounts(j.accounts ?? []); if (!account && j.account) setAccount(j.account);
      setThreads(j.threads ?? []); setNext(j.next ?? null);
    } catch { setErr('Could not reach Gmail — check your connection.'); setThreads([]); }
  }, [build, account]);

  useEffect(() => { setOpenThread(null); }, [p.box]);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { void load(); }, [load]);

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
    setOpened(prev => { const n = new Set(prev); n.add(keyOf(t)); try { localStorage.setItem(OPENED_KEY, JSON.stringify([...n].slice(-3000))); } catch { /* ignore */ } return n; });
  };

  const visible = useMemo(() => {
    const list = threads ?? [];
    return contactsOnly ? list.filter(t => { const a = otherOf(t); return a.email && p.contactFor(a.email); }) : list;
  }, [threads, contactsOnly, otherOf, p]);

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

  const chip = (on: boolean): React.CSSProperties => ({
    padding: p.isMobile ? '8px 14px' : '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? '#111' : 'var(--k-e5e7eb)'}`, background: on ? '#111' : 'var(--k-fff)', color: on ? '#fff' : 'var(--k-374151)',
    fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  });

  const reader = (embedded: boolean) => open && (
    <ThreadReader key={open.id} t={open} account={account} isMobile={p.isMobile} embedded={embedded} contactFor={p.contactFor} onOpenDeal={p.onOpenDeal} onOpenContact={p.onOpenContact}
      onReply={p.onReply} onForward={p.onForward} notify={p.notify} onAddContact={p.onAddContact} onBack={() => setOpenThread(null)} />
  );

  // Phone / narrow: the conversation replaces the list.
  if (open && !wide) return <div>{reader(false)}</div>;

  const toolbar = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <div className="crm-tabs-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
        <button onClick={() => setFilter('all')} style={chip(filter === 'all')}>{p.box === 'inbox' ? 'All inbox' : 'All sent'}</button>
        <button onClick={() => setFilter('unread')} style={chip(filter === 'unread')}>Unread</button>
        <button onClick={() => setFilter('files')} style={chip(filter === 'files')}>📎 Files</button>
        <button onClick={() => setContactsOnly(v => !v)} aria-pressed={contactsOnly} title="Only people who are in your CRM (of what is loaded)" style={chip(contactsOnly)}>👤 Contacts</button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: p.isMobile || wide ? 0 : 'auto', flexWrap: 'wrap', width: p.isMobile || wide ? '100%' : undefined }}>
        <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search mail (from:, to:, has:attachment…)  ·  press /" aria-label="Search Gmail"
          style={{ flex: p.isMobile || wide ? '1 1 0' : '0 1 300px', minWidth: 0, height: p.isMobile ? 42 : 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 14 }} />
        {accounts.length > 1 && (
          <select value={account ?? ''} onChange={e => setAccount(e.target.value)} aria-label="Gmail account"
            style={{ height: p.isMobile ? 42 : 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 8px' }}>
            {accounts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <button type="button" onClick={() => void load()} title="Refresh" aria-label="Refresh"
          style={{ height: p.isMobile ? 42 : 34, width: p.isMobile ? 42 : 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 15, cursor: 'pointer' }}>↻</button>
      </div>
    </div>
  );

  const list = (
    <>
      {fresh > 0 && (
        <button type="button" onClick={() => void load()}
          style={{ width: '100%', marginBottom: 10, padding: '10px', border: '1px solid var(--k-fde68a)', background: 'var(--k-fdf6e8)', color: 'var(--k-92400e)', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          ↑ {fresh} new {fresh === 1 ? 'conversation' : 'conversations'} — show
        </button>
      )}
      {threads === null ? <ListSkeleton />
      : !connected ? <Empty title="Gmail isn’t connected" sub="Connect your Google account (bottom of the sidebar) and your mail shows up here." />
      : err ? <Empty title="Couldn’t load your mail" sub={err} />
      : visible.length === 0 ? <Empty title={term || contactsOnly || filter !== 'all' ? 'Nothing matches' : p.box === 'inbox' ? 'You’re all caught up' : 'Nothing here yet'} sub={contactsOnly && threads.length ? 'None of the loaded conversations are with people in your CRM — try “Load older mail”.' : term ? 'Try different words.' : 'Nothing to show.'} />
      : (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
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
                <div role="button" tabIndex={0} onClick={() => openThread(t)} onKeyDown={e => { if (e.key === 'Enter') openThread(t); }}
                  style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '11px 14px', borderTop: !showHeader && i ? '1px solid var(--k-f0f0f0)' : 'none', cursor: 'pointer', borderLeft: `3px solid ${selected ? '#c9922c' : 'transparent'}`, background: selected ? 'var(--k-fef9f0)' : unread ? 'var(--k-fffdf7)' : 'var(--k-fff)' }}>
                  <Avatar name={name} email={a.email} warm={!!match} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 14, fontWeight: unread ? 800 : 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                        {unread && <span aria-label="Unread" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#c9922c', marginRight: 6, verticalAlign: 'middle' }} />}
                        {p.box === 'sent' ? <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}>To: </span> : null}{name}
                        {t.count > 1 && <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> {t.count}</span>}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }} title={whenLong(t.date)}>{when(t.date)}</span>
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--k-111)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: unread ? 700 : 500 }}>{t.subject}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--k-9ca3af)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decodeSnippet(t.snippet)}</div>
                    {(match || tracking.get(t.id)?.tracked) && (
                      <div style={{ marginTop: 4, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, fontWeight: 700 }}>
                        {match && <span style={{ color: 'var(--k-a06a12)' }}>{match.kind === 'deal' ? '💼 Deal' : '👤 Contact'} · {match.label}</span>}
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

  if (!wide) return <div>{toolbar}{list}</div>;

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
              <div style={{ fontSize: 12.5 }}>j / k to move · r reply · a reply all · f forward · / search</div>
            </div>
          )}
        </div>
      </div>
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
  t: ThreadSummary; account: string | null; isMobile: boolean; embedded: boolean; contactFor: (email: string) => ContactMatch;
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
    setMsgs(null); setErr('');
    fetch(`/api/gmail/thread?id=${p.t.id}${p.account ? `&account=${encodeURIComponent(p.account)}` : ''}`)
      .then(async r => { const j = await r.json().catch(() => ({})); if (!live) return; if (!r.ok) { setErr(j.error ?? 'Could not open this conversation.'); setMsgs([]); } else {
        const list: LiveMessage[] = j.messages ?? [];
        setMsgs(list);
        // Older messages fold like Gmail; the latest stays open.
        setFolded(new Set(list.slice(0, -1).map(m => m.id)));
      } })
      .catch(() => { if (live) { setErr('Could not reach Gmail.'); setMsgs([]); } });
    return () => { live = false; };
  }, [p.t.id, p.account]);

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [msgs, p]);

  const btn: React.CSSProperties = {
    minHeight: p.isMobile ? 40 : 32, padding: '0 14px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  };
  const last = msgs && msgs.length ? msgs[msgs.length - 1] : null;
  const me = (p.account ?? '').toLowerCase();
  const toSummary = (m: LiveMessage) => {
    const list = (m.to || '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s => parseAddr(s)).filter(a => a.email);
    const names = list.map(a => (a.email.toLowerCase() === me ? 'me' : (a.name || a.email)));
    const cc = addrCount(m.cc);
    return `to ${names.slice(0, 2).join(', ') || '—'}${names.length > 2 ? ` +${names.length - 2}` : ''}${cc ? ` · cc ${cc}` : ''}`;
  };

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
          </div>
        )}
      </div>
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
                    ? <span title={opens.get(m.id)!.last ? `Last opened ${whenLong(new Date(opens.get(m.id)!.last!).getTime())}` : 'Opened'} style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--k-065f46)', background: 'var(--k-d1fae5)', borderRadius: 10, padding: '1px 8px' }}>👁 Opened{opens.get(m.id)!.n > 1 ? ` ${opens.get(m.id)!.n}×` : ''}</span>
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
