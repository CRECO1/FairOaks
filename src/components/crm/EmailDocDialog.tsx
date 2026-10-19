'use client';
import { useEffect, useRef, useState } from 'react';

// "Email as attachment" for a saved document (crm_form_submissions). Prefills To / subject / body
// from /api/crm/doc-email, lets the agent edit, then sends the filled PDF through the Gmail route.

const INP: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontFamily: "'DM Sans',sans-serif", color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' };
const LBL: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4, display: 'block' };

interface Prefill { to: string; toName: string; subject: string; body: string; fileName: string; sizeBytes: number | null; hasContact: boolean }

export default function EmailDocDialog({ submissionId, token, onClose, onSent }: {
  submissionId: string;
  token?: string | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [pre, setPre] = useState<Prefill | null>(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const auth = token ? { Authorization: `Bearer ${token}` } : undefined;

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await fetch(`/api/crm/doc-email?submission_id=${encodeURIComponent(submissionId)}`, { headers: auth });
        const j = await r.json().catch(() => ({}));
        if (off) return;
        if (!r.ok) { setErr(j.error || 'Could not prepare the email'); return; }
        setPre(j); setTo(j.to || ''); setSubject(j.subject || '');
      } catch { if (!off) setErr('Could not prepare the email'); }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  useEffect(() => { if (pre && bodyRef.current) bodyRef.current.innerHTML = pre.body; }, [pre]);

  async function send() {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/crm/doc-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ?? {}) },
        body: JSON.stringify({ submission_id: submissionId, to: to.trim(), subject: subject.trim(), body: bodyRef.current?.innerHTML ?? '' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || `Send failed (${r.status})`); setBusy(false); return; }
      setDone(true); onSent?.();
      setTimeout(onClose, 1400);
    } catch { setErr('Send failed — check your connection'); setBusy(false); }
  }

  const mb = pre?.sizeBytes ? ` · ${(pre.sizeBytes / 1048576).toFixed(1)} MB` : '';
  return (
    <div className="crm-sheet" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.55)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div className="crm-sheet-panel" style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 600, padding: 20, boxShadow: '0 24px 64px rgba(0,0,0,.3)', fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 21, fontWeight: 700, margin: 0, color: '#111' }}>✉ Email as attachment</h3>
          <button onClick={onClose} disabled={busy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>
        {!pre && !err && <div style={{ color: '#6b7280', fontSize: 14, padding: '24px 0' }}>Preparing…</div>}
        {pre && (
          <>
            <label style={LBL}>To{pre.toName ? ` — ${pre.toName}` : ''}</label>
            <input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="client@example.com" style={{ ...INP, marginBottom: 12 }} />
            <label style={LBL}>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} style={{ ...INP, marginBottom: 12 }} />
            <label style={LBL}>Message</label>
            <div ref={bodyRef} contentEditable suppressContentEditableWarning
              style={{ ...INP, minHeight: 180, maxHeight: '38vh', overflowY: 'auto', lineHeight: 1.5, fontSize: 14 }} />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 13, color: '#374151', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', maxWidth: '100%' }}>
              <span>📎</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pre.fileName}{mb}</span>
            </div>
          </>
        )}
        {err && <div style={{ marginTop: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>{err}</div>}
        {done && <div style={{ marginTop: 12, color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontWeight: 700 }}>✓ Sent and logged on the deal.</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          <button onClick={send} disabled={busy || done || !pre || !to.trim() || !subject.trim()}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#c9922c', color: '#fff', fontWeight: 700, fontSize: 14, cursor: busy || done || !pre ? 'default' : 'pointer', opacity: busy || done || !pre || !to.trim() ? 0.6 : 1 }}>
            {busy ? 'Sending…' : 'Send email'}
          </button>
        </div>
      </div>
    </div>
  );
}
