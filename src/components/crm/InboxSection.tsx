'use client';

import React, { useMemo, useState } from 'react';
import { groupThreads, type InboxRow, type InboxThread } from '@/lib/use-inbox';

// Inbox: the replies that came in on your contacts and deals — newest conversation first, unread in bold. Opening a
// row takes you to that deal's / contact's email thread, where Reply, Reply all and Forward live.

const CT: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
const when = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toLocaleDateString('en-US', CT) === now.toLocaleDateString('en-US', CT)) return d.toLocaleTimeString('en-US', { ...CT, hour: 'numeric', minute: '2-digit' });
  const sameYear = d.toLocaleDateString('en-US', { ...CT, year: 'numeric' }) === now.toLocaleDateString('en-US', { ...CT, year: 'numeric' });
  return d.toLocaleDateString('en-US', { ...CT, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};
const whenLong = (iso: string) => new Date(iso).toLocaleString('en-US', { ...CT, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const firstAddr = (raw: string | null | undefined) => {
  const first = (raw ?? '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0]?.trim() ?? '';
  const m = first.match(/^"?(.*?)"?\s*<([^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: first };
};
const snippet = (body: string) => body.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').slice(0, 140);
const initials = (s: string) => s.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '✉';

type Props = {
  isMobile: boolean;
  rows: InboxRow[] | null;
  mine: (r: InboxRow) => boolean;
  isUnread: (r: InboxRow) => boolean;
  isDone: (r: InboxRow) => boolean;
  markRead: (ids: string[]) => void;
  markUnread: (ids: string[]) => void;
  setDoneIds: (ids: string[], on: boolean) => void;
  onReply: (r: InboxRow, all: boolean) => void;
  canReplyAll: (r: InboxRow) => boolean;
  markAllRead: (rows: InboxRow[]) => void;
  reload: () => void;
  nameFor: (email: string) => string | undefined;
  dealLabel: (id: string) => string | null;
  clientLabel: (id: string) => string | null;
  onOpenDeal: (id: string) => void;
  onOpenContact: (id: string) => void;
};

export default function InboxSection(p: Props) {
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [filter, setFilter] = useState<'all' | 'unread' | 'files' | 'done'>('all');
  const [q, setQ] = useState('');

  const threads = useMemo(() => {
    let rows = p.rows ?? [];
    if (scope === 'mine') rows = rows.filter(p.mine);
    const needle = q.trim().toLowerCase();
    if (needle) rows = rows.filter(r => `${r.from_email} ${r.subject} ${r.body ?? ''}`.toLowerCase().includes(needle));
    let list = groupThreads(rows, p.isUnread);
    // Done conversations are out of the way (Gmail's Archive) — until a NEW message arrives on them.
    list = filter === 'done' ? list.filter(t => t.rows.every(p.isDone)) : list.filter(t => !t.rows.every(p.isDone));
    if (filter === 'unread') list = list.filter(t => t.unread > 0);
    if (filter === 'files') list = list.filter(t => t.rows.some(r => r.attachments && r.attachments.length > 0));
    return list;
  }, [p.rows, p.mine, p.isUnread, p.isDone, scope, filter, q]);

  const unreadTotal = useMemo(() => threads.reduce((n, t) => n + t.unread, 0), [threads]);

  const open = (t: InboxThread) => {
    p.markRead(t.rows.map(r => r.id));
    const r = t.latest;
    if (r.deal_id && p.dealLabel(r.deal_id)) p.onOpenDeal(r.deal_id);
    else if (r.client_id) p.onOpenContact(r.client_id);
  };

  const chip = (on: boolean): React.CSSProperties => ({
    padding: p.isMobile ? '8px 14px' : '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? '#111' : 'var(--k-e5e7eb)'}`, background: on ? '#111' : 'var(--k-fff)', color: on ? '#fff' : 'var(--k-374151)',
    fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  });
  const act: React.CSSProperties = {
    minHeight: p.isMobile ? 38 : 28, padding: '0 11px', borderRadius: 7, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)',
    fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
  };
  const empty = (title: string, sub: string) => (
    <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--k-6b7280)', background: 'var(--k-fff)', border: '1px dashed var(--k-e5e7eb)', borderRadius: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-374151)' }}>{title}</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>{sub}</div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--k-6b7280)', marginBottom: 12 }}>Replies that came in on your contacts and deals — including people who were copied on the thread.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="crm-tabs-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
          {([['all', 'All'], ['unread', 'Unread'], ['files', '📎 With files'], ['done', '✓ Done']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={chip(filter === v)}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: p.isMobile ? 0 : 'auto', flexWrap: 'wrap', width: p.isMobile ? '100%' : undefined }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search sender, subject or text" aria-label="Search inbox"
            style={{ flex: p.isMobile ? '1 1 100%' : '0 1 240px', minWidth: 0, height: p.isMobile ? 42 : 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-111)', fontSize: 14 }} />
          <select value={scope} onChange={e => setScope(e.target.value as typeof scope)} aria-label="Whose inbox"
            style={{ height: p.isMobile ? 42 : 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13, padding: '0 8px', flex: p.isMobile ? 1 : undefined }}>
            <option value="mine">To me</option>
            <option value="team">Whole team</option>
          </select>
          <button type="button" disabled={!unreadTotal} onClick={() => p.markAllRead(threads.flatMap(t => t.rows))}
            style={{ height: p.isMobile ? 42 : 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: unreadTotal ? 'var(--k-374151)' : 'var(--k-9ca3af)', fontSize: 13, fontWeight: 600, cursor: unreadTotal ? 'pointer' : 'default', fontFamily: "'DM Sans',sans-serif" }}>
            ✓ Mark all read
          </button>
          <button type="button" onClick={p.reload} title="Check for new replies" aria-label="Refresh"
            style={{ height: p.isMobile ? 42 : 34, width: p.isMobile ? 42 : 34, borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 15, cursor: 'pointer' }}>↻</button>
        </div>
      </div>

      {p.rows === null ? <div style={{ color: 'var(--k-9ca3af)', fontSize: 14, padding: 24 }}>Loading your inbox…</div>
      : threads.length === 0 ? (p.rows.length ? empty(filter === 'unread' || filter === 'all' ? 'You’re all caught up' : 'Nothing matches', filter === 'unread' || filter === 'all' ? 'Nothing waiting for you here.' : 'Try another filter or search.') : empty('No replies yet', 'When a contact answers an email you sent from the CRM, it lands here (checked every 10 minutes).'))
      : (
        <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
          {threads.map((t, i) => {
            const r = t.latest;
            const a = firstAddr(r.from_email);
            const name = a.name || p.nameFor(a.email) || a.email;
            const unread = t.unread > 0;
            const files = t.rows.reduce((n, x) => n + (x.attachments?.length ?? 0), 0);
            const deal = r.deal_id ? p.dealLabel(r.deal_id) : null;
            const contact = !deal && r.client_id ? p.clientLabel(r.client_id) : null;
            const others = new Set(t.rows.map(x => firstAddr(x.from_email).email.toLowerCase())).size;
            return (
              <div key={t.key} role="button" tabIndex={0} onClick={() => open(t)} onKeyDown={e => { if (e.key === 'Enter') open(t); }}
                style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderTop: i ? '1px solid var(--k-f0f0f0)' : 'none', cursor: 'pointer', background: unread ? 'var(--k-fffdf7)' : 'var(--k-fff)' }}>
                <div aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', background: unread ? '#c9922c' : '#475569' }}>{initials(name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 14, fontWeight: unread ? 800 : 600, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                      {name}
                      {t.rows.length > 1 && <span style={{ fontWeight: 500, color: 'var(--k-9ca3af)' }}> {t.rows.length}</span>}
                      {others > 1 && <span title="More than one person has written on this thread" style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: 'var(--k-eef2ff)', color: 'var(--k-3730a3)' }}>👥 {others}</span>}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }} title={whenLong(r.created_at)}>{when(r.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--k-374151)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: unread ? 600 : 400 }}>
                    <b style={{ fontWeight: unread ? 800 : 600 }}>{r.subject || '(no subject)'}</b>
                    {r.body && <span style={{ color: 'var(--k-9ca3af)', fontWeight: 400 }}> — {snippet(r.body)}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 5, flexWrap: 'wrap', fontSize: 12 }}>
                    {unread && <span style={{ fontWeight: 700, color: 'var(--k-a06a12)' }}>● {t.unread} new</span>}
                    {files > 0 && <span style={{ color: 'var(--k-6b7280)' }}>📎 {files === 1 ? '1 file' : `${files} files`}</span>}
                    {(deal || contact) && <span style={{ color: 'var(--k-a06a12)', fontWeight: 600 }}>{deal ? `Deal · ${deal}` : `Contact · ${contact}`} →</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                    {!t.rows.every(p.isDone) && <button type="button" style={act} title="Reply to this message" onClick={() => { p.markRead(t.rows.map(x => x.id)); p.onReply(r, false); }}>↩ Reply</button>}
                    {!t.rows.every(p.isDone) && p.canReplyAll(r) && <button type="button" style={act} title="Reply to everyone on this message" onClick={() => { p.markRead(t.rows.map(x => x.id)); p.onReply(r, true); }}>↩↩ Reply all</button>}
                    {t.rows.every(p.isDone)
                      ? <button type="button" style={act} title="Put it back in the inbox" onClick={() => p.setDoneIds(t.rows.map(x => x.id), false)}>↺ Move back</button>
                      : <button type="button" style={act} title="Done — hide it until someone writes again" onClick={() => p.setDoneIds(t.rows.map(x => x.id), true)}>✓ Done</button>}
                    {unread
                      ? <button type="button" style={act} title="Mark as read" onClick={() => p.markRead(t.rows.map(x => x.id))}>Mark read</button>
                      : <button type="button" style={act} title="Mark as unread" onClick={() => p.markUnread([t.latest.id])}>Mark unread</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {p.rows && p.rows.length >= 400 && <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 8 }}>Showing the latest 400.</div>}
    </div>
  );
}
