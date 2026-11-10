'use client';

import React from 'react';

// The strip above a deal's Email Log: where the conversation stands ("they replied 2 days ago — you owe a response"),
// plus find / filter controls. Lives inside the card; there is no separate "needs reply" page.

export type EmailFilter = 'all' | 'received' | 'sent' | 'pinned';

function agoLabel(iso: string): string {
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso).getTime();
  if (isNaN(t)) return iso;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return mins < 2 ? 'just now' : `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24 && /T/.test(iso)) return `${hrs} hr ago`;
  const days = Math.floor((Date.now() - new Date(new Date(t).toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
export { agoLabel };

export default function DealEmailBar({ last, total, filter, setFilter, query, setQuery, pinnedCount, counts, isMobile, noun = 'deal' }: {
  /** What the emails belong to, for the search box ('deal' | 'contact'). */
  noun?: string;
  last: { direction: 'sent' | 'received'; when: string; opened?: boolean; tracked?: boolean } | null;
  total: number;
  filter: EmailFilter;
  setFilter: (f: EmailFilter) => void;
  query: string;
  setQuery: (q: string) => void;
  pinnedCount: number;
  counts: { received: number; sent: number };
  isMobile: boolean;
}) {
  const when = last ? agoLabel(last.when) : '';
  const status = !last ? null
    : last.direction === 'received'
      ? { text: `They replied ${when} — you owe a response`, bg: 'var(--k-fffbeb)', bd: 'var(--k-fde68a)', fg: 'var(--k-92400e)' }
      : { text: `You emailed ${when} — waiting on them${last.tracked ? (last.opened ? ' (they opened it)' : ' (not opened yet)') : ''}`, bg: 'var(--k-f3f4f6)', bd: 'var(--k-e5e7eb)', fg: 'var(--k-374151)' };
  const chip = (id: EmailFilter, label: string, n?: number): React.ReactNode => (
    <button key={id} onClick={() => setFilter(filter === id && id !== 'all' ? 'all' : id)} aria-pressed={filter === id}
      style={{ minHeight: isMobile ? 36 : 28, padding: '0 11px', borderRadius: 14, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
        border: `1px solid ${filter === id ? '#c9922c' : 'var(--k-e5e7eb)'}`, background: filter === id ? '#c9922c' : 'var(--k-fff)', color: filter === id ? '#fff' : 'var(--k-374151)' }}>
      {label}{n !== undefined ? ` ${n}` : ''}
    </button>
  );
  return (
    <div style={{ marginBottom: 12 }}>
      {status && (
        <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13.5, fontWeight: 600, background: status.bg, border: `1px solid ${status.bd}`, color: status.fg, marginBottom: 8 }}>{status.text}</div>
      )}
      {total > 3 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search this ${noun}’s emails…`} aria-label={`Search this ${noun}’s emails`} className="crm-input"
            style={{ flex: '1 1 180px', minWidth: 0, minHeight: isMobile ? 40 : 30, padding: '0 10px', fontSize: 13 }} />
          {chip('received', 'Received', counts.received)}
          {chip('sent', 'Sent', counts.sent)}
          {pinnedCount > 0 && chip('pinned', '★ Pinned', pinnedCount)}
        </div>
      )}
    </div>
  );
}
