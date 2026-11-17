'use client';
import React, { useEffect, useState } from 'react';
import OwnerLinks from '@/components/crm/OwnerLinks';

type Row = { listing_id: string; listing: string; hasOwnerEmail?: boolean; asked: number; targeted: number; followedUp: number; deals: number; needsFollowUp: number; avgReplyDays: number | null };
type SortKey = 'asked' | 'targeted' | 'followedUp' | 'deals' | 'needsFollowUp' | 'avgReplyDays';

/** Every property with tagged interest or outreach side by side, so you can see where to push: who is getting asks, who is getting follow-up, where people stall. */
export default function InterestOverview({ authToken, onClose, onOpen, onOpenContact }: { authToken?: string; onClose: () => void; onOpen: (listingId: string) => void; onOpenContact?: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sort, setSort] = useState<SortKey>('asked');
  const [narrow, setNarrow] = useState(false);
  const [showOwners, setShowOwners] = useState(false);
  const [reloadN, setReloadN] = useState(0);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 640); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  useEffect(() => {
    let alive = true;
    fetch('/api/crm/interest-overview', { headers: { Authorization: `Bearer ${authToken}` } }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive) setRows(j?.rows ?? []); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [authToken, reloadN]);
  const noOwner = (rows ?? []).filter(r => !r.hasOwnerEmail).length;
  const val = (r: Row) => (sort === 'avgReplyDays' ? (r.avgReplyDays ?? -1) : r[sort]);
  const sorted = [...(rows ?? [])].sort((a, b) => val(b) - val(a));
  const tot = (k: SortKey) => (rows ?? []).reduce((a, r) => a + (k === 'avgReplyDays' ? 0 : r[k]), 0);
  const th = (k: SortKey, label: string, title: string) => (
    <th title={title} onClick={() => setSort(k)} style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', color: sort === k ? 'var(--k-0f766e, #0f766e)' : 'var(--k-6b7280, #6b7280)' }}>{label}{sort === k ? ' ↓' : ''}</th>
  );
  return (
    <div role="dialog" aria-label="Interest by property" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--k-fff, #fff)', width: 'min(860px, 100%)', maxHeight: '88vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: '18px 18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>📊 Interest by property</div>
          {noOwner > 0 && <button onClick={() => setShowOwners(true)} title="These properties have no landlord or owner email linked, so the weekly owner update is addressed to you" style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 14, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer', whiteSpace: 'nowrap' }}>🏢 Link owners ({noOwner})</button>}
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--k-6b7280, #6b7280)', marginBottom: 10 }}>Asked = tagged inquiries. Reached out = outreach lists. Followed up = an email sent or a touch logged after the ask. Tap a column to sort, a row to open the property.</div>
        {rows === null ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>Adding it up…</div>
          : rows.length === 0 ? <div style={{ fontSize: 13, color: 'var(--k-9ca3af, #9ca3af)' }}>No property has tagged interest yet.</div>
          : (
            narrow ? (
              <div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {([['asked', '🏠 Asked'], ['targeted', '🎯 Reached out'], ['needsFollowUp', '⏳ Waiting'], ['deals', '💼 Deals']] as [SortKey, string][]).map(([k, l]) => (
                    <button key={k} onClick={() => setSort(k)} style={{ fontSize: 12, padding: '5px 11px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: sort === k ? 'var(--k-f0fdfa, #f0fdfa)' : 'var(--k-fff, #fff)', color: sort === k ? 'var(--k-0f766e, #0f766e)' : 'var(--k-374151, #374151)', cursor: 'pointer' }}>{l}{sort === k ? ' ↓' : ''}</button>
                  ))}
                </div>
                {sorted.map(r => (
                  <button key={r.listing_id} onClick={() => { onOpen(r.listing_id); onClose(); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px solid #eef0f2', borderRadius: 12, padding: '10px 12px', marginBottom: 8, background: 'var(--k-fff, #fff)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>{r.listing}{!r.hasOwnerEmail && <span title="No landlord or owner email is linked, so the weekly owner update is addressed to you" style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '1px 7px' }}>⚠ no owner email</span>}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px 8px', fontSize: 12, color: 'var(--k-6b7280, #6b7280)' }}>
                      <div><b style={{ fontSize: 15, color: 'var(--k-111, #111)' }}>{r.asked}</b><br />asked</div>
                      <div><b style={{ fontSize: 15, color: 'var(--k-111, #111)' }}>{r.targeted}</b><br />reached out</div>
                      <div><b style={{ fontSize: 15, color: 'var(--k-111, #111)' }}>{r.followedUp}</b><br />followed up</div>
                      <div><b style={{ fontSize: 15, color: r.needsFollowUp ? '#b45309' : 'var(--k-111, #111)' }}>{r.needsFollowUp}</b><br />waiting</div>
                      <div><b style={{ fontSize: 15, color: 'var(--k-111, #111)' }}>{r.avgReplyDays === null ? '—' : r.avgReplyDays}</b><br />days to reply</div>
                      <div><b style={{ fontSize: 15, color: 'var(--k-111, #111)' }}>{r.deals}</b><br />deals</div>
                    </div>
                  </button>
                ))}
                <div style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 2px' }}>Total: {tot('asked')} asked · {tot('targeted')} reached out · {tot('followedUp')} followed up · {tot('needsFollowUp')} waiting · {tot('deals')} deals</div>
              </div>
            ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #eef0f2' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11.5, color: 'var(--k-6b7280, #6b7280)' }}>Property</th>
                    {th('asked', '🏠 Asked', 'People who asked about it')}
                    {th('targeted', '🎯 Reached out', 'People on an outreach list for it')}
                    {th('followedUp', '✅ Followed up', 'Asks with an email sent or a touch logged afterwards')}
                    {th('needsFollowUp', '⏳ Waiting', 'Asked a week or more ago, nothing since')}
                    {th('avgReplyDays', 'Days to reply', 'Average days from an ask to our first email')}
                    {th('deals', '💼 Deals', 'Deals on this property')}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => (
                    <tr key={r.listing_id} onClick={() => { onOpen(r.listing_id); onClose(); }} style={{ borderBottom: '1px solid #f1f3f5', cursor: 'pointer' }}>
                      <td style={{ padding: '8px', fontWeight: 600 }}>{r.listing}{!r.hasOwnerEmail && <span title="No landlord or owner email is linked, so the weekly owner update is addressed to you. Open the property → Contacts to link one." style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '1px 7px' }}>⚠ no owner email</span>}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{r.asked}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{r.targeted}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{r.followedUp}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: r.needsFollowUp ? '#b45309' : undefined, fontWeight: r.needsFollowUp ? 700 : 400 }}>{r.needsFollowUp}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{r.avgReplyDays === null ? '—' : r.avgReplyDays}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{r.deals}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, background: 'var(--k-f9fafb, #f9fafb)' }}>
                    <td style={{ padding: '8px' }}>Total</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{tot('asked')}</td><td style={{ padding: '8px', textAlign: 'right' }}>{tot('targeted')}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{tot('followedUp')}</td><td style={{ padding: '8px', textAlign: 'right' }}>{tot('needsFollowUp')}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>—</td><td style={{ padding: '8px', textAlign: 'right' }}>{tot('deals')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            )
          )}
      </div>
      {showOwners && <OwnerLinks authToken={authToken} onClose={() => setShowOwners(false)} onOpenContact={onOpenContact} onChanged={() => setReloadN(n => n + 1)} />}
    </div>
  );
}
