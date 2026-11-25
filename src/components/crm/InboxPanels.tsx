'use client';

import React from 'react';
import { when } from './mail-format';

export type InboxItem = { key: string; who: string; tag?: string; subject: string; at: number; days: number; open: () => void };

const pill = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 11.5, fontWeight: 600, padding: '1px 9px', borderRadius: 10, background: bg, color: fg, whiteSpace: 'nowrap', flexShrink: 0 });

/** What the empty reading pane shows on the Inbox: who is waiting on you, and unread mail from people in your CRM. */
export function InboxOverview(p: { loaded: number; unread: number; waiting: InboxItem[]; contactsUnread: InboxItem[]; needsReply: InboxItem[]; sorted: boolean }) {
  const tile = (label: string, big: React.ReactNode, sub: string, warm = false): React.ReactNode => (
    <div style={{ flex: '1 1 0', minWidth: 120, background: warm ? 'var(--k-fffbeb)' : 'var(--k-f9fafb)', border: `1px solid ${warm ? 'var(--k-fde68a)' : 'var(--k-eef0f2)'}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: warm ? 'var(--k-92400e)' : 'var(--k-9ca3af)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: warm ? 'var(--k-92400e)' : 'var(--k-111)', lineHeight: 1.2, fontFamily: "'Cormorant Garamond',serif" }}>{big}</div>
      <div style={{ fontSize: 12, color: 'var(--k-6b7280)' }}>{sub}</div>
    </div>
  );
  const row = (it: InboxItem, right: React.ReactNode) => (
    <div key={it.key} role="button" tabIndex={0} onClick={it.open} onKeyDown={e => { if (e.key === 'Enter') it.open(); }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--k-f3f4f6)', cursor: 'pointer' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {it.tag && <span style={{ fontWeight: 500, color: 'var(--k-a06a12)', marginRight: 6, fontSize: 12 }}>{it.tag}</span>}{it.who}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.subject}</div>
      </div>
      {right}
    </div>
  );
  const box = (title: string, sub: string, items: React.ReactNode[], empty: string) => (
    <div style={{ background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{sub}</div>
      </div>
      {items.length ? items : <div style={{ padding: '14px', borderTop: '1px solid var(--k-f3f4f6)', fontSize: 13, color: 'var(--k-9ca3af)' }}>{empty}</div>}
    </div>
  );
  const age = (it: InboxItem) => <span style={pill('var(--k-fdf6e8)', 'var(--k-92400e)')}>{it.days >= 1 ? `${it.days}d` : when(it.at)}</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tile('Unread', p.unread, `of the ${p.loaded} loaded`)}
        {tile('Waiting on you', p.waiting.length, 'people in your CRM who wrote', p.waiting.length > 0)}
        {tile('Needs a reply', p.sorted ? p.needsReply.length : '–', p.sorted ? 'flagged by the assistant' : 'More filters → Sort my inbox')}
      </div>
      {box('Waiting on you', 'People in your CRM who wrote in the last 30 days and have not had an answer', p.waiting.slice(0, 6).map(it => row(it, age(it))), 'Nobody is waiting on an answer from you.')}
      {box('Unread from your contacts', 'New mail from people and deals in your CRM', p.contactsUnread.slice(0, 5).map(it => row(it, <span style={pill('var(--k-f3f4f6)', 'var(--k-6b7280)')}>{when(it.at)}</span>)), 'No unread mail from your contacts.')}
      {p.sorted && p.needsReply.length > 0 && box('Needs a reply', 'The assistant thinks these are waiting on an answer from you', p.needsReply.slice(0, 5).map(it => row(it, age(it))), '')}
      <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', textAlign: 'center', padding: '4px 0 8px' }}>Pick an email to read it · j / k to move · r reply · a reply all · f forward · e archive</div>
    </div>
  );
}
