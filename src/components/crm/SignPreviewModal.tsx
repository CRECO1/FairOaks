'use client';

import React, { useEffect, useState } from 'react';

// Review-before-send preview: renders the document's pages and overlays a labeled
// marker at each placed signature field — so the agent can SEE who signs where
// before a send OR a resend (no blind sends). Canvas render sidesteps the app CSP
// that blocks iframing PDFs; markers are positioned in % so they scale with the page.
export interface PreviewField { page?: number; fx: number; fy: number; fw: number; type?: string; signerRole?: string; signerIndex?: number | null }
// The actual people, in signing order. Given these, a field is labelled with the
// NAME of whoever signs it — two clients on one document read as two people.
export interface PreviewSigner { name: string; role?: string; color?: string }

const ROLE_COLORS: Record<string, string> = { client: '#c9922c', landlord: '#2563eb', agent: '#16a34a', seller: '#c9922c', buyer: '#7c3aed', witness: '#db2777', other: '#6b7280' };
const typeLabel = (t?: string) => t === 'signature' ? 'Signature' : t === 'initial' ? 'Initials' : (t === 'date' || t === 'date_signed') ? 'Date' : (t || 'Field');

export default function SignPreviewModal({ url, fields, signerLabel, signers, onClose, onConfirm, confirmLabel = 'Send', busy }: {
  url: string;
  fields: PreviewField[];
  signerLabel?: (role: string) => string;
  signers?: PreviewSigner[];
  onClose: () => void;
  // When given, this is the last step before a document goes out: the review carries
  // the send button itself, so nothing is sent without the agent seeing the placements.
  onConfirm?: () => void;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const [pages, setPages] = useState<{ w: number; h: number; src: string }[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'nofile' | 'encrypted'>('loading');
  // On a phone the review is a full-screen sheet with the send button pinned to the
  // bottom, instead of a toolbar that wraps into a pile above the document.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    // No file behind this document — nothing to render, and nothing to sign. Say so
    // plainly instead of failing with a generic "couldn't render", and let the parent
    // disable the send button below.
    if (!url) { setStatus('nofile'); return; }
    (async () => {
      try {
        setStatus('loading');
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data, password: '' }).promise; // '' unlocks owner-encrypted TAR/gov PDFs
        const out: { w: number; h: number; src: string }[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: 820 / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
          const ctx = canvas.getContext('2d'); if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
          if (cancelled) return;
          out.push({ w: canvas.width, h: canvas.height, src: canvas.toDataURL('image/jpeg', 0.85) });
        }
        if (cancelled) return;
        setPages(out); setStatus('ready');
      } catch (e) { if (!cancelled) { console.error('[SignPreviewModal]', e); setStatus((e as { name?: string })?.name === 'PasswordException' ? 'encrypted' : 'error'); } }
    })();
    return () => { cancelled = true; };
  }, [url]);

  // Identify a field by its signer when we know them, else fall back to the role.
  const partyOf = (f: PreviewField) => (f.signerIndex && signers?.[f.signerIndex - 1]) ? `s${f.signerIndex}` : (f.signerRole || 'client');
  const colorOf = (key: string) => key.startsWith('s') && signers?.[Number(key.slice(1)) - 1]
    ? (signers[Number(key.slice(1)) - 1].color || ROLE_COLORS.other)
    : (ROLE_COLORS[key] || ROLE_COLORS.other);
  const nameOf = (key: string) => key.startsWith('s') && signers?.[Number(key.slice(1)) - 1]
    ? signers[Number(key.slice(1)) - 1].name
    : (signerLabel ? signerLabel(key) : key);
  const roles = Array.from(new Set(fields.map(partyOf)));
  const blocked = status === 'nofile' || status === 'encrypted';

  const closeBtn = (
    <button onClick={onClose} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,.16)', border: 'none', borderRadius: 8, padding: narrow ? '0 16px' : '7px 14px', minHeight: narrow ? 44 : undefined, cursor: 'pointer', flexShrink: 0 }}>{onConfirm ? '‹ Back' : '✕ Close'}</button>
  );
  const sendBtn = onConfirm && (
    <button onClick={onConfirm} disabled={busy || blocked}
      title={blocked ? 'This document can’t be signed as-is — fix it before sending' : undefined}
      style={{ fontSize: narrow ? 15 : 13, fontWeight: 800, color: '#fff', background: blocked ? '#9ca3af' : '#c9922c', border: 'none', borderRadius: narrow ? 10 : 8, padding: narrow ? '0 16px' : '7px 16px', minHeight: narrow ? 50 : undefined, width: narrow ? '100%' : undefined, cursor: (busy || blocked) ? 'default' : 'pointer', opacity: (busy || blocked) ? 0.6 : 1 }}>
      {busy ? 'Sending…' : confirmLabel}
    </button>
  );
  const legend = roles.length > 0 && (
    <div style={{ display: 'flex', gap: 10, flexWrap: narrow ? 'nowrap' : 'wrap', overflowX: narrow ? 'auto' : undefined, padding: narrow ? '0 12px 10px' : undefined }}>{roles.map(r => (
      <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#e5e7eb', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
        <span style={{ width: 11, height: 11, borderRadius: 3, background: colorOf(r), flexShrink: 0 }} />{nameOf(r)}
      </span>
    ))}</div>
  );

  return (
    <div className="es-touch" onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: narrow ? '#2b2f33' : 'rgba(17,24,39,.72)', zIndex: 1100, display: 'flex', flexDirection: 'column',
        padding: narrow ? 'env(safe-area-inset-top) 0 0' : 'max(10px, min(18px, 3vw))', fontFamily: "'DM Sans',sans-serif" }}>
      {narrow ? (
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
            <div style={{ flex: 1, minWidth: 0, color: '#fff', fontSize: 15, fontWeight: 800 }}>Review — who signs where</div>
            {closeBtn}
          </div>
          {legend}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexShrink: 0, flexWrap: 'wrap' }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>Review — who signs where</div>
          {legend}
          <span style={{ flex: 1 }} />
          {closeBtn}
          {sendBtn}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#4b4f52', borderRadius: narrow ? 0 : 8, padding: narrow ? 8 : 18, WebkitOverflowScrolling: 'touch' }}>
        {status === 'loading' && <div style={{ color: '#cbd5e1', textAlign: 'center', padding: 60 }}>Rendering document…</div>}
        {status === 'error' && <div style={{ color: '#fca5a5', textAlign: 'center', padding: 60 }}>Couldn’t render this document. You can still send, but review the source first.</div>}
        {status === 'nofile' && <div style={{ color: '#fca5a5', textAlign: 'center', padding: narrow ? '40px 12px' : 60, lineHeight: 1.7 }}>This document has no file yet.<br /><span style={{ fontSize: 13, color: '#e5e7eb' }}>Import the PDF — or open the form, fill it and Save — before sending. There’s nothing here to sign.</span></div>}
        {status === 'encrypted' && <div style={{ color: '#fca5a5', textAlign: 'center', padding: narrow ? '40px 12px' : 60, lineHeight: 1.7 }}>This PDF is password-protected / encrypted.<br /><span style={{ fontSize: 13, color: '#e5e7eb' }}>It can’t be prepared for signing (the signer would see a blank page). Open it in Preview → File → <strong>Export as PDF</strong> with encryption off (or “Print → Save as PDF”), then import that copy.</span></div>}
        {status === 'ready' && fields.length === 0 && <div style={{ color: '#fde68a', textAlign: 'center', padding: '4px 0 16px', fontSize: 13 }}>No signature fields are placed — signers will sign on an added Signatures page.</div>}
        {pages.map((pg, i) => {
          const pageFields = fields.filter(f => (f.page || 1) === i + 1);
          return (
            <div key={i} style={{ position: 'relative', width: 820, maxWidth: '100%', margin: `0 auto ${narrow ? 10 : 18}px`, boxShadow: '0 2px 14px rgba(0,0,0,.45)' }}>
              <img src={pg.src} alt={`Page ${i + 1}`} style={{ display: 'block', width: '100%' }} />
              {pageFields.map((f, k) => {
                const party = partyOf(f);
                const color = colorOf(party);
                // On a phone-width page a desktop-height box buries the lines above it.
                const boxH = (f.type === 'date' || f.type === 'date_signed') ? (narrow ? 14 : 20) : (narrow ? 18 : 28);
                return (
                  <div key={k} style={{ position: 'absolute', left: `${f.fx * 100}%`, width: `${Math.max(f.fw * 100, 9)}%`, top: `calc(${f.fy * 100}% - ${boxH}px)`, height: boxH, border: `2px solid ${color}`, background: color + '26', borderRadius: 3, boxSizing: 'border-box', pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', top: -15, left: -2, fontSize: 9.5, fontWeight: 800, color: '#fff', background: color, padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>{nameOf(party)} · {typeLabel(f.type)}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {narrow && sendBtn && (
        <div style={{ flexShrink: 0, padding: '10px 12px calc(10px + env(safe-area-inset-bottom))', background: '#2b2f33', borderTop: '1px solid rgba(255,255,255,.08)' }}>
          {sendBtn}
        </div>
      )}
    </div>
  );
}
