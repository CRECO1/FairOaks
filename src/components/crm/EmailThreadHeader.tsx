'use client';

import React from 'react';

// The collapsed row of an email conversation on a deal card or a contact card: who it is with, the subject, a clean one-line preview, when.
// Presentational only — CRMApp works out the names / preview / counts (see lib/email-display.ts) and both cards render this, so a thread looks the
// same wherever it is.

export interface ThreadHeaderProps {
  expanded: boolean;
  onToggle: () => void;
  isMobile: boolean;
  /** Who the conversation is with, already resolved to names ("Stacey G, Mike Carter +1"). */
  label: string;
  initials: string;
  avatarColor: string;
  /** Messages in the thread (shown when more than one). */
  count: number;
  /** People on the thread besides us (the badge shows when 3 or more addresses are involved). */
  people: number;
  subject: string;
  /** The preview, without the signature. */
  snippet: string;
  /** Who wrote last when it was one of us ("You", "Brian"); empty when the other side wrote last (the row already names them). */
  prefix: string;
  dateLabel: string;
  hasAttachments: boolean;
  /** Sent-email tracking: opens so far (0 = tracked and unopened, null = not tracked). */
  opens: number | null;
  pin?: { pinned: boolean; toggle: () => void };
}

const pill: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 10, whiteSpace: 'nowrap', lineHeight: '16px' };

export default function EmailThreadHeader(p: ThreadHeaderProps) {
  const act = () => p.onToggle();
  return (
    <div
      role="button" tabIndex={0} aria-expanded={p.expanded}
      onClick={act}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } }}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: p.isMobile ? '12px 12px' : '12px 14px', minHeight: p.isMobile ? 64 : 62, cursor: 'pointer',
        background: p.expanded ? 'var(--k-f9fafb)' : 'var(--k-fff)', transition: 'background .12s' }}
    >
      <div aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', background: p.avatarColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
        {p.initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{p.label}</span>
          {p.count > 1 && <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', flexShrink: 0 }}>{p.count}</span>}
          {p.people >= 3 && <span title="People on this conversation" style={{ ...pill, background: 'var(--k-eef2ff)', color: 'var(--k-3730a3)', flexShrink: 0 }}>👥 {p.people}</span>}
          {p.opens !== null && (p.opens > 0
            ? <span style={{ ...pill, background: 'var(--k-d1fae5)', color: 'var(--k-065f46)', flexShrink: 0 }}>👁 Opened{p.opens > 1 ? ` ${p.opens}×` : ''}</span>
            : <span style={{ ...pill, background: 'var(--k-f3f4f6)', color: 'var(--k-9ca3af)', fontWeight: 500, flexShrink: 0 }}>Not opened</span>)}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-374151)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{p.subject || '(no subject)'}</div>
        <div style={{ fontSize: 13, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
          {p.prefix && p.snippet && <span style={{ color: 'var(--k-6b7280)', fontWeight: 600 }}>{p.prefix}: </span>}{p.snippet || '—'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: p.isMobile ? 2 : 6, flexShrink: 0 }}>
        {p.hasAttachments && <span aria-label="Has attachments" title="Has attachments" style={{ fontSize: 13, color: 'var(--k-9ca3af)' }}>📎</span>}
        {p.pin && (
          <span role="button" tabIndex={0} aria-label={p.pin.pinned ? 'Unpin this conversation' : 'Pin this conversation to the top'} title={p.pin.pinned ? 'Unpin' : 'Pin to the top (this browser)'}
            onClick={ev => { ev.stopPropagation(); p.pin!.toggle(); }} onKeyDown={ev => { if (ev.key === 'Enter') { ev.stopPropagation(); p.pin!.toggle(); } }}
            style={{ fontSize: 16, cursor: 'pointer', padding: p.isMobile ? '10px 8px' : '0 2px', color: p.pin.pinned ? '#c9922c' : 'var(--k-cbd5e1)' }}>{p.pin.pinned ? '★' : '☆'}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--k-9ca3af)', whiteSpace: 'nowrap' }}>{p.dateLabel}</span>
        <span aria-hidden style={{ fontSize: 12, color: 'var(--k-cbd5e1)' }}>{p.expanded ? '▾' : '▸'}</span>
      </div>
    </div>
  );
}
