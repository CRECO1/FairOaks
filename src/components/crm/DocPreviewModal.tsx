'use client';

import React, { useEffect, useRef, useState } from 'react';
import PdfViewer from './PdfViewer';
import { sanitizeHtml } from '@/lib/sanitize';
import { renderWorkbookCached, isXlsxName, XR_CSS } from '@/lib/xlsx-render';
import { renderDocxInto } from '@/lib/docx-render';

// In-app document preview: renders a PDF (to <canvas> via PdfViewer), an image, or a
// spreadsheet (parsed client-side with SheetJS) inline so the user can VIEW + PRINT
// without the browser downloading the file every time. Everything is rendered IN THE
// BROWSER — the document is never sent to a third-party viewer. Print uses a
// print-only stylesheet (no blob/iframe — the app CSP blocks frame-src/object-src).
// Download stays an explicit choice via Supabase's `?download=` disposition param.

// Spreadsheets (.xlsx/.xls/.csv/.ods) → HTML tables via SheetJS, one tab per sheet.
function SpreadsheetView({ url, name, zoom, onReady }: { url: string; name: string; zoom: number; onReady: () => void }) {
  const [sheets, setSheets] = useState<{ name: string; html: string; rich?: boolean; note?: string }[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (cancelled) return;
        let out: { name: string; html: string; rich?: boolean; note?: string }[] | null = null;
        // .xlsx: drawn with its real formatting (colors, fonts, borders, widths, merges). Anything else / any failure: plain tables.
        if (isXlsxName(name)) {
          try { out = (await renderWorkbookCached(url, data)).map(r => ({ name: r.name, html: r.html, rich: true, note: r.truncated ? 'Showing the first rows — download the file for the rest.' : undefined })); }
          catch (e) { console.warn('[SpreadsheetView] rich render failed, using plain', e); }
        }
        if (!out) {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(data, { type: 'array' });
          out = wb.SheetNames.map(n => ({ name: n, html: XLSX.utils.sheet_to_html(wb.Sheets[n], { editable: false, header: '', footer: '' }) }));
        }
        if (cancelled) return;
        setSheets(out.length ? out : [{ name: 'Sheet1', html: '<p>Empty sheet.</p>' }]);
        setStatus('ready');
        onReady();
      } catch (e) {
        if (!cancelled) { console.error('[SpreadsheetView]', e); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [url, name, onReady]);

  if (status === 'loading') return <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af' }}>Opening spreadsheet…</div>;
  if (status === 'error') return <div style={{ padding: 50, textAlign: 'center', color: '#ef4444' }}>Couldn’t open this spreadsheet. Try ↓ Download instead.</div>;
  return (
    <div className="ssheet" style={{ background: '#fff', borderRadius: 6, boxShadow: '0 1px 8px rgba(0,0,0,.12)', overflow: 'hidden', maxWidth: 1400, margin: '0 auto' }}>
      <style>{`.ssheet table:not(.xr){border-collapse:collapse;width:100%;font-family:-apple-system,'DM Sans',sans-serif}
        .ssheet table:not(.xr) td,.ssheet table:not(.xr) th{border:1px solid #e5e7eb;padding:5px 9px;font-size:12.5px;color:#1a1a1a;white-space:nowrap;text-align:left}
        .ssheet table:not(.xr) tr:first-child td,.ssheet table:not(.xr) th{background:#f9fafb;font-weight:700}
        .ssheet table:not(.xr) td:empty::after{content:"\\00a0"}`}</style>
      {sheets.length > 1 && (
        <div className="docprev-noprint" style={{ display: 'flex', gap: 4, padding: '8px 8px 0', flexWrap: 'wrap', borderBottom: '1px solid #eef0f2', background: '#fbfbfc' }}>
          {sheets.map((s, i) => (
            <button key={s.name} onClick={() => setActive(i)} style={{ fontSize: 12, fontWeight: 700, padding: '5px 11px', border: 'none', borderBottom: active === i ? '2px solid #c9922c' : '2px solid transparent', background: 'none', color: active === i ? '#a06a12' : '#6b7280', cursor: 'pointer' }}>{s.name}</button>
          ))}
        </div>
      )}
      {/* Sanitized: SheetJS escapes cell TEXT but passes two things through
          verbatim — a cell's hyperlink target (so a crafted .xlsx can carry
          href="javascript:...") and a cell's `h` HTML property (which emits
          raw markup, script tags included). An uploaded workbook is attacker
          -controlled input, so this is stored XSS in the CRM origin unless it
          is cleaned. DOMPurify keeps every table/row/cell, so the sheet still
          renders exactly as before. */}
      {sheets[active]?.rich ? (
        <>
          <style>{XR_CSS}</style>
          {/* Built by xlsx-render.ts: all text escaped, all styles whitelisted, no links — safe without the sanitizer (which would strip the formatting). */}
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 210px)', touchAction: 'pan-x pan-y pinch-zoom' }}><div style={{ zoom }} dangerouslySetInnerHTML={{ __html: sheets[active].html }} /></div>
          {sheets[active].note && <div className="docprev-noprint" style={{ padding: '8px 12px', fontSize: 12, color: '#6b7280', borderTop: '1px solid #eef0f2' }}>{sheets[active].note}</div>}
        </>
      ) : (
        <div style={{ overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(sheets[active]?.html || '') }} />
      )}
    </div>
  );
}

// Word documents (.docx) drawn like Word (page size, margins, fonts, tables, headers) via docx-preview; plain mammoth HTML if that fails.
function DocxView({ url, onReady }: { url: string; onReady: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading'); setFallback('');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const arrayBuffer = await resp.arrayBuffer();
        if (cancelled) return;
        try {
          if (!host.current) throw new Error('no host');
          await renderDocxInto(arrayBuffer, host.current);
        } catch (e) {
          console.warn('[DocxView] faithful render failed, using plain', e);
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (cancelled) return;
          setFallback(result.value || '<p>(empty document)</p>');
        }
        if (cancelled) return;
        setStatus('ready');
        onReady();
      } catch (e) {
        if (!cancelled) { console.error('[DocxView]', e); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [url, onReady]);

  return (
    <>
      {status === 'loading' && <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af' }}>Opening document…</div>}
      {status === 'error' && <div style={{ padding: 50, textAlign: 'center', color: '#ef4444' }}>Couldn’t open this document. Try ↓ Download instead.</div>}
      <style>{`.docxhost .docx-wrapper{background:transparent!important;padding:0!important}.docxhost .docx-wrapper>section.docx{box-shadow:0 1px 8px rgba(0,0,0,.16)!important;margin:0 auto 14px!important;max-width:100%}
        .docxfb{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;line-height:1.55;font-size:14px;background:#fff;max-width:820px;margin:0 auto;padding:48px 56px;border-radius:4px;box-shadow:0 1px 8px rgba(0,0,0,.16)}.docxfb p{margin:0 0 10px}.docxfb table{border-collapse:collapse}.docxfb td,.docxfb th{border:1px solid #d1d5db;padding:5px 9px;font-size:13px}.docxfb img{max-width:100%;height:auto}`}</style>
      <div ref={host} className="docxhost" style={{ display: status === 'error' || fallback ? 'none' : 'block', overflowX: 'auto' }} />
      {fallback && <div className="docxfb" dangerouslySetInnerHTML={{ __html: sanitizeHtml(fallback) }} />}
    </>
  );
}

type PreviewFile = { url: string; name: string; type?: string | null };
export default function DocPreviewModal({ file: first, files, start = 0, onClose }: {
  file: PreviewFile;
  /** Every file in the same email, so ←/→ (or a swipe) steps through them. */
  files?: PreviewFile[];
  start?: number;
  onClose: () => void;
}) {
  const list = files && files.length > 1 ? files : null;
  const [idx, setIdx] = useState(Math.min(Math.max(start, 0), (list?.length ?? 1) - 1));
  const file = list ? list[idx] : first;
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const go = (d: number) => { if (!list) return; setIdx(i => (i + d + list.length) % list.length); setReady(false); setZoom(1); };
  const touch = useRef<{ x: number; y: number } | null>(null);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = file.type || '';
  const isPdf = ext === 'pdf' || type === 'application/pdf';
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext) || type.startsWith('image/');
  const isSheet = ['xlsx', 'xls', 'xlsm', 'csv', 'ods', 'tsv'].includes(ext) || type.includes('spreadsheet') || type === 'text/csv';
  const isDocx = ext === 'docx' || type.includes('wordprocessingml');
  const previewable = isPdf || isImg || isSheet || isDocx;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (list && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(e.target instanceof HTMLInputElement)) go(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, list]); // eslint-disable-line react-hooks/exhaustive-deps
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
          {list && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <button onClick={() => go(-1)} aria-label="Previous file" title="Previous file (←)" style={{ ...btn, padding: '6px 9px' }}>‹</button>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', minWidth: 34, textAlign: 'center' }}>{idx + 1} / {list.length}</span>
            <button onClick={() => go(1)} aria-label="Next file" title="Next file (→)" style={{ ...btn, padding: '6px 9px' }}>›</button>
          </span>}
          {isSheet && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.15).toFixed(2)))} aria-label="Zoom out" title="Zoom out" style={{ ...btn, padding: '6px 9px' }}>−</button>
            <button onClick={() => setZoom(1)} title="Reset zoom" style={{ ...btn, padding: '6px 8px', minWidth: 52 }}>{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom(z => Math.min(2, +(z + 0.15).toFixed(2)))} aria-label="Zoom in" title="Zoom in" style={{ ...btn, padding: '6px 9px' }}>+</button>
          </span>}
          {previewable && <button onClick={() => window.print()} disabled={!ready} title={ready ? 'Print this document' : 'Rendering…'} style={{ ...btn, color: ready ? '#a06a12' : '#c9b78a', borderColor: '#f0e2c4', cursor: ready ? 'pointer' : 'default' }}>🖨 Print</button>}
          <a href={downloadUrl} style={{ ...btn, textDecoration: 'none', color: '#374151' }}>↓ Download</a>
          <button onClick={onClose} style={btn}>✕ Close</button>
        </div>
        <div className="docprev-print crm-print-allowed" key={file.url + file.name}
          onTouchStart={e => { touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }}
          onTouchEnd={e => { const t = touch.current; touch.current = null; if (!t || !list) return; const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y; if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && !isSheet) go(dx < 0 ? 1 : -1); }}
          style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#f3f4f6', padding: 18 }}>
          {isPdf ? (
            <PdfViewer url={file.url} onReady={() => setReady(true)} />
          ) : isImg ? (
            <img src={file.url} alt={file.name} style={{ display: 'block', maxWidth: '100%', margin: '0 auto', background: '#fff', boxShadow: '0 1px 8px rgba(0,0,0,.16)', borderRadius: 4 }} />
          ) : isSheet ? (
            <SpreadsheetView url={file.url} name={file.name} zoom={zoom} onReady={() => setReady(true)} />
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
