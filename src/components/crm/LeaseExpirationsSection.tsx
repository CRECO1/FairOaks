'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface LeaseClient {
  id: string; first_name: string | null; last_name: string | null; business_name: string | null;
  type: string | null; agent_id: string | null;
  lease_expiration_date: string; lxp_follow_up_days: number | null; lxp_prospected_for: string | null;
}

const DEFAULT_LEAD_DAYS = 120;
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function daysBetween(fromISO: string, toISO: string) {
  return Math.round((new Date(toISO + 'T12:00:00').getTime() - new Date(fromISO + 'T12:00:00').getTime()) / 86400000);
}

export default function LeaseExpirationsSection({ authToken, onToast, onCreated }: {
  authToken?: string; onToast: (m: string) => void; onCreated?: () => void;
}) {
  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  const [clients, setClients] = useState<LeaseClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [windowMonths, setWindowMonths] = useState(6);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/crm/lease-prospecting', { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    setClients(json.clients ?? []);
    setLoading(false);
  }, [authToken]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const today = todayISO();
  const horizon = windowMonths >= 99 ? '9999-12-31' : (() => {
    const d = new Date(today + 'T12:00:00'); d.setMonth(d.getMonth() + windowMonths); return d.toISOString().slice(0, 10);
  })();
  const shown = clients
    .filter(c => c.lease_expiration_date >= today && c.lease_expiration_date <= horizon)
    .sort((a, b) => a.lease_expiration_date.localeCompare(b.lease_expiration_date));

  async function run(clientIds?: string[]) {
    setBusy(true);
    const res = await fetch('/api/crm/lease-prospecting', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(clientIds ? { client_ids: clientIds } : {}),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { onToast('Could not create calls'); return; }
    onToast(json.created > 0 ? `📞 ${json.created} renewal call${json.created === 1 ? '' : 's'} added to the queue` : 'No new calls to add');
    await load();
    onCreated?.();
  }

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 4 }}>🔑 Lease Renewals</h2>
          <p style={{ fontSize: 14, color: '#6b7280' }}>
            {shown.length} lease{shown.length === 1 ? '' : 's'} expiring {windowMonths >= 99 ? 'ahead' : `in the next ${windowMonths} months`} · outreach starts ~{DEFAULT_LEAD_DAYS} days out
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select value={windowMonths} onChange={e => setWindowMonths(Number(e.target.value))}
            style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, background: '#fff', color: '#374151', cursor: 'pointer' }}>
            {[3, 6, 12].map(m => <option key={m} value={m}>Next {m} months</option>)}
            <option value={99}>All upcoming</option>
          </select>
          <button onClick={() => run()} disabled={busy}
            style={{ padding: '8px 16px', background: '#c9922c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
            {busy ? 'Working…' : '📞 Auto-create due calls'}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔑</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No leases expiring in this window</div>
          <div style={{ fontSize: 13 }}>Add a <strong>lease expiration date</strong> on a contact to start tracking renewals.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(c => {
            const hasName = [c.first_name, c.last_name].some(Boolean);
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.business_name || 'Tenant';
            const days = daysBetween(today, c.lease_expiration_date);
            const lead = c.lxp_follow_up_days && c.lxp_follow_up_days > 0 ? c.lxp_follow_up_days : DEFAULT_LEAD_DAYS;
            const dueNow = days <= lead;
            const prospected = c.lxp_prospected_for === c.lease_expiration_date;
            const chip = days <= 90 ? { bg: '#fee2e2', color: '#dc2626' } : days <= 180 ? { bg: '#fff7ed', color: '#c2410c' } : { bg: '#f1f5f9', color: '#475569' };
            const expLabel = new Date(c.lease_expiration_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${dueNow && !prospected ? '#f0e2c4' : '#eef0f2'}`, borderRadius: 10, padding: '12px 15px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{name}</span>
                    {c.business_name && hasName && <span style={{ fontSize: 12, color: '#9ca3af' }}>· {c.business_name}</span>}
                    {c.type && <span style={{ fontSize: 11, color: '#9ca3af' }}>{c.type}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Expires {expLabel}</div>
                </div>
                <span style={{ background: chip.bg, color: chip.color, fontSize: 11.5, fontWeight: 700, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {days <= 0 ? 'expired' : `${days}d`}
                </span>
                {prospected ? (
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', flexShrink: 0, whiteSpace: 'nowrap' }}>✓ In queue</span>
                ) : (
                  <button onClick={() => run([c.id])} disabled={busy}
                    style={{ fontSize: 12.5, fontWeight: 700, color: dueNow ? '#fff' : '#a06a12', background: dueNow ? '#c9922c' : '#fff', border: dueNow ? 'none' : '1px solid #f0e2c4', borderRadius: 7, padding: '6px 12px', cursor: busy ? 'default' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    ＋ Call
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
