'use client';

import React, { useEffect, useState } from 'react';
import PdfViewer from './PdfViewer';

// In-app document preview: renders a PDF (to <canvas> via PdfViewer) or an image
// inline so the user can VIEW + PRINT without the browser downloading the file every
// time. Print uses a print-only stylesheet that shows just the rendered pages — no
// blob/iframe (the app CSP blocks frame-src/object-src for those). Download stays as
// an explicit choice via the Supabase `?download=` disposition param.
export default function DocPreviewModal({ file, onClose }: {
  file: { url: string; name: string; type?: string | null };
  onClose: () => void;
}) {
  const [ready, setReady] = useState(false);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isPdf = ext === 'pdf' || file.type === 'application/pdf';
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext) || (file.type || '').startsWith('image/');
  const previewable = isPdf || isImg;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { if (isImg || !previewable) setReady(true); }, [isImg, previewable]);

  const downloadUrl = file.url + (file.url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(file.name);
  const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif" };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.62)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: 24 }}>
      {/* Print only the rendered document pages, at full size, with nothing else. */}
      <style>{`@media print {
        body > * { visibility: hidden !important; }
        .docprev-print, .docprev-print * { visibility: visible !important; }
        .docprev-print { position: absolute !important; left: 0; top: 0; width: 100%; max-height: none !important; overflow: visible !important; background: #fff !important; padding: 0 !important; }
        .docprev-print canvas, .docprev-print img { box-shadow: none !important; margin: 0 auto 6px !important; max-width: 100% !important; page-break-inside: avoid; break-inside: avoid; }
        .docprev-noprint { display: none !important; }
        @page { margin: 12mm; }
      }`}</style>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 980, margin: '0 auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div className="docprev-noprint" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid #eef0f2' }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>{isPdf ? '📄' : isImg ? '🖼' : '📎'}</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
          {previewable && <button onClick={() => window.print()} disabled={!ready} title={ready ? 'Print this document' : 'Rendering…'} style={{ ...btn, color: ready ? '#a06a12' : '#c9b78a', borderColor: '#f0e2c4', cursor: ready ? 'pointer' : 'default' }}>🖨 Print</button>}
          <a href={downloadUrl} style={{ ...btn, textDecoration: 'none', color: '#374151' }}>↓ Download</a>
          <button onClick={onClose} style={btn}>✕ Close</button>
        </div>
        <div className="docprev-print" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#f3f4f6', padding: 18 }}>
          {isPdf ? (
            <PdfViewer url={file.url} onReady={() => setReady(true)} />
          ) : isImg ? (
            <img src={file.url} alt={file.name} style={{ display: 'block', maxWidth: '100%', margin: '0 auto', background: '#fff', boxShadow: '0 1px 8px rgba(0,0,0,.16)', borderRadius: 4 }} />
          ) : (
            <div style={{ padding: 50, textAlign: 'center', color: '#6b7280' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📎</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#374151' }}>This file type can’t be previewed here.</div>
              <div style={{ fontSize: 13 }}>Use ↓ Download to open it on your computer.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
