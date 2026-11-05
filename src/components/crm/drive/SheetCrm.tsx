'use client';

import React, { useMemo, useState } from 'react';
import { Modal } from './SheetParts';

/**
 * "Send rows to the CRM": turns the selected rows of a sheet (a tenant list, a call tracker) into CRM contacts and, if asked, a call task
 * for each. Columns are matched to Name / Email / Phone / Company / Notes from the header row; people already in the CRM (same email or
 * phone) are not duplicated, but still get the call task.
 */

const FIELDS = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['company', 'Company'], ['notes', 'Notes']] as const;
type Field = typeof FIELDS[number][0];
const GUESS: Record<Field, RegExp> = {
  name: /^(contact|name|full name|tenant|owner|decision.?maker|ask for|person)/i,
  email: /e-?mail/i,
  phone: /phone|cell|mobile|tel/i,
  company: /company|business|tenant|practice|firm|organi[sz]ation/i,
  notes: /note|comment|status|detail/i,
};
const lab: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--k-6b7280)', margin: '10px 0 4px' };
const sel: React.CSSProperties = { width: '100%', height: 36, border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '0 8px', fontSize: 14, background: 'var(--k-fff)' };

export default function SendToCrmDialog({ text, rows, ncols, authToken, onClose, onToast, onDone }: {
  /** Display text of a cell. */
  text: (r: number, c: number) => string;
  /** The sheet rows (0-based, header row 0 excluded) to send. */
  rows: number[];
  ncols: number;
  authToken?: string;
  onClose: () => void;
  onToast: (m: string) => void;
  onDone?: () => void;
}) {
  const heads = useMemo(() => Array.from({ length: ncols }, (_, c) => text(0, c).trim()), [text, ncols]);
  const [map, setMap] = useState<Record<Field, number>>(() => {
    const m: Record<Field, number> = { name: -1, email: -1, phone: -1, company: -1, notes: -1 };
    const used = new Set<number>();
    for (const [f] of FIELDS) { const c = heads.findIndex((h, i) => h && !used.has(i) && GUESS[f].test(h)); if (c >= 0) { m[f] = c; used.add(c); } }
    return m;
  });
  const [task, setTask] = useState(true);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [due, setDue] = useState(tomorrow);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const people = useMemo(() => rows.map(r => {
    const o: Record<Field, string> = { name: '', email: '', phone: '', company: '', notes: '' };
    for (const [f] of FIELDS) if (map[f] >= 0) o[f] = text(r, map[f]).trim();
    return o;
  }).filter(o => o.name || o.email || o.phone || o.company), [rows, map, text]);

  const send = async () => {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/crm/drive/sheet-to-crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ people, task: task ? { due } : null }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string; created?: number; existing?: number; tasks?: number };
      if (!res.ok) throw new Error(j.error || 'Could not send these rows');
      onToast(`${j.created ?? 0} new contact${j.created === 1 ? '' : 's'}${j.existing ? `, ${j.existing} already in the CRM` : ''}${task ? `, ${j.tasks ?? 0} call task${j.tasks === 1 ? '' : 's'}` : ''}`);
      onDone?.(); onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <Modal title="Send rows to the CRM" onClose={onClose} wide>
      <div style={{ fontSize: 13.5, color: 'var(--k-374151)' }}>{people.length} row{people.length === 1 ? '' : 's'} will be added as CRM contacts. Match your columns:</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        {FIELDS.map(([f, label]) => (
          <div key={f}>
            <label style={lab}>{label}</label>
            <select value={map[f]} onChange={e => setMap(m => ({ ...m, [f]: Number(e.target.value) }))} style={sel}>
              <option value={-1}>— none —</option>
              {heads.map((h, c) => h ? <option key={c} value={c}>{h}</option> : null)}
            </select>
          </div>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={task} onChange={e => setTask(e.target.checked)} /> Also add a call task for each, due
        <input type="date" value={due} onChange={e => setDue(e.target.value)} disabled={!task} style={{ ...sel, width: 150, height: 32 }} />
      </label>
      {people.length > 0 && (
        <div style={{ marginTop: 12, border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: 12.5, maxHeight: 130, overflow: 'auto' }}>
          {people.slice(0, 5).map((p, i) => <div key={i} style={{ padding: '5px 10px', borderBottom: '1px solid var(--k-f3f4f6)' }}><b>{p.name || p.company || p.email}</b> <span style={{ color: 'var(--k-6b7280)' }}>{[p.company && p.name ? p.company : '', p.email, p.phone].filter(Boolean).join(' · ')}</span></div>)}
          {people.length > 5 && <div style={{ padding: '5px 10px', color: 'var(--k-6b7280)' }}>…and {people.length - 5} more</div>}
        </div>
      )}
      {err && <div role="alert" style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={onClose} style={{ height: 38, padding: '0 14px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={send} disabled={busy || !people.length} style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 8, background: '#c9922c', color: '#fff', fontWeight: 700, cursor: busy || !people.length ? 'default' : 'pointer', opacity: busy || !people.length ? 0.6 : 1 }}>{busy ? 'Sending…' : `Send ${people.length}`}</button>
      </div>
    </Modal>
  );
}
