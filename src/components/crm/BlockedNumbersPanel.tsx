'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { prettyPhone } from '@/lib/phone';

interface Row { id: string; phone_e164: string; business_unit: string; reason: string | null; source: 'auto' | 'manual'; hits: number; last_blocked_at: string | null; created_at: string }
interface Props { authToken?: string; businessUnit: string; showToast?: (msg: string) => void; onChanged?: () => void }

const auth = (t?: string): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});
const cell: React.CSSProperties = { fontSize: 13, color: '#374151', padding: '8px 6px', borderTop: '1px solid #f3f4f6', verticalAlign: 'top' };
const btn: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '6px 10px', minHeight: 32, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
const field: React.CSSProperties = { boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif" };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }) : '—');

/** The call block list: see who is blocked, add a number by hand, remove one. */
export default function BlockedNumbersPanel({ authToken, businessUnit, showToast, onChanged }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');
  const [unit, setUnit] = useState<string>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/crm/call-blocklist', { headers: auth(authToken) });
      const j = await r.json();
      setRows(r.ok && Array.isArray(j.blocked) ? j.blocked : []);
      if (!r.ok) showToast?.(j.error || 'Could not load the block list');
    } catch { setRows([]); }
  }, [authToken, showToast]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!number.trim()) return;
    setBusy('add');
    try {
      const r = await fetch('/api/crm/call-blocklist', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(authToken) }, body: JSON.stringify({ number, reason, business_unit: unit }) });
      const j = await r.json();
      if (!r.ok) { showToast?.(j.error || 'Could not block that number'); return; }
      showToast?.(j.created ? `Blocked ${prettyPhone(number)}` : 'Already blocked');
      setNumber(''); setReason(''); await load(); onChanged?.();
    } finally { setBusy(null); }
  };
  const remove = async (b: Row) => {
    setBusy(b.id);
    try {
      const r = await fetch(`/api/crm/call-blocklist?id=${b.id}`, { method: 'DELETE', headers: auth(authToken) });
      if (!r.ok) { showToast?.((await r.json().catch(() => ({}))).error || 'Could not unblock'); return; }
      showToast?.(`Unblocked ${prettyPhone(b.phone_e164)}`);
      await load(); onChanged?.();
    } finally { setBusy(null); }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #eef0f2', borderRadius: 12, padding: 16, marginBottom: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 4 }}>🚫 Blocked numbers</div>
      <p style={{ fontSize: 12.5, color: '#6b7280', margin: '0 0 12px' }}>
        A blocked caller who reaches the AI receptionist hears a short goodbye and is hung up on — no message, no call-back, no email. The attempt still shows in the log.
        The bot adds spam robocalls here by itself (never saved contacts or team numbers). Callers are matched by their last 10 digits, however the number is formatted.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={number} onChange={e => setNumber(e.target.value)} placeholder="(210) 555-0123" inputMode="tel" style={{ ...field, flex: '1 1 150px' }} aria-label="Phone number to block" />
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" style={{ ...field, flex: '2 1 180px' }} aria-label="Reason" />
        <select value={unit} onChange={e => setUnit(e.target.value)} style={{ ...field, flex: '0 1 150px' }} aria-label="Which line">
          <option value="all">All lines</option>
          <option value="commercial">CRECO line only</option>
          <option value="residential">Fair Oaks line only</option>
        </select>
        <button onClick={add} disabled={busy === 'add' || !number.trim()} style={{ ...btn, background: '#111', color: '#fff', border: 'none' }}>{busy === 'add' ? 'Blocking…' : 'Block number'}</button>
      </div>
      {rows === null ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>
        : rows.length === 0 ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Nothing blocked yet.</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>{['Number', 'Line', 'Reason', 'Added', 'Turned away', ''].map(h => <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: .4, padding: '4px 6px' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(b => (
                  <tr key={b.id}>
                    <td style={{ ...cell, fontWeight: 700, whiteSpace: 'nowrap' }}>{prettyPhone(b.phone_e164)}</td>
                    <td style={cell}>{b.business_unit === 'all' ? 'All' : b.business_unit === 'residential' ? 'Fair Oaks' : 'CRECO'}</td>
                    <td style={cell}>
                      <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 7px', marginRight: 6, color: b.source === 'auto' ? '#6d28d9' : '#374151', background: b.source === 'auto' ? '#ede9fe' : '#f3f4f6' }}>{b.source === 'auto' ? '🤖 Auto' : 'Manual'}</span>
                      {b.reason || <span style={{ color: '#9ca3af' }}>—</span>}
                    </td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{day(b.created_at)}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{b.hits}{b.last_blocked_at ? ` · last ${day(b.last_blocked_at)}` : ''}</td>
                    <td style={{ ...cell, textAlign: 'right' }}><button onClick={() => remove(b)} disabled={busy === b.id} style={btn}>{busy === b.id ? '…' : 'Unblock'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
