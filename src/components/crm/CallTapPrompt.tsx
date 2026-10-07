'use client';
// "How'd the call go?" — asks, in one tap, after you tap any phone number in the CRM and
// come back. A document-level listener catches every <a href="tel:…"> (so buttons added
// later are covered), pulls context from data-name / data-contact-id / data-call-id /
// data-pending when the link carries it, and otherwise matches the number to a contact.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clearPendingCall, readPendingCall, writePendingCall, type PendingCall } from '@/lib/call-tap';

interface Props {
  businessUnit: string;
  authToken?: string;
  isMobile: boolean;
  /** True where the page runs its own call flow (Today's Calls dialer) — no double prompt. */
  suppress: boolean;
  findByPhone: (digits10: string) => { id: string; name: string } | null;
  showToast?: (m: string) => void;
}

const OUTCOMES = [
  { k: 'answered', label: 'Talked to them', icon: '✅', bg: '#dcfce7', fg: '#166534' },
  { k: 'left_voicemail', label: 'Left a voicemail', icon: '📬', bg: '#fef3c7', fg: '#92400e' },
  { k: 'no_answer', label: 'No answer', icon: '📵', bg: '#f3f4f6', fg: '#374151' },
  { k: 'wrong_number', label: 'Wrong number', icon: '❌', bg: '#fee2e2', fg: '#991b1b' },
] as const;

const digits10 = (s: string) => s.replace(/\D/g, '').slice(-10);
const pretty = (d: string) => (d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);
type Retry = 'none' | 'hour' | 'tmrw';
function retryAt(kind: Retry): string | null {
  if (kind === 'none') return null;
  const d = new Date();
  if (kind === 'hour') d.setTime(d.getTime() + 3600_000);
  else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  return d.toISOString();
}

export default function CallTapPrompt({ businessUnit, authToken, isMobile, suppress, findByPhone, showToast }: Props) {
  const [pending, setPending] = useState<PendingCall | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [retry, setRetry] = useState<Retry>('none');
  const [busy, setBusy] = useState(false);
  const suppressRef = useRef(suppress); suppressRef.current = suppress;
  const findRef = useRef(findByPhone); findRef.current = findByPhone;
  const awaySince = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A call tapped before a reload (a phone often reloads the tab on return) still gets asked about.
    const p = readPendingCall();
    if (p) { setPending(p); const t = setTimeout(() => setOpen(true), 1500); return () => clearTimeout(t); }
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (suppressRef.current) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href^="tel:"]') as HTMLAnchorElement | null;
      if (!a) return;
      let num = '';
      try { num = digits10(decodeURIComponent(a.getAttribute('href')!.slice(4))); } catch { return; }
      if (num.length !== 10) return;
      const known = findRef.current(num);
      const p: PendingCall = {
        number: num, name: a.dataset.name || known?.name || null, contact_id: a.dataset.contactId || known?.id || null,
        call_id: a.dataset.callId || null, pending: a.dataset.pending === '1', at: Date.now(),
      };
      writePendingCall(p); setPending(p); setOpen(false); setNote(''); setRetry('none'); awaySince.current = null;
      // On a desktop the CRM tab may never lose focus; ask after a short while anyway.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (readPendingCall()?.at === p.at) setOpen(true); }, 25_000);
    };
    const hide = () => { if (awaySince.current == null) awaySince.current = Date.now(); };
    const show = () => {
      const p = readPendingCall(); if (!p) return;
      const away = awaySince.current ? Date.now() - awaySince.current : 0;
      awaySince.current = null;
      if (away >= 3000 || Date.now() - p.at >= 8000) { setPending(p); setOpen(true); }
    };
    const vis = () => (document.visibilityState === 'hidden' ? hide() : show());
    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    return () => {
      document.removeEventListener('click', onClick, true); document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', hide); window.removeEventListener('focus', show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const dismiss = useCallback(() => { clearPendingCall(); setPending(null); setOpen(false); setNote(''); setRetry('none'); }, []);

  async function save(outcome: typeof OUTCOMES[number]['k']) {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const elapsed = Math.max(0, Math.round((Date.now() - pending.at) / 1000));
      const r = await fetch('/api/crm/calls', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({
          business_unit: businessUnit, direction: 'outbound', number: pending.number, caller_name: pending.name, contact_id: pending.contact_id,
          result: outcome, duration_sec: outcome === 'answered' ? Math.min(elapsed, 3600) : null, notes: note.trim() || null,
          started_at: new Date(pending.at).toISOString(), resolves_call_id: pending.call_id,
          retry_at: outcome === 'left_voicemail' || outcome === 'no_answer' ? retryAt(retry) : null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast?.(j.error || 'Could not log the call'); return; }
      showToast?.(outcome === 'answered' ? 'Call logged ✓' : outcome === 'wrong_number' ? 'Logged as a wrong number' : retry !== 'none' ? 'Logged — reminder set ✓' : 'Call logged ✓');
      dismiss();
      window.dispatchEvent(new Event('crm:calls-changed'));   // the Calling Log refreshes itself
    } finally { setBusy(false); }
  }

  if (!pending || !open) return null;
  const title = pending.name || pretty(pending.number);
  const chip = (k: Retry, label: string) => (
    <button key={k} onClick={() => setRetry(k)} style={{ fontSize: 12.5, fontWeight: 700, padding: '8px 12px', minHeight: 36, borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", border: '1px solid', borderColor: retry === k ? '#c9922c' : '#e5e7eb', background: retry === k ? '#fffdf6' : '#fff', color: retry === k ? '#a06a12' : '#6b7280' }}>{label}</button>
  );
  return (
    <div className="crm-sheet" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1100, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 20 }} onClick={dismiss}>
      <div className="crm-sheet-panel" style={{ background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : 16, width: '100%', maxWidth: 440, padding: isMobile ? '18px 18px 78px' : '18px 18px 20px', boxShadow: '0 24px 80px rgba(0,0,0,.3)', fontFamily: "'DM Sans',sans-serif" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>How did the call go?</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2, overflowWrap: 'anywhere' }}>📞 {title}{pending.name ? ` · ${pretty(pending.number)}` : ''}</div>
          </div>
          <button onClick={dismiss} aria-label="Skip" style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, minWidth: 32, minHeight: 32 }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {OUTCOMES.map(o => (
            <button key={o.k} disabled={busy} onClick={() => save(o.k)} style={{ background: o.bg, color: o.fg, border: 'none', borderRadius: 10, padding: '14px 10px', minHeight: 56, fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: "'DM Sans',sans-serif", lineHeight: 1.25 }}>
              <span aria-hidden="true" style={{ display: 'block', fontSize: 18, marginBottom: 2 }}>{o.icon}</span>{o.label}
            </button>
          ))}
        </div>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional) — type it, then tap what happened" style={{ width: '100%', boxSizing: 'border-box', minHeight: 54, padding: '9px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13.5, fontFamily: "'DM Sans',sans-serif", marginBottom: 10 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>If no answer / voicemail, remind me to try again:</span>
          {chip('none', 'No reminder')}{chip('hour', 'In 1 hour')}{chip('tmrw', 'Tomorrow 9a')}
        </div>
        {pending.pending && <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 10 }}>This returns a call-back from the Calling Log — “Talked to them” marks it handled.</div>}
      </div>
    </div>
  );
}
