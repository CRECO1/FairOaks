'use client';
// Wrap-up queue: walks through the answered calls that still need a note, one at a time —
// what happened, who was on it, whether they've called before — and saves with one tap
// (outcome + optional note, reusing the same panel as a single wrap-up), then moves on.
import React, { useMemo, useState } from 'react';
import CallWrapUp from '@/components/crm/CallWrapUp';
import type { CallRow } from '@/components/crm/CallingLog';

interface Props {
  calls: CallRow[];
  authToken?: string;
  businessUnit: string;
  isMobile: boolean;
  showToast?: (m: string) => void;
  /** A call was wrapped up — update it in the parent's list. */
  onSaved: (id: string, patch: Partial<CallRow>) => void;
  onClose: () => void;
}

const pretty = (n: string | null | undefined) => {
  const d = String(n ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (n || 'Unknown number');
};
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dur = (s: number | null) => (s == null ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

export default function WrapUpQueue({ calls, authToken, businessUnit, isMobile, showToast, onSaved, onClose }: Props) {
  // Snapshot the queue when it opens (newest first — fresher calls are easier to remember),
  // so saving a call doesn't reshuffle the one you're looking at.
  const ids = useMemo(() => calls.map(c => c.id), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const [done, setDone] = useState(0);
  const byId = useMemo(() => new Map(calls.map(c => [c.id, c])), [calls]);
  const call = byId.get(ids[i]);
  const finished = i >= ids.length || !call;

  const advance = () => setI(x => x + 1);
  const num = call ? (call.direction === 'outbound' ? call.to_number : call.from_number) : null;
  const h = call?.history;

  return (
    <div className="crm-sheet" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 20 }} onClick={onClose}>
      <div className="crm-sheet-panel" style={{ background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : 16, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', padding: '16px 18px 22px', boxShadow: '0 24px 80px rgba(0,0,0,.3)', fontFamily: "'DM Sans',sans-serif" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>📝 Wrap-up queue</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>{finished ? `${done} of ${ids.length} wrapped up` : `Call ${i + 1} of ${ids.length} · ${done} done`}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, minWidth: 32, minHeight: 32 }}>×</button>
        </div>
        <div style={{ height: 4, background: '#f3f4f6', borderRadius: 2, marginBottom: 14, overflow: 'hidden' }}><div style={{ width: `${ids.length ? (Math.min(i, ids.length) / ids.length) * 100 : 100}%`, height: '100%', background: '#c9922c' }} /></div>

        {finished ? (
          <div style={{ textAlign: 'center', padding: '28px 0 8px' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginTop: 6 }}>{done === ids.length ? 'Every call has a note.' : `Done — ${ids.length - done} skipped.`}</div>
            <button onClick={onClose} style={{ marginTop: 14, fontSize: 13, fontWeight: 700, padding: '10px 18px', minHeight: 44, border: 'none', borderRadius: 8, background: '#c9922c', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
          </div>
        ) : (
          <>
            <div style={{ background: '#faf7ef', borderLeft: '3px solid #c9922c', borderRadius: 4, padding: '10px 12px', marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111', overflowWrap: 'anywhere' }}>{call!.contact?.name || call!.caller_name || pretty(num)}{call!.contact?.type ? <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}> · {call!.contact.type}</span> : null}</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                {call!.direction === 'outbound' ? 'Outbound' : 'Inbound'} · {when(call!.started_at)}{call!.duration_sec ? ` · ${dur(call!.duration_sec)}` : ''}{call!.answered_by_name ? ` · ${call!.answered_by_name.split(' ')[0]} answered` : ''}{(call!.contact || call!.caller_name) && num ? ` · ${pretty(num)}` : ''}
              </div>
              {h && <div style={{ fontSize: 12.5, color: '#4b5563', marginTop: 4 }}>🔁 {h.prior + 1}{h.prior + 1 === 2 ? 'nd' : h.prior + 1 === 3 ? 'rd' : 'th'} call · last {when(h.last.at)} — {h.last.label}{h.last.by ? ` (${h.last.by})` : ''}</div>}
              {call!.intent && <div style={{ fontSize: 12.5, color: '#a06a12', fontWeight: 600, marginTop: 4 }}>{call!.intent}</div>}
            </div>
            {/* key = the call, so the panel resets for each one */}
            <CallWrapUp
              key={call!.id}
              call={call!}
              authToken={authToken}
              businessUnit={businessUnit}
              showToast={showToast}
              onSaved={p => { onSaved(call!.id, p as Partial<CallRow>); setDone(d => d + 1); }}
              onClose={advance}
            />
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
              <button onClick={advance} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', minHeight: 36 }}>Skip this one</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
