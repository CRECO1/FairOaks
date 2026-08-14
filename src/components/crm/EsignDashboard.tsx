'use client';
// Global E-Sign dashboard: every out-for-signature document across the workspace, who
// each is waiting on and for how long, with a one-click nudge or a jump to the deal.
import React, { useCallback, useEffect, useState } from 'react';

interface Signer { id: string; name: string; email: string; signer_role: string; signing_order: number; status: string; sent_at?: string | null; viewed_at?: string | null; signed_at?: string | null }
interface Envelope { id: string; deal_id?: string | null; title?: string; status: string; created_at?: string; crm_deals?: { id: string; property?: string; client?: string } | null; crm_envelope_signers?: Signer[] }

interface Props { authToken?: string; showToast?: (m: string) => void; onOpenDeal?: (dealId: string) => void }

const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const ago = (iso?: string | null) => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`; };
const mini: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' };

export default function EsignDashboard({ authToken, showToast, onOpenDeal }: Props) {
  const [envs, setEnvs] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetch('/api/crm/envelopes?pending=1', { headers: auth(authToken) }).then(r => r.json());
      const list = (Array.isArray(j.envelopes) ? j.envelopes : []) as Envelope[];
      list.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')); // oldest (most overdue) first
      setEnvs(list);
    } catch { setEnvs([]); }
    finally { setLoading(false); }
  }, [authToken]);

  useEffect(() => { load(); }, [load]);

  async function nudge(env: Envelope) {
    setBusy(env.id);
    try {
      const r = await fetch('/api/crm/envelopes', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ envelope_id: env.id, action: 'nudge' }) });
      const j = await r.json().catch(() => ({}));
      showToast?.(r.ok ? `🔔 Reminder sent${j.to ? ` to ${j.to}` : ''} ✓` : (j.error || 'Could not nudge'));
    } finally { setBusy(null); load(); }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, fontWeight: 700, margin: 0, color: '#111' }}>✍️ E-Sign</h2>
        <span style={{ fontSize: 13, color: '#9ca3af' }}>{loading ? '' : `${envs.length} out for signature`}</span>
        <span style={{ flex: 1 }} />
        <button onClick={load} style={{ ...mini, color: '#9ca3af' }}>⟳ Refresh</button>
      </div>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0, marginBottom: 18 }}>Every document waiting on a signature, across all deals. Nudge the current signer or jump to the deal to manage.</p>

      {loading ? <div style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</div>
        : envs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ca3af' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>Nothing is waiting to be signed.</div>
            <div style={{ fontSize: 13 }}>Send a document from a deal's E-Sign tab and it shows up here.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {envs.map(env => {
              const signers = (env.crm_envelope_signers || []).slice().sort((a, b) => a.signing_order - b.signing_order);
              const done = signers.filter(s => s.status === 'signed' || s.signed_at).length;
              const current = signers.find(s => s.status !== 'signed' && !s.signed_at);
              const dealName = env.crm_deals?.property || env.crm_deals?.client || 'Deal';
              return (
                <div key={env.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: '13px 16px' }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{env.title || 'Document'}</div>
                    <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 1 }}>{dealName} · {done}/{signers.length} signed</div>
                    {current && (
                      <div style={{ fontSize: 12.5, color: '#1d4ed8', marginTop: 3, fontWeight: 600 }}>
                        ⏳ Waiting on {current.name} <span style={{ color: '#9ca3af', fontWeight: 400 }}>· {current.email}{current.viewed_at ? ' · viewed' : current.sent_at ? ` · ${ago(current.sent_at)}` : ''}</span>
                      </div>
                    )}
                  </div>
                  {current && <button disabled={busy === env.id} onClick={() => nudge(env)} style={{ ...mini, color: '#a06a12', borderColor: '#f0e2c4' }}>{busy === env.id ? '…' : '🔔 Nudge'}</button>}
                  {env.deal_id && onOpenDeal && <button onClick={() => onOpenDeal(env.deal_id!)} style={{ ...mini, background: '#c9922c', color: '#fff', border: 'none' }}>Open →</button>}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
