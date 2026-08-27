'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Dancing_Script, Great_Vibes, Sacramento, Homemade_Apple, Caveat } from 'next/font/google';

// Five hands to adopt from, self-hosted by next/font (so no external font request has
// to survive the CSP, and there's no flash of a fallback face before the canvas draw).
const dancing = Dancing_Script({ subsets: ['latin'], weight: '600', display: 'block' });
const vibes = Great_Vibes({ subsets: ['latin'], weight: '400', display: 'block' });
const sacramento = Sacramento({ subsets: ['latin'], weight: '400', display: 'block' });
const homemade = Homemade_Apple({ subsets: ['latin'], weight: '400', display: 'block' });
const caveat = Caveat({ subsets: ['latin'], weight: '600', display: 'block' });

const STYLES = [
  { key: 'dancing', label: 'Flowing', family: dancing.style.fontFamily },
  { key: 'vibes', label: 'Formal', family: vibes.style.fontFamily },
  { key: 'sacramento', label: 'Classic', family: sacramento.style.fontFamily },
  { key: 'homemade', label: 'Handwritten', family: homemade.style.fontFamily },
  { key: 'caveat', label: 'Casual', family: caveat.style.fontFamily },
];

type Party = { role: string; name: string; order: number; status: string };
// A spot this signer has to confirm. Positions are page fractions, y measured from
// the top to the field's baseline — the same frame the editor placed them in.
type SignField = { id: string; page: number; fx: number; fy: number; fw: number; type: string };
type SignData = { status: string; doc_url: string | null; title: string; fields?: SignField[]; signer: { name: string; role: string; email: string }; parties: Party[] };
const typeLabel = (t: string) => t === 'signature' ? 'Sign' : t === 'initial' ? 'Initial' : 'Date';

const GOLD = '#c9922c';
const INK = '#0d1b4b';
const initialsOf = (n: string) => (n || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 4);

// Draw text in one of the adopted hands onto a transparent canvas and hand back a PNG
// — the same shape the drawn-signature path produces, so the server stores one thing.
async function renderHand(text: string, family: string, boxW: number, boxH: number): Promise<string | undefined> {
  const t = (text || '').trim();
  if (!t) return undefined;
  const dpr = 3;                                   // stamped small on the PDF; keep it crisp
  const c = document.createElement('canvas');
  c.width = boxW * dpr; c.height = boxH * dpr;
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.scale(dpr, dpr);
  let size = Math.floor(boxH * 0.62);
  const fit = () => { ctx.font = `${size}px ${family}`; return ctx.measureText(t).width; };
  await document.fonts.load(`${size}px ${family}`, t).catch(() => { });
  while (fit() > boxW - 12 && size > 9) size -= 1;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, 6, boxH / 2);
  return c.toDataURL('image/png');
}

// The document itself. The signed URL lives on Supabase, and the app's CSP is
// `frame-src 'self'` — an <iframe>/<embed> of it is blocked and renders blank, which
// is what signers were seeing. Rendering the pages with pdf.js keeps everything
// same-origin (fetch is allowed by connect-src) and shows a real preview.
function DocView({ url, fields = [], filled, onFill, activeId, signaturePng, initialsPng, dateStr }: {
  url: string;
  fields?: SignField[];
  filled?: Record<string, boolean>;
  onFill?: (f: SignField) => void;
  activeId?: string | null;
  signaturePng?: string;
  initialsPng?: string;
  dateStr?: string;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState('loading');
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data }).promise;
        const out: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: Math.min(1400, 900) / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
          const ctx = canvas.getContext('2d'); if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
          if (cancelled) return;
          out.push(canvas.toDataURL('image/jpeg', 0.85));
          // Paint progressively: page 1 shows while the rest are still rendering.
          setPages([...out]);
        }
        if (!cancelled) setState('ready');
      } catch (e) { if (!cancelled) { console.error('[sign] preview', e); setState('error'); } }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (state === 'error') {
    return (
      <div style={{ padding: 34, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
        We couldn’t display the document here.{' '}
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: GOLD, fontWeight: 700 }}>Open it in a new tab ↗</a>{' '}
        to read it before signing.
      </div>
    );
  }
  return (
    <div id="doc-scroll" style={{ maxHeight: '60vh', overflowY: 'auto', background: '#4b4f52', padding: 12 }}>
      {pages.map((src, i) => {
        const pageFields = fields.filter(f => (f.page || 1) === i + 1);
        return (
          <div key={i} style={{ position: 'relative', marginBottom: i === pages.length - 1 ? 0 : 12, boxShadow: '0 2px 10px rgba(0,0,0,.4)' }}>
            <img src={src} alt={`Page ${i + 1}`} style={{ display: 'block', width: '100%' }} />
            {pageFields.map(f => {
              const done = !!filled?.[f.id];
              const isNext = activeId === f.id;
              const img = f.type === 'signature' ? signaturePng : f.type === 'initial' ? initialsPng : undefined;
              return (
                <div key={f.id} id={`fld-${f.id}`}
                  onClick={() => !done && onFill?.(f)}
                  title={done ? 'Done' : `Click to ${typeLabel(f.type).toLowerCase()} here`}
                  style={{
                    position: 'absolute', left: `${f.fx * 100}%`, width: `${Math.max(f.fw * 100, 10)}%`,
                    top: `${f.fy * 100}%`, transform: 'translateY(-100%)',
                    height: f.type === 'date' ? 26 : 34, boxSizing: 'border-box', borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    cursor: done ? 'default' : 'pointer',
                    background: done ? 'rgba(255,255,255,.96)' : isNext ? '#c9922c' : 'rgba(201,146,44,.22)',
                    border: done ? '1px solid #d6d9de' : `2px solid ${GOLD}`,
                    boxShadow: isNext ? '0 0 0 4px rgba(201,146,44,.35)' : 'none',
                    transition: 'background .15s, box-shadow .15s',
                  }}>
                  {done
                    ? (img
                        ? <img src={img} alt="" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                        : <span style={{ fontSize: 12, color: INK, fontWeight: 600 }}>{dateStr}</span>)
                    : <span style={{ fontSize: 11.5, fontWeight: 800, color: isNext ? '#fff' : '#8a6d3b', whiteSpace: 'nowrap' }}>
                        {isNext ? `▶ ${typeLabel(f.type)} here` : typeLabel(f.type)}
                      </span>}
                </div>
              );
            })}
          </div>
        );
      })}
      {state === 'loading' && <div style={{ color: '#cbd5e1', textAlign: 'center', padding: pages.length ? '12px 0 4px' : 60, fontSize: 13 }}>Loading document…</div>}
    </div>
  );
}

export default function SignPage() {
  const params = useParams();
  const token = String((params as Record<string, string>)?.token ?? '');
  const [view, setView] = useState<'loading' | 'ready' | 'waiting' | 'done' | 'completed' | 'voided' | 'declined' | 'notfound' | 'signed' | 'error'>('loading');
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [data, setData] = useState<SignData | null>(null);
  const [finalStatus, setFinalStatus] = useState('');
  const [typed, setTyped] = useState('');
  const [initials, setInitials] = useState('');
  const [initialsEdited, setInitialsEdited] = useState(false);
  const [mode, setMode] = useState<'pick' | 'draw'>('pick');
  const [styleKey, setStyleKey] = useState(STYLES[0].key);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drew = useRef(false);

  // ── Guided signing ────────────────────────────────────────────────────────
  // Every spot the agent placed for this signer has to be clicked. Nothing is
  // applied wholesale: the signature only lands where the signer put it.
  const [filled, setFilled] = useState<Record<string, boolean>>({});
  const [adopted, setAdopted] = useState<{ signature?: string; initials?: string } | null>(null);
  const fields = useMemo(() => data?.fields ?? [], [data]);
  const remaining = useMemo(() => fields.filter(f => !filled[f.id]), [fields, filled]);
  const nextField = remaining[0] ?? null;
  const allDone = fields.length > 0 && remaining.length === 0;
  const dateStr = useMemo(() => new Date().toLocaleDateString('en-US'), []);

  const scrollToField = useCallback((id: string) => {
    const el = document.getElementById(`fld-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Turn the chosen hand into the images the page stamps into each spot, once.
  const adopt = useCallback(async () => {
    if (adopted) return adopted;
    const sig = mode === 'draw'
      ? (drew.current ? canvasRef.current?.toDataURL('image/png') : undefined)
      : await renderHand(typed, active.family, 640, 150);
    const ini = await renderHand(initials, active.family, 220, 150);
    const a = { signature: sig, initials: ini };
    setAdopted(a);
    return a;
  }, [adopted, mode, typed, initials]); // eslint-disable-line

  const fillField = useCallback(async (f: SignField) => {
    if (!typed.trim()) { setErr('Enter your full legal name first.'); return; }
    if (mode === 'draw' && !drew.current) { setErr('Draw your signature first, or choose a style.'); return; }
    setErr('');
    await adopt();
    setFilled(prev => ({ ...prev, [f.id]: true }));
    // Move them along to the next one without making them hunt for it.
    const rest = fields.filter(x => x.id !== f.id && !filled[x.id]);
    if (rest[0]) setTimeout(() => scrollToField(rest[0].id), 180);
  }, [typed, mode, adopt, fields, filled, scrollToField]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/sign/${token}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setView('notfound'); return; }
        setData(j);
        setTyped(j.signer?.name || '');
        setView(['ready', 'waiting', 'done', 'completed', 'voided', 'declined'].includes(j.status) ? j.status : 'error');
      })
      .catch(() => setView('error'));
  }, [token]);

  // Initials track the name until the signer types their own.
  useEffect(() => { if (!initialsEdited) setInitials(initialsOf(typed)); }, [typed, initialsEdited]);

  useEffect(() => {
    if (view !== 'ready' || mode !== 'draw') return;
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
  }, [view, mode]);

  function clearSig() { const c = canvasRef.current; const ctx = c?.getContext('2d'); if (c && ctx) { ctx.clearRect(0, 0, c.width, c.height); drew.current = false; } }

  const active = useMemo(() => STYLES.find(s => s.key === styleKey) ?? STYLES[0], [styleKey]);

  // Declining ends the request for everyone — the sender needs to know it is dead,
  // not merely slow. A reason is invited but never required; forcing one just
  // produces "n/a".
  const decline = useCallback(async () => {
    setSubmitting(true); setErr('');
    try {
      const r = await fetch(`/api/sign/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline', reason: declineReason }),
      });
      if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || 'Could not submit.'); return; }
      setView('declined');
    } catch { setErr('Could not reach the server. Check your connection and try again.'); }
    finally { setSubmitting(false); }
  }, [token, declineReason]);

  const submit = useCallback(async () => {
    setErr('');
    if (!consent) { setErr('Please check the box to consent to sign electronically.'); return; }
    if (!typed.trim()) { setErr('Enter your full legal name.'); return; }
    if (mode === 'draw' && !drew.current) { setErr('Draw your signature above, or switch to “Choose a style”.'); return; }
    if (fields.length && remaining.length) {
      setErr(`You still have ${remaining.length} spot${remaining.length === 1 ? '' : 's'} to confirm on the document.`);
      scrollToField(remaining[0].id);
      return;
    }
    setSubmitting(true);
    try {
      // Both paths hand the server a PNG, so the executed PDF stamps the signer's own
      // hand either way. Initials are always rendered in the adopted style. These are
      // the very images the signer already saw dropped into each spot.
      const a = await adopt();
      const signature_png = a.signature;
      const initials_png = a.initials;
      const res = await fetch(`/api/sign/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature_png, initials_png, typed_name: typed, signature_style: mode === 'draw' ? 'drawn' : active.key, consent }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'Could not submit your signature. Please try again.'); return; }
      setFinalStatus(j.status || 'signed');
      setView('signed');
    } finally { setSubmitting(false); }
  }, [consent, typed, initials, mode, active, token]);

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
  if (view === 'declined') return msg('✋', 'Declined', 'This document was declined and is no longer available to sign. The sender has been notified.');
  if (view === 'waiting') return msg('⏱️', 'Waiting on a previous signer', 'It’s not your turn yet. We’ll email you the moment the document is ready for your signature.');
  if (view === 'done') return msg('✅', 'You’ve already signed', 'Your signature is on file. You’ll receive the fully executed copy once everyone has signed.');
  if (view === 'completed') return msg('🎉', 'Fully executed', `“${data?.title ?? 'This document'}” has been signed by all parties. A copy has been emailed to you.`);
  if (view === 'signed') return msg(finalStatus === 'completed' ? '🎉' : '✅', 'Signature recorded — thank you!', finalStatus === 'completed' ? 'All parties have now signed. The fully executed copy is on its way to your inbox.' : 'Your signature has been recorded. We’ll route the document to the next party and email you the final copy when it’s complete.');

  // view === 'ready'
  const tab = (k: 'pick' | 'draw', label: string) => (
    <button onClick={() => setMode(k)}
      style={{ flex: 1, padding: '9px 0', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', border: 'none', borderRadius: 8,
        background: mode === k ? '#fff' : 'transparent', color: mode === k ? INK : '#6b7280', boxShadow: mode === k ? '0 1px 3px rgba(0,0,0,.12)' : 'none' }}>
      {label}
    </button>
  );

  return (
    <div style={wrap}>
      {header}
      <div style={{ padding: '20px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>{data?.title ?? 'Document'}</h1>
          <span style={{ fontSize: 13, color: '#6b7280' }}>for {data?.signer?.name} · signing as <strong style={{ textTransform: 'capitalize' }}>{data?.signer?.role}</strong></span>
        </div>

        <div style={{ ...card, marginBottom: 16, padding: 0, overflow: 'hidden' }}>
          {data?.doc_url
            ? <DocView url={data.doc_url} fields={fields} filled={filled} onFill={fillField}
                activeId={nextField?.id ?? null}
                signaturePng={adopted?.signature} initialsPng={adopted?.initials} dateStr={dateStr} />
            : <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Document preview unavailable.</div>}
          {fields.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: '1px solid #eef0f2', background: allDone ? '#ecfdf5' : '#fffdf6', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: allDone ? '#15803d' : '#7c5a12' }}>
                {allDone ? `✓ All ${fields.length} spot${fields.length === 1 ? '' : 's'} confirmed` : `${fields.length - remaining.length} of ${fields.length} confirmed`}
              </span>
              <span style={{ flex: 1 }} />
              {!allDone && (
                <button onClick={() => nextField && scrollToField(nextField.id)}
                  style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: GOLD, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>
                  {Object.keys(filled).length ? `Next — ${typeLabel(nextField?.type ?? 'signature')} ▸` : 'Start signing ▸'}
                </button>
              )}
            </div>
          )}
          {data?.doc_url && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid #eef0f2', textAlign: 'center' }}>
              <a href={data.doc_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: GOLD, fontWeight: 600, textDecoration: 'none' }}>Open document in a new tab ↗</a>
            </div>
          )}
        </div>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: GOLD, marginBottom: 12 }}>Adopt your signature</div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: '2 1 260px', minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Full legal name</label>
              <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Your full name"
                style={{ width: '100%', padding: '11px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: '1 1 110px', minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Initials</label>
              <input value={initials} onChange={e => { setInitialsEdited(true); setInitials(e.target.value.slice(0, 4)); }} placeholder="ABC"
                style={{ width: '100%', padding: '11px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4, background: '#f1f2f4', borderRadius: 10, padding: 4, marginBottom: 14 }}>
            {tab('pick', '✍️  Choose a style')}
            {tab('draw', '🖊  Draw it yourself')}
          </div>

          {mode === 'pick' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(288px,1fr))', gap: 10 }}>
                {STYLES.map(s => {
                  const on = s.key === styleKey;
                  return (
                    <button key={s.key} onClick={() => setStyleKey(s.key)}
                      style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', background: on ? '#fffdf6' : '#fff',
                        border: on ? `2px solid ${GOLD}` : '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                      <span style={{ flex: 1, minWidth: 0, fontFamily: s.family, fontSize: 23, color: INK, lineHeight: 1.55, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {typed.trim() || 'Your name'}
                      </span>
                      <span style={{ flexShrink: 0, fontFamily: s.family, fontSize: 20, color: INK, opacity: .75, borderLeft: '1px solid #eef0f2', paddingLeft: 10 }}>
                        {initials || 'AB'}
                      </span>
                      {on && <span style={{ flexShrink: 0, color: GOLD, fontSize: 14, fontWeight: 800 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', margin: '10px 2px 16px' }}>
                Pick the hand you want. It’s used for your signature <em>and</em> your initials wherever the document asks for them.
              </div>
            </>
          ) : (
            <>
              <div style={{ position: 'relative' }}>
                <canvas ref={canvasRef} width={640} height={180} style={{ width: '100%', height: 160, background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10, touchAction: 'none', cursor: 'crosshair' }} />
                <button onClick={clearSig} style={{ position: 'absolute', top: 8, right: 8, fontSize: 12, color: '#6b7280', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>Clear</button>
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', margin: '6px 2px 16px' }}>
                Draw above with your mouse or finger. Your initials use the <strong>{active.label}</strong> style.
              </div>
            </>
          )}

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: '#374151', lineHeight: 1.5, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 3, accentColor: GOLD, width: 16, height: 16, flexShrink: 0 }} />
            <span>I agree to sign this document electronically, and I consent to the use of electronic records and signatures for this transaction (ESIGN/UETA). I have reviewed the document above.</span>
          </label>

          {err && <div style={{ background: '#fef2f2', color: '#dc2626', fontSize: 13, padding: '9px 12px', borderRadius: 8, marginBottom: 12 }}>{err}</div>}

          <button onClick={submit} disabled={submitting}
            style={{ width: '100%', padding: '14px 0', background: GOLD, color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Submitting…'
              : fields.length && remaining.length ? `${remaining.length} spot${remaining.length === 1 ? '' : 's'} left to confirm`
              : 'Finish & Sign'}
          </button>

          {!declining ? (
            <button onClick={() => setDeclining(true)} disabled={submitting}
              style={{ width: '100%', marginTop: 10, padding: '10px 0', background: 'none', color: '#9ca3af', border: 'none', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
              I can’t sign this
            </button>
          ) : (
            <div style={{ marginTop: 14, padding: 14, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Decline to sign?</div>
              <div style={{ fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.5, marginBottom: 10 }}>
                This cancels the request for everyone and notifies the sender. It can’t be undone — a new request would have to be sent.
              </div>
              <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3}
                placeholder="What’s the problem? (optional, but it helps)"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setDeclining(false); setDeclineReason(''); }} disabled={submitting}
                  style={{ flex: 1, padding: '10px 0', background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  Never mind
                </button>
                <button onClick={decline} disabled={submitting}
                  style={{ flex: 1, padding: '10px 0', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? '…' : 'Decline'}
                </button>
              </div>
            </div>
          )}

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
