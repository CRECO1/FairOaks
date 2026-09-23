'use client';

import React, { useEffect, useState } from 'react';

// Activity feed. A broker (admin/super_admin) sees the whole team and can filter
// to one agent; an agent sees only their own rows — the server enforces both, this
// only reflects it.
type Row = { id: string; agent: string; action: string; contact: string; business_unit: string | null; when: string; kind?: 'copilot' | 'account' };
type AgentRef = { id: string; name: string };

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CopilotActivity({ token, isMobile = false, isBroker = false, onClose }: { token?: string; isMobile?: boolean; isBroker?: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<AgentRef[]>([]);
  const [agentId, setAgentId] = useState('');
  const [view, setView] = useState<'all' | 'copilot'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const qs = new URLSearchParams();
    if (agentId) qs.set('agent_id', agentId);
    if (view === 'copilot') qs.set('view', 'copilot');
    fetch(`/api/crm/copilot-activity${qs.toString() ? `?${qs}` : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || 'Failed')))
      .then(j => { if (!cancelled) { setRows(j.rows || []); if (!agentId) setAgents((j.agents || []).filter((a: AgentRef) => a.name)); } })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, agentId, view]);

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.55)', zIndex: 1300, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: isMobile ? '14px 14px 0 0' : 14, width: 'min(760px, 100%)', maxHeight: isMobile ? '92vh' : '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '16px 20px', background: '#1a1a1a', color: '#fff' }}>
          <span style={{ fontSize: 18 }}>👁</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{isBroker ? 'Agent Activity' : 'My Activity'}</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isBroker ? 'Copilot actions and account activity across the team' : 'Your Copilot actions and account activity'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, lineHeight: 1, order: isMobile ? 2 : 4 }}>✕</button>
          <select value={view} onChange={e => setView(e.target.value as 'all' | 'copilot')}
            style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, padding: isMobile ? '10px 10px' : '6px 10px', fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', order: 3, flex: isMobile ? '1 1 100%' : '0 0 auto', minWidth: 0, maxWidth: '100%' }}>
            <option value="all" style={{ color: '#111' }}>All activity</option>
            <option value="copilot" style={{ color: '#111' }}>AI / Copilot only</option>
          </select>
          {isBroker && <select value={agentId} onChange={e => setAgentId(e.target.value)}
            style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, padding: isMobile ? '10px 10px' : '6px 10px', fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', order: 3, flex: isMobile ? '1 1 100%' : '0 0 auto', minWidth: 0, maxWidth: '100%' }}>
            <option value="" style={{ color: '#111' }}>All agents</option>
            {agents.map(a => <option key={a.id} value={a.id} style={{ color: '#111' }}>{a.name}</option>)}
          </select>}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '8px 8px calc(8px + env(safe-area-inset-bottom))' : 8 }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>}
          {error && <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af', fontSize: 14, lineHeight: 1.6 }}>
              {view === 'copilot'
                ? <>No Copilot activity{agentId ? ' for this agent' : ' yet'}. Anything an agent asks the ✨ Copilot to do is recorded here.</>
                : <>No activity recorded{agentId ? ' for this agent' : ' yet'}.</>}
            </div>
          )}
          {!loading && !error && rows.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: isMobile ? 9 : 12, padding: isMobile ? '11px 10px' : '11px 14px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ width: isMobile ? 92 : 130, flexShrink: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.agent}</div>
                {r.business_unit && <div style={{ fontSize: 10.5, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>{r.business_unit}</div>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: '#1f2937', lineHeight: 1.4, display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
                  {/* Which trail a row came from: what the Copilot did on the
                      agent's behalf, versus what the agent did themselves. */}
                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', padding: '1px 6px', borderRadius: 5,
                    background: r.kind === 'account' ? '#eef2ff' : '#fef3c7', color: r.kind === 'account' ? '#3730a3' : '#92400e' }}>
                    {r.kind === 'account' ? 'account' : 'AI'}
                  </span>
                  <span>{r.action}</span>
                </div>
                {r.contact && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>· {r.contact}</div>}
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap' }} title={new Date(r.when).toLocaleString()}>{ago(r.when)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
