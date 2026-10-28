'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveMessage, ThreadSummary } from '@/lib/gmail-live';
import { sanitizeHtml } from '@/lib/sanitize';

// Your real Gmail inside the CRM: the Inbox or Sent folder read live from Gmail (nothing is copied), a reader for whole
// conversations, and Reply / Reply all / Forward that open the CRM's Compose window — so the mail you send is still
// logged and tracked here. Read state is Gmail's own unread flag; opening a conversation here only dims it locally
// (marking it read IN Gmail needs a one-time wider Google permission, which we haven't asked for yet).

const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const when = (ms: number) => {
  const d = new Date(ms), now = new Date();
  if (d.toLocaleDateString('en-US', CT) === now.toLocaleDateString('en-US', CT)) return d.toLocaleTimeString('en-US', { ...CT, hour: 'numeric', minute: '2-digit' });
  const sameYear = d.toLocaleDateString('en-US', { ...CT, year: 'numeric' }) === now.toLocaleDateString('en-US', { ...CT, year: 'numeric' });
  return d.toLocaleDateString('en-US', { ...CT, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};
const whenLong = (ms: number) => new Date(ms).toLocaleString('en-US', { ...CT, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const parseAddr = (raw: string | null | undefined) => {
  const first = (raw ?? '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0]?.trim() ?? '';
  const m = first.match(/^"?(.*?)"?\s*<([^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: first };
};
const initials = (s: string) => s.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '✉';
const fmtBytes = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const OPENED_KEY = 'crm-gmail-opened';
const loadOpened = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(OPENED_KEY) ?? '[]') as string[]); } catch { return new Set(); } };

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

// A sandboxed frame for the message HTML: no scripts can run, links open in new tabs, and it grows to fit its content.
function MessageFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(120);
  const fit = useCallback(() => {
    const d = ref.current?.contentDocument;
    if (d?.body) setH(Math.min(20000, Math.max(60, d.documentElement.scrollHeight)));
  }, []);
  // No scripts or event handlers survive; links open in a new tab, never inside the frame.
  const safe = sanitizeHtml(html).replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ');
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#222;font:14px/1.55 Arial,Helvetica,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex;color:#555}a{color:#1a56c4}</style></head><body>${safe}</body></html>`;
  return <iframe ref={ref} title="Message" srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" onLoad={() => { fit(); setTimeout(fit, 400); setTimeout(fit, 1500); }}
    style={{ width: '100%', height: h, border: 'none', display: 'block', background: '#fff', borderRadius: 6 }} />;
}

export default function GmailMailbox(p: Props) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
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
  useEffect(() => { setOpened(loadOpened()); }, []);

  const build = useCallback((pageToken?: string) => {
    const sp = new URLSearchParams({ box: p.box });
    if (filter === 'unread') sp.set('filter', 'unread');
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
    if (open) return;
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
  }, [build, open]);

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
  const openThread = (t: ThreadSummary) => {
    setOpenThread(t);
    setOpened(prev => { const n = new Set(prev); n.add(keyOf(t)); try { localStorage.setItem(OPENED_KEY, JSON.stringify([...n].slice(-3000))); } catch { /* ignore */ } return n; });
  };

  const chip = (on: boolean): React.CSSProperties => ({
    padding: p.isMobile ? '8px 14px' : '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? '#111' : 'var(--k-e5e7eb)'}`, background: on ? '#111' : 'var(--k-fff)', color: on ? '#fff' : 'var(--k-374151)',
    fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  });

  if (open) {
    return <ThreadReader t={open} account={account} isMobile={p.isMobile} contactFor={p.contactFor} onOpenDeal={p.onOpenDeal} onOpenContact={p.onOpenContact}
      onReply={p.onReply} onForward={p.onForward} notify={p.notify} onAddContact={p.onAddContact} onBack={() => setOpenThread(null)} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="crm-tabs-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
          {(p.box === 'inbox' ? [['all', 'All inbox'], ['unread', 'Unread']] : [['all', 'All sent'], ['unread', 'Unread']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v as typeof filter)} style={chip((p.box === 'sent' && v === 'all' ? filter !== 'unread' : filter === v))}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: p.isMobile ? 0 : 'auto', flexWrap: 'wrap', width: p.isMobile ? '100%' : undefined }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search mail (from:, has:attachment…)" aria-label="Search Gmail"
            style={{ flex: p.isMobile ? '1 1 0' : '0 1 280px', minWidth: 0, height: p.isMobile ? 42 : 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 14 }} />
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

      {fresh > 0 && (
        <button type="button" onClick={() => void load()}
          style={{ width: '100%', marginBottom: 10, padding: '10px', border: '1px solid var(--k-fde68a)', background: 'var(--k-fdf6e8)', color: 'var(--k-92400e)', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
          ↑ {fresh} new {fresh === 1 ? 'conversation' : 'conversations'} — show
        </button>
      )}
      {threads === null ? <div style={{ color: 'var(--k-9ca3af)', fontSize: 14, padding: 24 }}>Loading your Gmail…</div>
      : !connected ? <Empty title="Gmail isn’t connected" sub="Connect your Google account (bottom of the sidebar) and your mail shows up here." />
      : err ? <Empty title="Couldn’t load your mail" sub={err} />
      : threads.length === 0 ? <Empty title={term ? 'Nothing matches' : p.box === 'inbox' ? 'You’re all caught up' : 'Nothing here yet'} sub={term ? 'Try different words.' : 'Nothing to show.'} />
      : (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
          {threads.map((t, i) => {
            const a = parseAddr(p.box === 'sent' ? t.to : t.from);
            const name = a.name || a.email || '(unknown)';
            const unread = isUnread(t);
            const match = a.email ? p.contactFor(a.email) : null;
            return (
              <div key={t.id} role="button" tabIndex={0} onClick={() => openThread(t)} onKeyDown={e => { if (e.key === 'Enter') openThread(t); }}
                style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '11px 14px', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none', cursor: 'pointer', background: unread ? 'var(--k-fffdf7)' : 'var(--k-fff)' }}>
                <div aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', background: match ? '#c9922c' : '#475569' }}>{initials(name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 14, fontWeight: unread ? 800 : 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                      {p.box === 'sent' ? <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}>To: </span> : null}{name}
                      {t.count > 1 && <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> {t.count}</span>}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }} title={whenLong(t.date)}>{when(t.date)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--k-374151)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b style={{ fontWeight: unread ? 800 : 600 }}>{t.subject}</b>
                    <span style={{ color: 'var(--k-9ca3af)' }}> — {t.snippet.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')}</span>
                  </div>
                  {match && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--k-a06a12)', fontWeight: 600 }}>{match.kind === 'deal' ? 'Deal' : 'Contact'} · {match.label}</div>}
                </div>
              </div>
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
  t: ThreadSummary; account: string | null; isMobile: boolean; contactFor: (email: string) => ContactMatch;
  onOpenDeal: (id: string) => void; onOpenContact: (id: string) => void;
  onReply: Props['onReply']; onForward: Props['onForward']; onBack: () => void;
  notify: Props['notify']; onAddContact: Props['onAddContact'];
}) {
  const [msgs, setMsgs] = useState<LiveMessage[] | null>(null);
  const [err, setErr] = useState('');
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [filed, setFiled] = useState<Set<string>>(() => new Set());

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

  const download = async (m: LiveMessage, a: { part: string; name: string; mime: string }) => {
    setBusy(`${m.id}:${a.part}`);
    try {
      const r = await fetch(`/api/gmail/mailbox-attachment?messageId=${m.id}&part=${encodeURIComponent(a.part)}${p.account ? `&account=${encodeURIComponent(p.account)}` : ''}`);
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(new Blob([await r.blob()], { type: a.mime }));
      const link = document.createElement('a'); link.href = url; link.download = a.name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { setErr(`Couldn’t download ${a.name} — try again.`); }
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
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
  };

  return (
    <div>
      <button type="button" onClick={p.onBack} title="Back to the list (Esc)" style={{ ...btn, marginBottom: 12 }}>← Back</button>
      <h2 style={{ margin: '0 0 14px', fontSize: p.isMobile ? 18 : 20, fontWeight: 700, color: 'var(--k-111)', lineHeight: 1.3 }}>{p.t.subject}</h2>
      {msgs === null && <div style={{ color: 'var(--k-9ca3af)', fontSize: 14, padding: 24 }}>Opening conversation…</div>}
      {err && <div style={{ color: 'var(--k-dc2626)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(msgs ?? []).map(m => {
          const from = parseAddr(m.from);
          const name = from.name || from.email;
          const isFolded = folded.has(m.id);
          const match = from.email ? p.contactFor(from.email) : null;
          if (isFolded) {
            return (
              <div key={m.id} role="button" tabIndex={0} onClick={() => setFolded(prev => { const n = new Set(prev); n.delete(m.id); return n; })}
                style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, cursor: 'pointer' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-111)', flexShrink: 0 }}>{name}</span>
                <span style={{ fontSize: 13, color: 'var(--k-9ca3af)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.text.replace(/\s+/g, ' ').slice(0, 120)}</span>
                <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }}>{when(m.date)}</span>
              </div>
            );
          }
          return (
            <div key={m.id} style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, padding: p.isMobile ? '12px' : '14px 16px' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                <div aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', background: match ? '#c9922c' : '#475569' }}>{initials(name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div onClick={() => setFolded(prev => new Set(prev).add(m.id))} title="Fold this message" style={{ cursor: 'pointer' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--k-111)' }}>{name}</span>
                    <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginLeft: p.isMobile ? 0 : 6, display: p.isMobile ? 'block' : 'inline', wordBreak: 'break-all' }}>&lt;{from.email}&gt;</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 2, overflowWrap: 'anywhere' }}>
                    to {m.to || '—'}{m.cc ? ` · cc ${m.cc}` : ''}
                  </div>
                  {p.isMobile && <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 2 }}>{whenLong(m.date)}</div>}
                  {match && (
                    <button type="button" onClick={() => (match.kind === 'deal' ? p.onOpenDeal(match.id) : p.onOpenContact(match.id))}
                      style={{ marginTop: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--k-a06a12)', fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>
                      {match.kind === 'deal' ? 'Deal' : 'Contact'} · {match.label} →
                    </button>
                  )}
                </div>
                {!p.isMobile && <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }} title={whenLong(m.date)}>{when(m.date)}</span>}
              </div>
              <MessageFrame html={m.html} />
              {m.attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {m.attachments.map(a => (
                    <button key={a.part} type="button" onClick={() => void download(m, a)} disabled={busy === `${m.id}:${a.part}`} title={`Download ${a.name}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minHeight: p.isMobile ? 44 : 32, padding: '0 12px', background: 'var(--k-f9fafb)', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif" }}>
                      <span aria-hidden>{busy === `${m.id}:${a.part}` ? '⏳' : '📎'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, fontWeight: 600 }}>{a.name}</span>
                      <span style={{ color: 'var(--k-9ca3af)', flexShrink: 0 }}>{fmtBytes(a.size)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button type="button" style={btn} onClick={() => p.onReply(m, p.t.id, false, p.account)}>↩ Reply</button>
                <button type="button" style={btn} onClick={() => p.onReply(m, p.t.id, true, p.account)}>↩↩ Reply all</button>
                <button type="button" style={btn} onClick={() => p.onForward(m, p.t.id, p.account)}>↪ Forward</button>
                {(() => {
                  const mine = !!p.account && from.email.toLowerCase() === p.account.toLowerCase();
                  const other = mine ? parseAddr(m.to) : from;
                  const target = other.email ? p.contactFor(other.email) : null;
                  if (!other.email) return null;
                  if (target) return (
                    <button type="button" disabled={working === m.id || filed.has(m.id)} style={{ ...btn, marginLeft: p.isMobile ? 0 : 'auto' }} onClick={() => void fileTo(m, target)}
                      title="Copy this message onto the card so the team sees it there">{filed.has(m.id) ? '✓ Filed' : working === m.id ? 'Filing…' : `📁 File to ${target.label.length > 22 ? target.label.slice(0, 21) + '…' : target.label}`}</button>
                  );
                  return (
                    <button type="button" disabled={working === m.id} style={{ ...btn, marginLeft: p.isMobile ? 0 : 'auto' }} onClick={() => void addContact(m, other.email, other.name)}
                      title="Create a CRM contact for this address, then you can file the email on it">{working === m.id ? 'Adding…' : '＋ Add contact'}</button>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
