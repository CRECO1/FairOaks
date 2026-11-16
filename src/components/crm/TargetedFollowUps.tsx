'use client';
import React, { useEffect, useState } from 'react';

type Item = { contact_id: string; name: string; first_name: string; email: string | null; listing_id: string; listing: string; days: number };

/**
 * Dashboard card: people we reached out to about one of your properties (🎯 targeted) who have not written back in 30 days. "Send a second
 * touch" opens their card with a short email already started (nothing is sent until you press send); a reply moves them to "asked" on its own.
 */
export default function TargetedFollowUps({ authToken, onOpenContact, onSecondTouch, onToast }: { authToken?: string; onOpenContact: (id: string) => void; onSecondTouch: (i: Item) => void; onToast?: (m: string) => void }) {
  const [prep, setPrep] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!authToken) return;
    let alive = true;
    fetch('/api/crm/targeted-follow-ups', { headers: { Authorization: `Bearer ${authToken}` } }).then(r => (r.ok ? r.json() : null)).then(j => { if (alive) { setItems(j?.items ?? []); setTotal(j?.total ?? 0); } }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [authToken]);
  const prepareDrafts = async () => {
    setPrep(true);
    const r = await fetch('/api/crm/second-touch-drafts', { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    setPrep(false);
    onToast?.(j ? (j.made ? `${j.made} second-touch draft${j.made === 1 ? '' : 's'} saved to your Drafts (Emails → Drafts). Nothing was sent.` : 'No drafts to prepare (no email on file, or already prepared).') : 'Could not prepare the drafts');
    if (j?.made) setItems(cur => (cur ?? []).filter(x => !(j.items ?? []).some((d: { to: string }) => d.to === x.email)));
  };
  if (!items || items.length === 0) return null;
  return (
    <div style={{ background: 'var(--k-fff, #fff)', border: '1px solid #fde68a', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>🎯 We reached out, no reply in 30 days <span style={{ fontWeight: 500, color: 'var(--k-9ca3af, #9ca3af)' }}>· {total}</span></div>
      <div style={{ fontSize: 12, color: 'var(--k-6b7280, #6b7280)', marginBottom: 8 }}>On an outreach list for one of your properties and haven&apos;t written back. A reply moves them to “asked” automatically.</div>
      <button disabled={prep} onClick={prepareDrafts} title="Writes a short follow-up email for each of these (up to 25) into your Drafts. You read, edit and send them yourself; nothing is sent." style={{ marginBottom: 8, fontSize: 12.5, fontWeight: 700, padding: '6px 14px', borderRadius: 16, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer' }}>{prep ? 'Preparing…' : '✉ Prepare drafts for these (up to 25)'}</button>
      {items.slice(0, 6).map(i => (
        <div key={`${i.contact_id}:${i.listing_id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '7px 0', borderTop: '1px solid #f1f3f5' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i.name} <span style={{ fontWeight: 500, color: 'var(--k-6b7280, #6b7280)' }}>· {i.listing}</span></div>
            <div style={{ fontSize: 11.5, color: '#b45309' }}>reached out {i.days} days ago</div>
          </div>
          <button onClick={() => onOpenContact(i.contact_id)} style={{ fontSize: 12.5, padding: '5px 12px', borderRadius: 14, border: '1px solid var(--k-e5e7eb, #e5e7eb)', background: 'none', cursor: 'pointer', color: 'var(--k-374151, #374151)' }}>Open</button>
          <button disabled={!i.email} title={i.email ? 'Open their card with a short follow-up email started' : 'No email address on file'} onClick={() => onSecondTouch(i)}
            style={{ fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 14, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: i.email ? 'pointer' : 'default', opacity: i.email ? 1 : 0.5 }}>Send a second touch</button>
        </div>
      ))}
      {total > 6 && <div style={{ fontSize: 12, color: 'var(--k-9ca3af, #9ca3af)', paddingTop: 6 }}>+ {total - 6} more</div>}
    </div>
  );
}
