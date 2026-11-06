'use client';

import React, { useEffect, useState } from 'react';

// Owner-only (super_admin) nightly-backup status. The server enforces the gate; this only displays it.
type Run = {
  id: number; started_at: string; finished_at: string | null; ok: boolean;
  tables_count: number | null; contacts: number | null; new_files: number | null; new_bytes: number | null;
  total_files: number | null; total_bytes: number | null; failed: string[] | null;
};

function size(b: number | null): string {
  if (b == null) return '—';
  if (b < 1e6) return `${Math.round(b / 1e3)} KB`;
  if (b < 1e9) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e9).toFixed(2)} GB`;
}
function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function BackupStatus({ token, isMobile = false, onClose }: { token?: string; isMobile?: boolean; onClose: () => void }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/crm/backup-runs', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || 'Failed')))
      .then(j => { if (!cancelled) setRuns(j.runs || []); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const last = runs[0];
  const hoursSince = last ? (Date.now() - new Date(last.started_at).getTime()) / 36e5 : Infinity;
  // The job runs nightly, so a gap of 30h+ means a night was missed (Mac asleep/off, job stopped).
  const stale = hoursSince > 30;
  const status: { color: string; bg: string; label: string; detail: string } =
    !last ? { color: '#92400e', bg: '#fef3c7', label: 'No backups reported yet', detail: 'The nightly job reports here after each run (2:30 AM).' }
    : !last.ok ? { color: '#991b1b', bg: '#fee2e2', label: 'Last backup had problems', detail: `${when(last.started_at)} — see the failures below.` }
    : stale ? { color: '#991b1b', bg: '#fee2e2', label: 'A nightly backup was missed', detail: `Last good run: ${when(last.started_at)}. The Mac may have been asleep or off.` }
    : { color: '#166534', bg: '#dcfce7', label: 'Backups are running', detail: `Last run ${when(last.started_at)}.` };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.55)', zIndex: 1300, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: isMobile ? '14px 14px 0 0' : 14, width: 'min(640px, 100%)', maxHeight: isMobile ? '92vh' : '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', background: '#1a1a1a', color: '#fff' }}>
          <span style={{ fontSize: 18 }}>💾</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Backups</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.55)' }}>Nightly copy of contacts, tables, docs and photos — copied to your external drive by Time Machine</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, width: 36, height: 36, flexShrink: 0, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 12px calc(12px + env(safe-area-inset-bottom))' : 16 }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>}
          {error && <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{error}</div>}
          {!loading && !error && (
            <>
              <div style={{ background: status.bg, color: status.color, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{status.label}</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{status.detail}</div>
              </div>

              {last && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginBottom: 16 }}>
                  {[
                    ['Contacts', last.contacts?.toLocaleString() ?? '—'],
                    ['Tables', last.tables_count ?? '—'],
                    ['Files kept', last.total_files?.toLocaleString() ?? '—'],
                    ['Files size', size(last.total_bytes)],
                  ].map(([k, v]) => (
                    <div key={String(k)} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: .4 }}>{k}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}

              {last && !last.ok && (last.failed ?? []).length > 0 && (
                <div style={{ border: '1px solid #fecaca', background: '#fff7f7', borderRadius: 10, padding: '10px 12px', marginBottom: 16, fontSize: 13, color: '#7f1d1d' }}>
                  {(last.failed ?? []).slice(0, 8).map((f, i) => <div key={i}>• {f}</div>)}
                </div>
              )}

              {runs.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>Recent runs</div>
                  {runs.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 2px', borderBottom: '1px solid #f3f4f6', fontSize: 13.5 }}>
                      <span aria-label={r.ok ? 'ok' : 'failed'} style={{ color: r.ok ? '#16a34a' : '#dc2626', fontWeight: 700, width: 16 }}>{r.ok ? '✓' : '✕'}</span>
                      <span style={{ flex: 1, minWidth: 0, color: '#1f2937' }}>{when(r.started_at)}</span>
                      <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
                        {r.contacts != null ? `${r.contacts.toLocaleString()} contacts` : ''}{r.new_files ? ` · +${r.new_files} file${r.new_files === 1 ? '' : 's'}` : ''}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
