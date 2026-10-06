'use client';

import { useEffect, useState } from 'react';

/**
 * Pre-send check shown in place of a bare "Activate?" confirm. Every activation
 * path (list row, bulk bar, detail view, builder save) goes through this.
 * Checks come from /api/campaigns/[id]/preflight: ✕ blocks, ! can be overridden.
 */

interface Check { key: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string; items?: string[] }
interface Result { checks: Check[]; deliverable: number; enrolled: number; can_activate: boolean }

interface Props {
  campaigns: { id: string; name: string; type?: string }[];
  authToken?: string;
  isMobile: boolean;
  onClose: () => void;
  onActivated: (ids: string[]) => void;
  onPreview?: (id: string) => void;
  showToast: (msg: string) => void;
}

const MARK = { pass: '✓', warn: '!', fail: '✕' } as const;
const TONE = {
  pass: { bg: '#dcfce7', fg: '#166534' },
  warn: { bg: '#fef3c7', fg: '#92400e' },
  fail: { bg: '#fee2e2', fg: '#991b1b' },
} as const;

export default function CampaignPreflight({ campaigns, authToken, isMobile, onClose, onActivated, onPreview, showToast }: Props) {
  const [results, setResults] = useState<Record<string, Result | { error: string }>>({});
  const [busy, setBusy] = useState(false);
  const [showPasses, setShowPasses] = useState(false);
  const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  useEffect(() => {
    let live = true;
    for (const c of campaigns) {
      fetch(`/api/campaigns/${c.id}/preflight`, { headers })
        .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
        .then(({ ok, j }) => { if (live) setResults(prev => ({ ...prev, [c.id]: ok ? j : { error: j.error ?? 'Check failed' } })); })
        .catch(() => { if (live) setResults(prev => ({ ...prev, [c.id]: { error: 'Network error' } })); });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns]);

  const done = campaigns.every(c => results[c.id]);
  const ok = (r?: Result | { error: string }): r is Result => !!r && !('error' in r);
  const blocked = campaigns.filter(c => !ok(results[c.id]) || !(results[c.id] as Result).can_activate);
  const warned = campaigns.some(c => ok(results[c.id]) && (results[c.id] as Result).checks.some(k => k.status === 'warn'));
  const ready = campaigns.filter(c => ok(results[c.id]) && (results[c.id] as Result).can_activate);

  async function activate() {
    setBusy(true);
    const okIds: string[] = [];
    for (const c of ready) {
      const r = await fetch(`/api/campaigns/${c.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ status: 'active' }),
      }).catch(() => null);
      if (r?.ok) okIds.push(c.id);
    }
    setBusy(false);
    if (okIds.length) {
      showToast(okIds.length === 1 ? 'Campaign activated ✓' : `${okIds.length} campaigns activated ✓`);
      onActivated(okIds);
    } else showToast('Activation failed — try again');
  }

  const total = ready.reduce((s, c) => s + (results[c.id] as Result).deliverable, 0);

  return (
    <div className="crm-sheet" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1001, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={onClose}>
      <div className="crm-sheet-panel" style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 640, boxShadow: '0 24px 80px rgba(0,0,0,.3)', overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid #e5e7eb', background: '#fafafa' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>Pre-send check</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Before {campaigns.length === 1 ? 'this campaign goes' : `these ${campaigns.length} campaigns go`} live to real inboxes.</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#9ca3af', lineHeight: 1, padding: '0 4px', minWidth: 32, minHeight: 32 }}>×</button>
        </div>

        <div style={{ padding: '14px 20px', maxHeight: isMobile ? undefined : '65vh', overflowY: isMobile ? undefined : 'auto' }}>
          {campaigns.map(c => {
            const r = results[c.id];
            return (
              <div key={c.id} style={{ marginBottom: campaigns.length > 1 ? 18 : 0 }}>
                {campaigns.length > 1 && <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', marginBottom: 8, overflowWrap: 'anywhere' }}>{c.name}</div>}
                {!r ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13.5 }}>Checking recipients, personal fields, links and timing…</div>
                ) : 'error' in r ? (
                  <div style={{ padding: 12, color: '#991b1b', fontSize: 13.5 }}>{r.error}</div>
                ) : (
                  <>
                    {r.checks.filter(k => showPasses || k.status !== 'pass').map(k => (
                      <div key={k.key} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid #f3f4f6' }}>
                        <span aria-label={k.status} style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, background: TONE[k.status].bg, color: TONE[k.status].fg }}>{MARK[k.status]}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: '#111' }}>{k.label}</div>
                          <div style={{ fontSize: 13, color: '#4b5563', marginTop: 1, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{k.detail}</div>
                          {k.items && k.items.length > 0 && (
                            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#6b7280', lineHeight: 1.5 }}>
                              {k.items.map((it, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{it}</li>)}
                            </ul>
                          )}
                          {k.key === 'mobile' && onPreview && (
                            <button onClick={() => onPreview(c.id)} className="crm-btn crm-btn-ghost crm-btn-sm" style={{ marginTop: 6, ...(isMobile ? { minHeight: 40 } : {}) }}>📱 Phone preview</button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!showPasses && r.checks.some(k => k.status === 'pass') && (
                      <div style={{ fontSize: 12.5, color: '#16a34a', padding: '9px 0', borderTop: '1px solid #f3f4f6' }}>
                        ✓ {r.checks.filter(k => k.status === 'pass').length} other checks passed
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {done && (
            <button onClick={() => setShowPasses(v => !v)} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12.5, cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit', textDecoration: 'underline' }}>
              {showPasses ? 'Hide passed checks' : 'Show every check'}
            </button>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', background: '#fafafa', flexWrap: 'wrap' }}>
          {done && blocked.length > 0 && (
            <span style={{ fontSize: 12.5, color: '#991b1b', marginRight: 'auto' }}>
              {ready.length ? `${blocked.length} campaign${blocked.length > 1 ? 's' : ''} can't go yet — fix the ✕ items.` : 'Fix the ✕ items before activating.'}
            </span>
          )}
          <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={onClose} style={isMobile ? { flex: 1, minHeight: 44 } : undefined}>Cancel</button>
          <button className="crm-btn crm-btn-sm" disabled={!done || !ready.length || busy} onClick={activate}
            style={{ background: !done || !ready.length ? '#d1d5db' : warned ? '#b45309' : '#16a34a', color: '#fff', border: 'none', cursor: !done || !ready.length || busy ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', ...(isMobile ? { flex: 2, minHeight: 44 } : {}) }}>
            {busy ? 'Activating…' : !done ? 'Checking…' : !ready.length ? 'Activate' : `${warned ? 'Activate anyway' : '▶ Activate'}${total ? ` · ${total} recipient${total > 1 ? 's' : ''}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
