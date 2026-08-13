'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

type Party = { role: string; name: string; order: number; status: string };
type SignData = { status: string; doc_url: string | null; title: string; signer: { name: string; role: string; email: string }; parties: Party[] };

const GOLD = '#c9922c';

export default function SignPage() {
  const params = useParams();
  const token = String((params as Record<string, string>)?.token ?? '');
  const [view, setView] = useState<'loading' | 'ready' | 'waiting' | 'done' | 'completed' | 'voided' | 'notfound' | 'signed' | 'error'>('loading');
  const [data, setData] = useState<SignData | null>(null);
  const [finalStatus, setFinalStatus] = useState('');
  const [typed, setTyped] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drew = useRef(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/sign/${token}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setView('notfound'); return; }
        setData(j);
        setTyped(j.signer?.name || '');
        setView(['ready', 'waiting', 'done', 'completed', 'voided'].includes(j.status) ? j.status : 'error');
      })
      .catch(() => setView('error'));
  }, [token]);

  useEffect(() => {
    if (view !== 'ready') return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    let drawing = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
    const down = (e: PointerEvent) => { drawing = true; drew.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); try { c.setPointerCapture(e.pointerId); } catch { } };
    const move = (e: PointerEvent) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
    const up = () => { drawing = false; };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up); c.addEventListener('pointerleave', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointerleave', up); };
  }, [view]);

  function clearSig() { const c = canvasRef.current; const ctx = c?.getContext('2d'); if (c && ctx) { ctx.clearRect(0, 0, c.width, c.height); drew.current = false; } }

  async function submit() {
    setErr('');
    if (!consent) { setErr('Please check the box to consent to sign electronically.'); return; }
    if (!typed.trim() && !drew.current) { setErr('Draw your signature above, or type your full name.'); return; }
    setSubmitting(true);
    const png = drew.current ? canvasRef.current?.toDataURL('image/png') : undefined;
    const res = await fetch(`/api/sign/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature_png: png, typed_name: typed, consent }) });
    const j = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) { setErr(j.error || 'Could not submit your signature. Please try again.'); return; }
    setFinalStatus(j.status || 'signed');
    setView('signed');
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f4f5f7', fontFamily: "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif", color: '#1a1a1a', padding: '0 0 48px' };
  const card: React.CSSProperties = { maxWidth: 720, margin: '0 auto', background: '#fff', borderRadius: 14, boxShadow: '0 6px 24px rgba(0,0,0,.06)', padding: 24 };
  const header = (
    <div style={{ borderBottom: `3px solid ${GOLD}`, background: '#fff' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: .5, color: GOLD }}>CRECO</span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>Secure e-signature</span>
      </div>
    </div>
  );

  const msg = (icon: string, title: string, body: string) => (
    <div style={wrap}>{header}<div style={{ padding: '40px 16px' }}><div style={{ ...card, textAlign: 'center', maxWidth: 480 }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>{icon}</div>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{title}</h1>
      <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.5, margin: 0 }}>{body}</p>
    </div></div></div>
  );

  if (view === 'loading') return msg('⏳', 'Loading…', 'Fetching your document.');
  if (view === 'notfound') return msg('🔍', 'Link not found', 'This signing link is invalid or has expired. Please contact your broker for a new one.');
  if (view === 'error') return msg('⚠️', 'Something went wrong', 'We couldn’t load this document. Please try the link again in a moment.');
  if (view === 'voided') return msg('🚫', 'Request canceled', 'This signature request was canceled by the sender.');
  if (view === 'waiting') return msg('⏱️', 'Waiting on a previous signer', 'It’s not your turn yet. We’ll email you the moment the document is ready for your signature.');
  if (view === 'done') return msg('✅', 'You’ve already signed', 'Your signature is on file. You’ll receive the fully executed copy once everyone has signed.');
  if (view === 'completed') return msg('🎉', 'Fully executed', `“${data?.title ?? 'This document'}” has been signed by all parties. A copy has been emailed to you.`);
  if (view === 'signed') return msg(finalStatus === 'completed' ? '🎉' : '✅', 'Signature recorded — thank you!', finalStatus === 'completed' ? 'All parties have now signed. The fully executed copy is on its way to your inbox.' : 'Your signature has been recorded. We’ll route the document to the next party and email you the final copy when it’s complete.');

  // view === 'ready'
  return (
    <div style={wrap}>
      {header}
      <div style={{ padding: '20px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>{data?.title ?? 'Document'}</h1>
          <span style={{ fontSize: 13, color: '#6b7280' }}>for {data?.signer?.name} · signing as <strong style={{ textTransform: 'capitalize' }}>{data?.signer?.role}</strong></span>
        </div>

        <div style={{ ...card, marginBottom: 16, padding: 0, overflow: 'hidden' }}>
          {data?.doc_url ? (
            <iframe title="Document" src={data.doc_url} style={{ width: '100%', height: 520, border: 'none', display: 'block' }} />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Document preview unavailable.</div>
          )}
          {data?.doc_url && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid #eef0f2', textAlign: 'center' }}>
              <a href={data.doc_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: GOLD, fontWeight: 600, textDecoration: 'none' }}>Open document in a new tab ↗</a>
            </div>
          )}
        </div>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: GOLD, marginBottom: 10 }}>Your signature</div>
          <div style={{ position: 'relative' }}>
            <canvas ref={canvasRef} width={640} height={180} style={{ width: '100%', height: 160, background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10, touchAction: 'none', cursor: 'crosshair' }} />
            <button onClick={clearSig} style={{ position: 'absolute', top: 8, right: 8, fontSize: 12, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>Clear</button>
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af', margin: '6px 2px 14px' }}>Draw above with your mouse or finger — or just type your full legal name below.</div>

          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Full legal name</label>
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Your full name"
            style={{ width: '100%', padding: '11px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 16, boxSizing: 'border-box', marginBottom: 14 }} />

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: '#374151', lineHeight: 1.5, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 3, accentColor: GOLD, width: 16, height: 16, flexShrink: 0 }} />
            <span>I agree to sign this document electronically, and I consent to the use of electronic records and signatures for this transaction (ESIGN/UETA). I have reviewed the document above.</span>
          </label>

          {err && <div style={{ background: '#fef2f2', color: '#dc2626', fontSize: 13, padding: '9px 12px', borderRadius: 8, marginBottom: 12 }}>{err}</div>}

          <button onClick={submit} disabled={submitting}
            style={{ width: '100%', padding: '14px 0', background: GOLD, color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Submitting…' : 'Adopt & Sign'}
          </button>

          {data && data.parties.length > 1 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f3f4f6', fontSize: 12, color: '#9ca3af' }}>
              Signing order: {data.parties.map(p => `${p.name} (${p.role})${p.status === 'signed' ? ' ✓' : ''}`).join('  →  ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
