'use client';
import React, { useEffect, useState } from 'react';

// Admin-only: uploads that failed in the last 14 days — who, where, what file, why. The server enforces the gate.
type Fail = { id: string; at: string; who: string; target: string; name: string; size: number; stage: string; message: string; ua: string };
const STAGE: Record<string, string> = { precheck: 'Rejected before sending', convert: 'Photo conversion', start: 'Could not start', send: 'Sending / storage', save: 'Saving to the CRM' };
const WHERE: Record<string, string> = { deal: 'Deal files', contact: 'Contact files', drive: 'My Drive', secure: 'Secure folder', secure_guest: 'Secure link (tenant)', chat: 'Team chat', listing: 'Property files' };
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function UploadFailures({ token, isMobile = false, onClose }: { token?: string; isMobile?: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Fail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    fetch('/api/crm/upload-failure', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || 'Failed')))
      .then(j => { if (!off) setRows(j.failures || []); })
      .catch(e => { if (!off) setError(String(e)); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [token]);
  const reasons = Object.entries(rows.reduce<Record<string, number>>((m, r) => { m[r.stage] = (m[r.stage] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.55)', zIndex: 1300, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16 }}>
      <div style={{ background: '#fff', borderRadius: isMobile ? '14px 14px 0 0' : 14, width: 'min(720px, 100%)', maxHeight: isMobile ? '92vh' : '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', background: '#1a1a1a', color: '#fff' }}>
          <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700 }}>Failed uploads</div><div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.55)' }}>Last 14 days — every upload that didn’t go through</div></div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 20px' }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>}
          {error && <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{error}</div>}
          {!loading && !error && !rows.length && <div style={{ padding: 40, textAlign: 'center', color: '#166534' }}>No failed uploads in the last 14 days. ✓</div>}
          {!!rows.length && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ fontWeight: 700 }}>{rows.length} failed</span>
                {reasons.map(([k, n]) => <span key={k} style={{ background: '#f3f4f6', borderRadius: 999, padding: '2px 10px', fontSize: 12.5 }}>{STAGE[k] ?? k}: {n}</span>)}
              </div>
              {rows.map(r => (
                <div key={r.id} style={{ borderTop: '1px solid #e5e7eb', padding: '9px 0' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{r.name || '(no name)'} <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>{(r.size / 1048576).toFixed(1)} MB</span></div>
                  <div style={{ fontSize: 12.5, color: '#b91c1c', overflowWrap: 'anywhere' }}>{r.message}</div>
                  <div style={{ fontSize: 11.5, color: '#6b7280' }}>{r.who} · {WHERE[r.target] ?? r.target} · {STAGE[r.stage] ?? r.stage} · {when(r.at)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
