'use client';

import React, { useEffect, useState } from 'react';

// Super-admin-only oversight feed of every action the copilot took for an agent.
type Row = { id: string; agent: string; action: string; contact: string; business_unit: string | null; when: string };
type AgentRef = { id: string; name: string };

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CopilotActivity({ token, onClose }: { token?: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<AgentRef[]>([]);
  const [agentId, setAgentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/crm/copilot-activity${agentId ? `?agent_id=${agentId}` : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || 'Failed')))
      .then(j => { if (!cancelled) { setRows(j.rows || []); if (!agentId) setAgents((j.agents || []).filter((a: AgentRef) => a.name)); } })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, agentId]);

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.55)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: 14, width: 'min(760px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', background: '#1a1a1a', color: '#fff' }}>
          <span style={{ fontSize: 18 }}>👁</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Copilot Activity</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.55)' }}>Every action the copilot took for an agent · super-admin only</div>
          </div>
          <select value={agentId} onChange={e => setAgentId(e.target.value)}
            style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
            <option value="" style={{ color: '#111' }}>All agents</option>
            {agents.map(a => <option key={a.id} value={a.id} style={{ color: '#111' }}>{a.name}</option>)}
          </select>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 15 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>}
          {error && <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No copilot activity yet. Actions agents take through the ✨ copilot will show up here.</div>
          )}
          {!loading && !error && rows.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '11px 14px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ width: 130, flexShrink: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.agent}</div>
                {r.business_unit && <div style={{ fontSize: 10.5, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>{r.business_unit}</div>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: '#1f2937', lineHeight: 1.4 }}>{r.action}</div>
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
