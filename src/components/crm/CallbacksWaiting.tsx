'use client';
// Dashboard card: call-backs that have been waiting a day or more. The Call Queue already lists them, but only
// when someone opens that tab — a buyer who phoned and got the bot sat for 8 days without anyone looking.
import React, { useEffect, useState } from 'react';

interface Row {
  id: string; caller_name: string | null; from_number: string | null; callback_number: string | null;
  contact?: { id: string; name: string } | null; started_at: string; follow_up_due: string | null;
  follow_up_assignee: string | null; summary: string | null; handled_at?: string | null;
}
const STALE_MS = 24 * 3600_000;
const pretty = (n: string | null) => { const d = (n ?? '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (n ?? ''); };
function age(ms: number) { const h = Math.floor(ms / 3600_000); return h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`; }

export default function CallbacksWaiting({ authToken, userId, businessUnit, onOpen }: { authToken?: string; userId?: string; businessUnit: string; onOpen: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!authToken) return;
    let off = false;
    fetch(`/api/crm/calls?filter=follow_up&days=90&limit=200&business_unit=${businessUnit}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => (r.ok ? r.json() : { calls: [] })).then(j => { if (!off) setRows((j.calls ?? []) as Row[]); }).catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, [authToken, businessUnit]);
  const now = Date.now();
  const mine = (rows ?? []).filter(r => !r.handled_at && (!r.follow_up_assignee || r.follow_up_assignee === userId));
  const waiting = mine
    .map(r => ({ r, ms: now - new Date(r.follow_up_due && new Date(r.follow_up_due).getTime() < now ? r.follow_up_due : r.started_at).getTime() }))
    .filter(x => x.ms >= STALE_MS).sort((a, b) => b.ms - a.ms);
  if (!waiting.length) return null;
  return (
    <div style={{ background: 'var(--k-fef3c7)', border: '1px solid var(--k-fde68a)', borderRadius: 12, padding: '12px 14px', margin: '0 0 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14, color: 'var(--k-92400e)', flex: 1 }}>📞 {waiting.length} call-back{waiting.length === 1 ? '' : 's'} waiting a day or more</b>
        <button onClick={onOpen} style={{ fontSize: 12.5, fontWeight: 700, padding: '8px 14px', minHeight: 36, borderRadius: 16, border: '1px solid #c9922c', background: '#fff', color: '#92400e', cursor: 'pointer' }}>Open Call Queue</button>
      </div>
      {waiting.slice(0, 5).map(({ r, ms }) => (
        <div key={r.id} style={{ fontSize: 13, color: 'var(--k-374151)', padding: '3px 0', overflowWrap: 'anywhere' }}>
          <b>{r.contact?.name || r.caller_name || pretty(r.callback_number || r.from_number)}</b> · waiting {age(ms)}{r.summary ? ` — ${r.summary.slice(0, 90)}` : ''}
        </div>
      ))}
      {waiting.length > 5 && <div style={{ fontSize: 12, color: 'var(--k-6b7280)', marginTop: 2 }}>…and {waiting.length - 5} more</div>}
    </div>
  );
}
