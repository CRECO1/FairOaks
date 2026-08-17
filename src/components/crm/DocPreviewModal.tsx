'use client';

import React, { useEffect, useState } from 'react';
import PdfViewer from './PdfViewer';

// In-app document preview: renders a PDF (to <canvas> via PdfViewer), an image, or a
// spreadsheet (parsed client-side with SheetJS) inline so the user can VIEW + PRINT
// without the browser downloading the file every time. Everything is rendered IN THE
// BROWSER — the document is never sent to a third-party viewer. Print uses a
// print-only stylesheet (no blob/iframe — the app CSP blocks frame-src/object-src).
// Download stays an explicit choice via Supabase's `?download=` disposition param.

// Spreadsheets (.xlsx/.xls/.csv/.ods) → HTML tables via SheetJS, one tab per sheet.
function SpreadsheetView({ url, onReady }: { url: string; onReady: () => void }) {
  const [sheets, setSheets] = useState<{ name: string; html: string }[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const XLSX = await import('xlsx');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (cancelled) return;
        const wb = XLSX.read(data, { type: 'array' });
        const out = wb.SheetNames.map(name => ({ name, html: XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false, header: '', footer: '' }) }));
        if (cancelled) return;
        setSheets(out.length ? out : [{ name: 'Sheet1', html: '<p>Empty sheet.</p>' }]);
        setStatus('ready');
        onReady();
      } catch (e) {
        if (!cancelled) { console.error('[SpreadsheetView]', e); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [url, onReady]);

  if (status === 'loading') return <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af' }}>Opening spreadsheet…</div>;
  if (status === 'error') return <div style={{ padding: 50, textAlign: 'center', color: '#ef4444' }}>Couldn’t open this spreadsheet. Try ↓ Download instead.</div>;
  return (
    <div className="ssheet" style={{ background: '#fff', borderRadius: 6, boxShadow: '0 1px 8px rgba(0,0,0,.12)', overflow: 'hidden', maxWidth: 1100, margin: '0 auto' }}>
      <style>{`.ssheet table{border-collapse:collapse;width:100%;font-family:-apple-system,'DM Sans',sans-serif}
        .ssheet td,.ssheet th{border:1px solid #e5e7eb;padding:5px 9px;font-size:12.5px;color:#1a1a1a;white-space:nowrap;text-align:left}
        .ssheet tr:first-child td,.ssheet th{background:#f9fafb;font-weight:700}
        .ssheet td:empty::after{content:"\\00a0"}`}</style>
      {sheets.length > 1 && (
        <div className="docprev-noprint" style={{ display: 'flex', gap: 4, padding: '8px 8px 0', flexWrap: 'wrap', borderBottom: '1px solid #eef0f2', background: '#fbfbfc' }}>
          {sheets.map((s, i) => (
            <button key={s.name} onClick={() => setActive(i)} style={{ fontSize: 12, fontWeight: 700, padding: '5px 11px', border: 'none', borderBottom: active === i ? '2px solid #c9922c' : '2px solid transparent', background: 'none', color: active === i ? '#a06a12' : '#6b7280', cursor: 'pointer' }}>{s.name}</button>
          ))}
        </div>
      )}
      <div style={{ overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: sheets[active]?.html || '' }} />
    </div>
  );
}

// Word documents (.docx) → clean HTML via mammoth, rendered on a page-like sheet.
function DocxView({ url, onReady }: { url: string; onReady: () => void }) {
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const mammoth = await import('mammoth');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const arrayBuffer = await resp.arrayBuffer();
        if (cancelled) return;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setHtml(result.value || '<p>(empty document)</p>');
        setStatus('ready');
        onReady();
      } catch (e) {
        if (!cancelled) { console.error('[DocxView]', e); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [url, onReady]);

  if (status === 'loading') return <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af' }}>Opening document…</div>;
  if (status === 'error') return <div style={{ padding: 50, textAlign: 'center', color: '#ef4444' }}>Couldn’t open this document. Try ↓ Download instead.</div>;
  return (
    <div className="docxview" style={{ background: '#fff', maxWidth: 820, margin: '0 auto', padding: '48px 56px', borderRadius: 4, boxShadow: '0 1px 8px rgba(0,0,0,.16)' }}>
      <style>{`.docxview{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;line-height:1.55;font-size:14px}
        .docxview p{margin:0 0 10px}
        .docxview h1,.docxview h2,.docxview h3,.docxview h4{font-family:-apple-system,'DM Sans',sans-serif;margin:18px 0 8px;line-height:1.25}
        .docxview table{border-collapse:collapse;margin:10px 0;width:auto}
        .docxview td,.docxview th{border:1px solid #d1d5db;padding:5px 9px;font-size:13px}
        .docxview img{max-width:100%;height:auto}
        .docxview ul,.docxview ol{margin:0 0 10px 22px}
        .docxview a{color:#2563eb}`}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export default function DocPreviewModal({ file, onClose }: {
  file: { url: string; name: string; type?: string | null };
  onClose: () => void;
}) {
  const [ready, setReady] = useState(false);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = file.type || '';
  const isPdf = ext === 'pdf' || type === 'application/pdf';
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext) || type.startsWith('image/');
  const isSheet = ['xlsx', 'xls', 'xlsm', 'csv', 'ods', 'tsv'].includes(ext) || type.includes('spreadsheet') || type === 'text/csv';
  const isDocx = ext === 'docx' || type.includes('wordprocessingml');
  const previewable = isPdf || isImg || isSheet || isDocx;

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
      {/* Print only the rendered document, at full size, with nothing else. */}
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
          <span style={{ fontSize: 20, flexShrink: 0 }}>{isPdf ? '📄' : isImg ? '🖼' : isSheet ? '📊' : isDocx ? '📝' : '📎'}</span>
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
          ) : isSheet ? (
            <SpreadsheetView url={file.url} onReady={() => setReady(true)} />
          ) : isDocx ? (
            <DocxView url={file.url} onReady={() => setReady(true)} />
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
