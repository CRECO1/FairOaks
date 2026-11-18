'use client';
// Dashboard card: open deals nobody has touched in two weeks (10 of 39 in the Nov 2026 usage read). One tap logs a touch
// (it only moves the deal's "last touch" date to today — nothing is sent), or opens the deal to move it forward.
import React from 'react';

export interface StaleDeal { id: string; client: string; property: string; stage: string; last_touch: string }
const DAYS = 14;
const daysSince = (d: string) => Math.floor((Date.now() - new Date(d + (d.length === 10 ? 'T12:00:00' : '')).getTime()) / 86400_000);

export default function StaleDeals({ deals, onOpen, onTouch }: { deals: StaleDeal[]; onOpen: (id: string) => void; onTouch: (id: string) => void }) {
  const stale = deals.filter(d => !['Closed', 'Lost'].includes(d.stage) && d.last_touch && daysSince(d.last_touch) >= DAYS).sort((a, b) => daysSince(b.last_touch) - daysSince(a.last_touch));
  if (!stale.length) return null;
  const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, padding: '5px 12px', minHeight: 32, borderRadius: 16, border: '1px solid #c9922c', background: '#fff', color: '#92400e', cursor: 'pointer' };
  return (
    <div style={{ background: 'var(--k-fef3c7)', border: '1px solid var(--k-fde68a)', borderRadius: 12, padding: '12px 14px', margin: '0 0 14px' }}>
      <b style={{ fontSize: 14, color: 'var(--k-92400e)', display: 'block', marginBottom: 6 }}>🕸 {stale.length} open deal{stale.length === 1 ? '' : 's'} not touched in {DAYS}+ days</b>
      {stale.slice(0, 5).map(d => (
        <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--k-374151)', padding: '4px 0', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 220px', overflowWrap: 'anywhere' }}><b>{d.client}</b>{d.property ? ` — ${d.property}` : ''} · {d.stage} · {daysSince(d.last_touch)} days quiet</span>
          <button style={btn} onClick={() => onOpen(d.id)}>Open</button>
          <button style={{ ...btn, background: 'transparent' }} onClick={() => onTouch(d.id)}>Touched today</button>
        </div>
      ))}
      {stale.length > 5 && <div style={{ fontSize: 12, color: 'var(--k-6b7280)' }}>…and {stale.length - 5} more on the Deals page</div>}
    </div>
  );
}
