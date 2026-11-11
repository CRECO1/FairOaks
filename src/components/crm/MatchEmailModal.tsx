'use client';

/**
 * MatchEmailModal — read the Matchmaker email before it goes anywhere.
 *
 * Opens on the listings the agent is looking at, writes the email on the server (POST /api/crm/matchmaker/email, preview only),
 * shows it exactly as it will arrive, and sends only when the agent presses the button:
 *   audience 'agent'  — a copy to the agent's own inbox.
 *   audience 'client' — to the tenant, from the agent's own Gmail (their signature, logged on the contact).
 * Uses the CRM's .overlay / .modal classes, so on a phone it is a bottom sheet like every other dialog.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FIT_LABEL, propertyLine, possessive, EMAIL_MIN_SCORE, type MatchResult } from '@/lib/matchmaker/match';

export interface MailTenant { id: string; name: string; firstName: string | null; email: string | null }
interface Preview { subject: string; html: string; to: string | null; count: number }

export default function MatchEmailModal({ audience, tenant, candidates, authToken, isMobile, onClose, onSent, onToast }: {
  audience: 'agent' | 'client'; tenant: MailTenant; candidates: MatchResult[]; authToken?: string; isMobile: boolean;
  onClose: () => void; onSent: (info: { audience: 'agent' | 'client'; to: string; propertyIds: string[] }) => void; onToast: (m: string) => void;
}) {
  const initial = useMemo(() => {
    const good = candidates.filter(r => r.score >= EMAIL_MIN_SCORE).slice(0, 6);
    return new Set((good.length ? good : candidates.slice(0, 3)).map(r => r.property.id));
  }, [candidates]);
  const [picked, setPicked] = useState<Set<string>>(initial);
  const [note, setNote] = useState('');
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const ids = useMemo(() => candidates.filter(r => picked.has(r.property.id)).map(r => r.property.id), [candidates, picked]);
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }), [authToken]);
  const seq = useRef(0);

  // Re-write the preview a moment after the picks or the note change.
  useEffect(() => {
    if (!ids.length) { setPv(null); setErr('Tick at least one listing.'); setLoading(false); return; }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/crm/matchmaker/email', { method: 'POST', headers, body: JSON.stringify({ client_id: tenant.id, audience, property_ids: ids, note: audience === 'client' ? note : undefined }) });
        const j = await r.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (!r.ok) { setPv(null); setErr(j.error || 'Could not write the email.'); }
        else { setPv({ subject: j.subject, html: j.html, to: j.to, count: j.count }); setErr(null); }
      } catch { if (mine === seq.current) { setPv(null); setErr('Could not reach the server.'); } }
      if (mine === seq.current) setLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [ids, note, audience, tenant.id, headers]);

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, sending]);

  async function send() {
    if (!pv || sending) return;
    setSending(true);
    try {
      const r = await fetch('/api/crm/matchmaker/email', { method: 'POST', headers, body: JSON.stringify({ client_id: tenant.id, audience, property_ids: ids, note: audience === 'client' ? note : undefined, send: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { onToast(j.error || 'Could not send the email'); setSending(false); return; }
      onToast(audience === 'agent' ? 'Sent to your inbox ✓' : `Sent to ${j.to} ✓`);
      onSent({ audience, to: j.to, propertyIds: ids });
      onClose();
    } catch { onToast('Could not send the email'); setSending(false); }
  }

  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chip = (fit: MatchResult['fit']): React.CSSProperties => ({ fontSize: 10.5, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 10, flexShrink: 0, background: fit === 'strong' ? '#c9922c' : fit === 'good' ? '#f3e9d2' : 'var(--k-f3f4f6)', color: fit === 'strong' ? '#1a1a1a' : fit === 'good' ? '#6b4a0e' : 'var(--k-6b7280)' });
  const who = audience === 'agent' ? 'me' : tenant.firstName || tenant.name;

  return (
    <div className="overlay" onClick={() => { if (!sending) onClose(); }} style={{ zIndex: 1300 }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 880, fontFamily: "'DM Sans',sans-serif", display: 'flex', flexDirection: 'column', maxHeight: isMobile ? undefined : '90vh' }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--k-eef0f2)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--k-111)' }}>Email these matches to {who}</div>
            <div style={{ fontSize: 12.5, color: 'var(--k-6b7280)', marginTop: 3, lineHeight: 1.5 }}>
              {audience === 'client'
                ? <>Goes from <b>your Gmail</b> to <b>{pv?.to || tenant.email || '—'}</b>, with your signature. It is saved on {possessive(tenant.name)} card. <b>Nothing is sent until you press Send.</b></>
                : <>A copy for <b>your inbox</b> ({pv?.to || '…'}) — handy to read on your phone or forward. <b>Nothing goes to {tenant.name}.</b></>}
            </div>
          </div>
          <button onClick={onClose} disabled={sending} aria-label="Close" style={{ width: isMobile ? 44 : 32, height: isMobile ? 44 : 32, border: 'none', borderRadius: 8, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '14px 20px', display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(250px, 300px) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 8 }}>Listings to include ({ids.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: isMobile ? 220 : 360, overflowY: 'auto' }}>
              {candidates.map(r => {
                const p = r.property, on = picked.has(p.id);
                return (
                  <label key={p.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '8px 10px', border: `1px solid ${on ? '#c9922c' : 'var(--k-e5e7eb)'}`, borderRadius: 8, background: on ? 'var(--k-fdf6e8)' : 'var(--k-fff)', cursor: 'pointer', minHeight: isMobile ? 44 : undefined, flexShrink: 0 }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} style={{ marginTop: 3, accentColor: '#c9922c', width: 16, height: 16, flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><span style={chip(r.fit)}>{FIT_LABEL[r.fit]}</span></span>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--k-111)', marginTop: 3, overflowWrap: 'anywhere' }}>{p.address || p.name || 'Property'}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--k-6b7280)', marginTop: 1 }}>{propertyLine(p)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {audience === 'client' && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 6 }}>Your note to {tenant.firstName || tenant.name} (optional)</div>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder={`Hi ${tenant.firstName || 'there'}, …  (leave blank for a short standard intro)`}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, fontSize: isMobile ? 16 : 13.5, fontFamily: "'DM Sans',sans-serif", resize: 'vertical' }} />
              </div>
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--k-9ca3af)', fontWeight: 700, marginBottom: 6 }}>How it will look</div>
            <div style={{ fontSize: 13, color: 'var(--k-374151)', marginBottom: 8 }}>
              <b>Subject:</b> {loading && !pv ? 'Writing…' : pv?.subject || '—'}
            </div>
            {err && <div style={{ padding: 14, border: '1px solid #f3d9b5', background: '#fff8ec', color: '#8a5a0b', borderRadius: 8, fontSize: 13 }}>{err}</div>}
            {!err && (
              <div style={{ position: 'relative', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, overflow: 'hidden', background: '#f4f4f5', opacity: loading ? .55 : 1, transition: 'opacity .15s' }}>
                {pv
                  ? <iframe title="Email preview" sandbox="" srcDoc={pv.html} style={{ width: '100%', height: isMobile ? 420 : 500, border: 'none', display: 'block', background: '#f4f4f5' }} />
                  : <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--k-9ca3af)', fontSize: 13 }}>Writing the email…</div>}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--k-eef0f2)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', paddingBottom: isMobile ? 'max(12px, env(safe-area-inset-bottom))' : 12 }}>
          <button onClick={onClose} disabled={sending} style={{ minHeight: isMobile ? 46 : 38, padding: '0 18px', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
          <button onClick={send} disabled={!pv || !!err || loading || sending || (audience === 'client' && !pv?.to)}
            style={{ minHeight: isMobile ? 46 : 38, padding: '0 20px', border: 'none', borderRadius: 8, background: '#c9922c', color: '#fff', fontSize: 14, fontWeight: 700, cursor: !pv || !!err || loading || sending ? 'default' : 'pointer', opacity: !pv || !!err || loading || sending ? .55 : 1, fontFamily: "'DM Sans',sans-serif" }}>
            {sending ? 'Sending…' : audience === 'agent' ? 'Email me these' : `Send to ${tenant.firstName || tenant.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}
