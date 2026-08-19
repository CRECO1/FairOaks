'use client';

import React, { useEffect, useState } from 'react';

// Review-before-send preview: renders the document's pages and overlays a labeled
// marker at each placed signature field — so the agent can SEE who signs where
// before a send OR a resend (no blind sends). Canvas render sidesteps the app CSP
// that blocks iframing PDFs; markers are positioned in % so they scale with the page.
export interface PreviewField { page?: number; fx: number; fy: number; fw: number; type?: string; signerRole?: string }

const ROLE_COLORS: Record<string, string> = { client: '#c9922c', landlord: '#2563eb', agent: '#16a34a', seller: '#c9922c', buyer: '#7c3aed', witness: '#db2777', other: '#6b7280' };
const typeLabel = (t?: string) => t === 'signature' ? 'Signature' : t === 'initial' ? 'Initials' : (t === 'date' || t === 'date_signed') ? 'Date' : (t || 'Field');

export default function SignPreviewModal({ url, fields, signerLabel, onClose, onConfirm, confirmLabel = 'Send', busy }: {
  url: string;
  fields: PreviewField[];
  signerLabel?: (role: string) => string;
  onClose: () => void;
  // When given, this is the last step before a document goes out: the review carries
  // the send button itself, so nothing is sent without the agent seeing the placements.
  onConfirm?: () => void;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const [pages, setPages] = useState<{ w: number; h: number; src: string }[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data }).promise;
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
      } catch (e) { if (!cancelled) { console.error('[SignPreviewModal]', e); setStatus('error'); } }
    })();
    return () => { cancelled = true; };
  }, [url]);

  const roles = Array.from(new Set(fields.map(f => f.signerRole || 'client')));

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.72)', zIndex: 1100, display: 'flex', flexDirection: 'column', padding: 18, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>Review signature placements — who signs where</div>
        {roles.length > 0 && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{roles.map(r => (
          <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#e5e7eb', fontSize: 12, fontWeight: 600 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: ROLE_COLORS[r] || ROLE_COLORS.other }} />{signerLabel ? signerLabel(r) : r}
          </span>
        ))}</div>}
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,.16)', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>{onConfirm ? '‹ Back' : '✕ Close'}</button>
        {onConfirm && (
          <button onClick={onConfirm} disabled={busy}
            style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: '#c9922c', border: 'none', borderRadius: 8, padding: '7px 16px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Sending…' : confirmLabel}
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#4b4f52', borderRadius: 8, padding: 18 }}>
        {status === 'loading' && <div style={{ color: '#cbd5e1', textAlign: 'center', padding: 60 }}>Rendering document…</div>}
        {status === 'error' && <div style={{ color: '#fca5a5', textAlign: 'center', padding: 60 }}>Couldn’t render this document. You can still send, but review the source first.</div>}
        {status === 'ready' && fields.length === 0 && <div style={{ color: '#fde68a', textAlign: 'center', padding: '4px 0 16px', fontSize: 13 }}>No signature fields are placed — signers will sign on an added Signatures page.</div>}
        {pages.map((pg, i) => {
          const pageFields = fields.filter(f => (f.page || 1) === i + 1);
          return (
            <div key={i} style={{ position: 'relative', width: 820, maxWidth: '100%', margin: '0 auto 18px', boxShadow: '0 2px 14px rgba(0,0,0,.45)' }}>
              <img src={pg.src} alt={`Page ${i + 1}`} style={{ display: 'block', width: '100%' }} />
              {pageFields.map((f, k) => {
                const role = f.signerRole || 'client';
                const color = ROLE_COLORS[role] || ROLE_COLORS.other;
                const boxH = (f.type === 'date' || f.type === 'date_signed') ? 20 : 28;
                return (
                  <div key={k} style={{ position: 'absolute', left: `${f.fx * 100}%`, width: `${Math.max(f.fw * 100, 9)}%`, top: `calc(${f.fy * 100}% - ${boxH}px)`, height: boxH, border: `2px solid ${color}`, background: color + '26', borderRadius: 3, boxSizing: 'border-box', pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', top: -15, left: -2, fontSize: 9.5, fontWeight: 800, color: '#fff', background: color, padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>{(signerLabel ? signerLabel(role) : role)} · {typeLabel(f.type)}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
