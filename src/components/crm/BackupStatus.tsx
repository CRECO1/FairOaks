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
function took(r: Run): string {
  if (!r.finished_at) return '';
  const s = Math.max(0, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000));
  return s < 90 ? `${s}s` : `${Math.round(s / 60)} min`;
}
const dayKey = (d: Date) => d.toLocaleDateString('en-CA');

const CHAIN: { title: string; sub: string }[] = [
  { title: 'Supabase', sub: 'Live CRM data' },
  { title: 'Your Mac', sub: 'Copied nightly, 2:30 AM' },
  { title: 'Time Machine', sub: 'Hourly' },
  { title: 'External drive', sub: 'CRECO Backup' },
];

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

  // Last 14 days, oldest → today. A day is ok if any run that day succeeded, failed if runs exist but none did,
  // missed if nothing reported (today before the first run is just "pending").
  const todayKey = dayKey(new Date());
  const byDay = new Map<string, Run[]>();
  runs.forEach(r => { const k = dayKey(new Date(r.started_at)); byDay.set(k, [...(byDay.get(k) ?? []), r]); });
  const strip = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    const k = dayKey(d); const rs = byDay.get(k);
    const state: 'ok' | 'fail' | 'missed' | 'pending' = rs ? (rs.some(r => r.ok) ? 'ok' : 'fail') : (k === todayKey ? 'pending' : 'missed');
    return { k, d, state };
  });
  const firstRun = runs.length ? dayKey(new Date(runs[runs.length - 1].started_at)) : todayKey;
  const shown = strip.filter(s => s.k >= firstRun || s.k === todayKey);   // don't call days before the job existed "missed"
  const okDays = shown.filter(s => s.state === 'ok').length;
  const cell = { ok: ['#16a34a', '#16a34a'], fail: ['#dc2626', '#dc2626'], missed: ['#fca5a5', '#fca5a5'], pending: ['transparent', '#d1d5db'] } as const;

  const tile = (k: string, v: React.ReactNode, sub?: string) => (
    <div key={k} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: .4 }}>{k}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#111', lineHeight: 1.25 }}>{v}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 1 }}>{sub}</div>}
    </div>
  );
  const heading = (t: string) => <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: .4, margin: '18px 0 8px' }}>{t}</div>;

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.55)', zIndex: 1300, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: isMobile ? '14px 14px 0 0' : 14, width: 'min(680px, 100%)', maxHeight: isMobile ? '92vh' : '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', background: '#1a1a1a', color: '#fff' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Backups</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.55)' }}>Contacts, tables, documents and photos — copied nightly</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, width: 36, height: 36, flexShrink: 0, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 12px calc(14px + env(safe-area-inset-bottom))' : '16px 18px 20px' }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>}
          {error && <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{error}</div>}
          {!loading && !error && (
            <>
              <div style={{ background: status.bg, color: status.color, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{status.label}</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{status.detail}</div>
              </div>

              {last && !last.ok && (last.failed ?? []).length > 0 && (
                <div style={{ border: '1px solid #fecaca', background: '#fff7f7', borderRadius: 10, padding: '10px 12px', marginTop: 10, fontSize: 13, color: '#7f1d1d' }}>
                  {(last.failed ?? []).slice(0, 8).map((f, i) => <div key={i}>• {f}</div>)}
                </div>
              )}

              {last && (
                <>
                  {heading('Latest run')}
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: 8 }}>
                    {tile('Contacts', last.contacts?.toLocaleString() ?? '—')}
                    {tile('Files kept', last.total_files?.toLocaleString() ?? '—', size(last.total_bytes))}
                    {tile('New files', (last.new_files ?? 0).toLocaleString(), (last.new_files ?? 0) > 0 ? size(last.new_bytes) : 'nothing new')}
                    {tile('Took', took(last) || '—', `${last.tables_count ?? '—'} tables`)}
                  </div>
                </>
              )}

              {runs.length > 0 && (
                <>
                  {heading('Last 14 nights')}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {shown.map(s => (
                      <div key={s.k} title={`${s.d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — ${s.state === 'ok' ? 'backed up' : s.state === 'fail' ? 'had problems' : s.state === 'pending' ? 'not run yet' : 'missed'}`}
                        style={{ flex: 1, height: 26, borderRadius: 5, background: cell[s.state][0], border: `1.5px solid ${cell[s.state][1]}`, minWidth: 0 }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                    {okDays} of {shown.length} night{shown.length === 1 ? '' : 's'} backed up
                    {shown.some(s => s.state === 'missed') ? ' · red = missed' : ''}
                  </div>
                </>
              )}

              {heading('Where your data lives')}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: 8 }}>
                {CHAIN.map((c, i) => (
                  <div key={c.title} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '9px 11px', minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>{i + 1}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{c.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8, lineHeight: 1.5 }}>
                Files you delete in the CRM stay in the backup. The public MLS listings feed isn’t included — it re-syncs on its own.
              </div>

              {runs.length > 0 && (
                <>
                  {heading('Recent runs')}
                  {runs.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 2px', borderBottom: '1px solid #f3f4f6', fontSize: 13.5 }}>
                      <span aria-label={r.ok ? 'ok' : 'failed'} style={{ color: r.ok ? '#16a34a' : '#dc2626', fontWeight: 700, width: 16 }}>{r.ok ? '✓' : '✕'}</span>
                      <span style={{ flex: 1, minWidth: 0, color: '#1f2937' }}>{when(r.started_at)}</span>
                      <span style={{ color: '#6b7280', whiteSpace: 'nowrap', fontSize: 12.5 }}>
                        {r.contacts != null ? `${r.contacts.toLocaleString()} contacts` : ''}{r.new_files ? ` · +${r.new_files} file${r.new_files === 1 ? '' : 's'}` : ''}{took(r) ? ` · ${took(r)}` : ''}
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
