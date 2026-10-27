'use client';

import React, { useEffect, useState } from 'react';
import Skeleton from '@/components/crm/Skeleton';

// "Recently deleted" — account owner only (the server enforces it). Deals and contacts deleted in
// the last 90 days, each with a Restore button that puts the record back exactly as it was.
type Item = { audit_id: string; kind: 'deal' | 'contact'; title: string; detail: string; deleted_at: string; deleted_by: string | null; children: Record<string, number> | null };

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// What cascaded with a deal and so is NOT brought back by a restore.
function lostNote(c: Item['children']): string {
  if (!c) return '';
  const parts = [
    c.emails && `${c.emails} email${c.emails === 1 ? '' : 's'}`,
    c.docs && `${c.docs} document${c.docs === 1 ? '' : 's'}`,
    c.forms && `${c.forms} form${c.forms === 1 ? '' : 's'}`,
    c.meetings && `${c.meetings} meeting${c.meetings === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return parts.length ? `Its ${parts.join(', ')} were deleted with it and won’t come back.` : '';
}

export default function DeletedItems({ token, isMobile = false, onRestored, onClose }: { token?: string; isMobile?: boolean; onRestored: (kind: 'deal' | 'contact') => void; onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const load = () => {
    setLoading(true); setError(null);
    fetch('/api/crm/deleted-items', { headers })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || 'Failed')))
      .then(j => setItems(j.items || []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  async function restore(it: Item) {
    setBusy(it.audit_id); setNote(null);
    try {
      const r = await fetch('/api/crm/deleted-items', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ audit_id: it.audit_id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setNote(j.error || 'Could not restore that one.'); if (r.status === 409) load(); return; }
      setItems(prev => prev.filter(x => x.audit_id !== it.audit_id));
      setNote(`Restored “${it.title}”.`);
      onRestored(it.kind);
    } finally { setBusy(null); }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.55)', zIndex: 1300, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: 'var(--k-fff)', borderRadius: isMobile ? '14px 14px 0 0' : 14, width: 'min(720px, 100%)', maxHeight: isMobile ? '92vh' : '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', background: '#1a1a1a', color: '#fff' }}>
          <span style={{ fontSize: 18 }}>🗑</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Recently Deleted</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.55)' }}>Deals and contacts removed in the last 90 days — restore puts the record back as it was</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        {note && <div style={{ padding: '10px 20px', fontSize: 13, background: 'var(--k-f0fdf4)', color: 'var(--k-166534)', borderBottom: '1px solid var(--k-f3f4f6)' }}>{note}</div>}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '8px 8px calc(8px + env(safe-area-inset-bottom))' : 8 }}>
          {loading && <Skeleton rows={4} />}
          {error && <div style={{ padding: 40, textAlign: 'center', color: 'var(--k-dc2626)' }}>{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div style={{ padding: 50, textAlign: 'center', color: 'var(--k-9ca3af)', fontSize: 14, lineHeight: 1.6 }}>
              Nothing deleted recently. Deals and contacts removed from now on show up here.
            </div>
          )}
          {!loading && !error && items.map(it => {
            const lost = lostNote(it.children);
            return (
              <div key={it.audit_id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: isMobile ? '12px 10px' : '12px 14px', borderBottom: '1px solid var(--k-f3f4f6)' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: 'var(--k-111)', fontWeight: 600, lineHeight: 1.35, display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
                    <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', padding: '1px 6px', borderRadius: 5, background: it.kind === 'deal' ? 'var(--k-eef2ff)' : 'var(--k-fef3c7)', color: it.kind === 'deal' ? 'var(--k-3730a3)' : 'var(--k-92400e)' }}>{it.kind}</span>
                    <span style={{ overflowWrap: 'anywhere' }}>{it.title}</span>
                  </div>
                  {it.detail && <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginTop: 2, overflowWrap: 'anywhere' }}>{it.detail}</div>}
                  <div style={{ fontSize: 12, color: 'var(--k-9ca3af)', marginTop: 2 }} title={new Date(it.deleted_at).toLocaleString()}>
                    Deleted {ago(it.deleted_at)}{it.deleted_by ? ` by ${it.deleted_by}` : ''}
                  </div>
                  {lost && <div style={{ fontSize: 12, color: 'var(--k-b45309)', marginTop: 2 }}>{lost}</div>}
                </div>
                <button disabled={busy === it.audit_id} onClick={() => restore(it)}
                  style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', minHeight: 40, fontSize: 13.5, fontWeight: 600, cursor: busy === it.audit_id ? 'default' : 'pointer', opacity: busy === it.audit_id ? .6 : 1, fontFamily: 'inherit' }}>
                  {busy === it.audit_id ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
