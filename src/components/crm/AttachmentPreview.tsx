'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeHtml } from '@/lib/sanitize';
import { renderWorkbookCached, isXlsxName, XR_CSS } from '@/lib/xlsx-render';
import { renderDocxInto } from '@/lib/docx-render';
import { fmtDate, fmtSize, likelyVersions, newestOfVersions, sendWarnings, loadBytes, loadThumb, previewKind, type PreviewItem, type Thumb } from '@/lib/attachment-preview';
import { renderPdfPages, revokePages, targetWidthFor, type RenderedPage } from '@/lib/pdf-render';

// "What am I about to send?" — every attachment on the email as a card with the real first page of the file, so an agent
// can tell the many versions of a flyer apart at a glance. Click a card for the full document (all pages, ←/→ between files).

function Thumb({ item, w, h }: { item: PreviewItem; w: number; h: number }) {
  const [t, setT] = useState<Thumb | null | 'err' | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setT(undefined);
    loadThumb(item).then(r => { if (live) setT(r); }).catch(() => { if (live) setT('err'); });
    return () => { live = false; };
  }, [item.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = previewKind(item);
  const box: React.CSSProperties = { width: w, height: h, borderRadius: 6, background: 'var(--k-f3f4f6)', border: '1px solid var(--k-e5e7eb)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' };
  if (t && t !== 'err' && t.html && t.htmlWidth) {
    const sc = w / Math.min(t.htmlWidth, 900);
    return (
      <div style={{ ...box, background: '#fff', alignItems: 'flex-start', justifyContent: 'flex-start' }} aria-hidden>
        <style>{XR_CSS}</style>
        <div style={{ width: Math.min(t.htmlWidth, 900), transform: `scale(${sc})`, transformOrigin: 'top left', pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: t.html }} />
        <span style={{ position: 'absolute', right: 3, bottom: 3, background: t.label === 'DOCX' ? '#1d4ed8' : '#15803d', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px' }}>{t.label ?? 'XLSX'}</span>
      </div>
    );
  }
  if (t && t !== 'err' && t.grid) {
    return (
      <div style={{ ...box, background: '#fff', alignItems: 'flex-start', justifyContent: 'flex-start' }} aria-hidden>
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', fontSize: 7.5, color: '#374151' }}>
          <tbody>{t.grid.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ border: '1px solid #e5e7eb', padding: '2px 3px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', background: i === 0 ? '#ecfdf5' : undefined, fontWeight: i === 0 ? 700 : 400 }}>{c}</td>)}</tr>)}</tbody>
        </table>
        <span style={{ position: 'absolute', right: 3, bottom: 3, background: '#15803d', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px' }}>XLSX</span>
      </div>
    );
  }
  if (t && t !== 'err') {
    return (
      <div style={{ ...box, background: '#fff', alignItems: 'flex-start' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={t.src} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
        {t.pages && t.pages > 1 ? <span style={{ position: 'absolute', right: 3, bottom: 3, background: 'rgba(17,24,39,.78)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px' }}>{t.pages} pp</span> : null}
      </div>
    );
  }
  return (
    <div style={box} aria-hidden>
      <span style={{ fontSize: 11, color: 'var(--k-9ca3af)', textAlign: 'center', padding: 4 }}>
        {t === undefined && (kind !== 'other' || kind === 'doc' || /\.(mov|mp4|m4v|webm)$/i.test(item.name)) ? 'Loading…' : kind === 'other' || kind === 'doc' ? (item.name.split('.').pop() ?? 'file').toUpperCase().slice(0, 5) : 'No preview'}
      </span>
    </div>
  );
}

export function AttachmentCards(p: { items: PreviewItem[]; onRemove: (key: string) => void; isMobile: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const dupes = useMemo(() => likelyVersions(p.items), [p.items]);
  const newest = useMemo(() => newestOfVersions(p.items), [p.items]);
  const warns = useMemo(() => sendWarnings(p.items), [p.items]);
  if (!p.items.length) return null;
  const W = p.isMobile ? 92 : 104, H = Math.round(W * 1.3);
  return (
    <div style={{ padding: '0 12px 10px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--k-6b7280)', letterSpacing: .3, margin: '2px 0 6px', fontFamily: "'DM Sans',sans-serif" }}>
        <span>📎 {p.items.length} attached — tap one to check it</span>
      </div>
      {warns.length > 0 && (
        <div role="status" style={{ margin: '0 0 8px', padding: '7px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12.5, color: '#92400e', fontFamily: "'DM Sans',sans-serif", lineHeight: 1.45 }}>
          {warns.map((w, i) => <div key={i}>⚠ {w.text}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
        {p.items.map((it, idx) => (
          <div key={it.key} style={{ width: W, flexShrink: 0, position: 'relative', fontFamily: "'DM Sans',sans-serif" }}>
            <button type="button" onClick={() => setOpen(idx)} aria-label={`Preview ${it.name}`}
              style={{ display: 'block', padding: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', minWidth: 0, minHeight: 0, width: '100%' }}>
              <Thumb item={it} w={W} h={H} />
              <span title={it.name} style={{ marginTop: 5, fontSize: 12, fontWeight: 600, color: 'var(--k-111)', lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' } as React.CSSProperties}>{it.name}</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--k-9ca3af)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[fmtDate(it.date), fmtSize(it.size), it.source].filter(Boolean).join(' · ')}</span>
              {dupes.has(it.key) && <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10.5, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 4, padding: '1px 5px' }}>{newest.has(it.key) ? 'Similar file · newest' : 'Similar file attached'}</span>}
            </button>
            <button type="button" onClick={() => p.onRemove(it.key)} aria-label={`Remove ${it.name}`}
              style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, minWidth: 0, minHeight: 0, borderRadius: 11, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-6b7280)', fontSize: 14, lineHeight: 1, cursor: 'pointer', padding: 0, boxShadow: '0 1px 3px rgba(0,0,0,.18)' }}>×</button>
          </div>
        ))}
      </div>
      {open !== null && p.items[open] && (
        <AttachmentViewer items={p.items} index={Math.min(open, p.items.length - 1)} setIndex={setOpen} onClose={() => setOpen(null)} isMobile={p.isMobile} dupes={dupes} newest={newest} />
      )}
    </div>
  );
}

function AttachmentViewer(p: { items: PreviewItem[]; index: number; setIndex: (i: number) => void; onClose: () => void; isMobile: boolean; dupes: Set<string>; newest: Set<string> }) {
  const item = p.items[p.index];
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [imgSrc, setImgSrc] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const [sheets, setSheets] = useState<{ name: string; html: string; rich?: boolean }[]>([]);
  const [sheet, setSheet] = useState(0);
  const [zoom, setZoom] = useState(1);
  const docHost = useRef<HTMLDivElement>(null);
  const [docHtml, setDocHtml] = useState('');
  const kind = previewKind(item);

  useEffect(() => {
    let live = true;
    const ac = new AbortController();
    let got: RenderedPage[] = [], url = '';
    setPages([]); setImgSrc(''); setMsg(''); setSheets([]); setSheet(0); setZoom(1); setDocHtml(''); setState(kind === 'other' ? 'none' : 'loading');
    if (kind === 'other') return;
    (async () => {
      try {
        const bytes = await loadBytes(item);
        if (!live) return;
        if (kind === 'sheet') {
          if (isXlsxName(item.name)) {
            try {
              const rich = await renderWorkbookCached(item.key, bytes.slice(0));
              if (!live) return;
              setSheets(rich.map(r => ({ name: r.name, html: r.html, rich: true }))); setState('ready'); return;
            } catch (e) { console.warn('[AttachmentPreview] rich render failed, using plain', e); }
          }
          const XLSX = await import('xlsx');
          const wb = XLSX.read(bytes.slice(0), { type: 'array' });
          if (!live) return;
          setSheets(wb.SheetNames.map(name => ({ name, html: XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false, header: '', footer: '' }) })));
          setState('ready'); return;
        }
        if (kind === 'doc') {
          // Drawn like Word (page, margins, fonts, tables); plain text-flow version only if that fails.
          try {
            if (!docHost.current) throw new Error('no host');
            await renderDocxInto(bytes.slice(0), docHost.current);
            if (!live) return;
            setState('ready'); return;
          } catch (e) { console.warn('[AttachmentPreview] faithful docx failed, using plain', e); }
          const mammoth = await import('mammoth');
          const out = await mammoth.convertToHtml({ arrayBuffer: bytes.slice(0) });
          if (!live) return;
          setDocHtml(out.value); setState('ready'); return;
        }
        if (kind === 'image') { url = URL.createObjectURL(new Blob([bytes], { type: item.mime || 'image/png' })); setImgSrc(url); setState('ready'); return; }
        await renderPdfPages(bytes.slice(0), {
          targetWidth: targetWidthFor(p.isMobile ? 420 : 820), quality: 0.9, signal: ac.signal,
          onReset: () => { got = []; if (live) setPages([]); },
          onPage: pg => { got = [...got, pg]; if (live) { setPages(got); setState('ready'); } },
        });
        if (live) setState('ready');
      } catch (e) {
        if (!live || ac.signal.aborted) return;
        if (!got.length) { setMsg(e instanceof Error ? e.message : ''); setState('error'); }
      }
    })();
    return () => { live = false; ac.abort(); revokePages(got); if (url) URL.revokeObjectURL(url); };
  }, [item.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const { index, items, setIndex, onClose } = p;
  const last = useRef({ index, n: items.length }); last.current = { index, n: items.length };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight' && last.current.index < last.current.n - 1) setIndex(last.current.index + 1);
      else if (e.key === 'ArrowLeft' && last.current.index > 0) setIndex(last.current.index - 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, setIndex]);

  const navBtn = (disabled: boolean): React.CSSProperties => ({ height: p.isMobile ? 40 : 34, minWidth: p.isMobile ? 40 : 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--k-e5e7eb)', background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 16, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .35 : 1 });
  return (
    <div role="dialog" aria-label="Attachment preview" onClick={p.onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: p.isMobile ? 0 : 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--k-fff)', width: '100%', maxWidth: 920, height: p.isMobile ? '100%' : 'min(92vh, 1000px)', display: 'flex', flexDirection: 'column', borderRadius: p.isMobile ? 0 : 14, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.35)', fontFamily: "'DM Sans',sans-serif", paddingTop: p.isMobile ? 'env(safe-area-inset-top)' : 0, paddingBottom: p.isMobile ? 'env(safe-area-inset-bottom)' : 0 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--k-f0f0f0)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--k-111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <div style={{ fontSize: 12, color: 'var(--k-6b7280)' }}>
              {[fmtDate(item.date) && `Updated ${fmtDate(item.date)}`, fmtSize(item.size), item.source, pages.length > 1 ? `${pages.length} pages` : ''].filter(Boolean).join(' · ')}
              {p.dupes.has(item.key) && <span style={{ marginLeft: 8, fontWeight: 700, color: '#92400e' }}>⚠ Similar file also attached{p.newest.has(item.key) ? ' (this is the newest)' : ' (a newer one may exist)'}</span>}
            </div>
          </div>
          {kind === 'sheet' && sheets.length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.15).toFixed(2)))} style={{ ...navBtn(false), minWidth: 30, padding: '0 8px' }}>−</button>
            <button type="button" title="Reset zoom" onClick={() => setZoom(1)} style={{ ...navBtn(false), minWidth: 50, padding: '0 6px', fontSize: 12 }}>{Math.round(zoom * 100)}%</button>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom(z => Math.min(2, +(z + 0.15).toFixed(2)))} style={{ ...navBtn(false), minWidth: 30, padding: '0 8px' }}>+</button>
          </span>}
          <button type="button" aria-label="Previous attachment" disabled={p.index === 0} onClick={() => p.setIndex(p.index - 1)} style={navBtn(p.index === 0)}>‹</button>
          <span style={{ fontSize: 12, color: 'var(--k-6b7280)', minWidth: 34, textAlign: 'center' }}>{p.index + 1} / {p.items.length}</span>
          <button type="button" aria-label="Next attachment" disabled={p.index >= p.items.length - 1} onClick={() => p.setIndex(p.index + 1)} style={navBtn(p.index >= p.items.length - 1)}>›</button>
          <button type="button" onClick={p.onClose} aria-label="Close preview" style={{ background: 'none', border: 'none', fontSize: 24, color: 'var(--k-9ca3af)', cursor: 'pointer', width: 40, height: 40, minWidth: 0, minHeight: 0 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--k-f3f4f6)', padding: p.isMobile ? 10 : 18 }}>
          {state === 'loading' && !pages.length && <div style={{ padding: 40, textAlign: 'center', fontSize: 14, color: 'var(--k-9ca3af)' }}>Opening {item.name}…</div>}
          {state === 'error' && <div style={{ padding: 40, textAlign: 'center', fontSize: 14, color: 'var(--k-991b1b)' }}>Couldn’t show this file{msg ? ` — ${msg}` : ''}. It will still be attached when you send.</div>}
          {state === 'none' && <div style={{ padding: 40, textAlign: 'center', fontSize: 14, color: 'var(--k-6b7280)' }}>No preview for this kind of file — it will be attached as “{item.name}”.</div>}
          {sheets.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 6, boxShadow: '0 1px 8px rgba(0,0,0,.12)', overflow: 'hidden' }}>
              <style>{`.attsheet table:not(.xr){border-collapse:collapse;width:100%;font-family:-apple-system,'DM Sans',sans-serif}.attsheet table:not(.xr) td,.attsheet table:not(.xr) th{border:1px solid #e5e7eb;padding:5px 9px;font-size:12.5px;color:#1a1a1a;white-space:nowrap;text-align:left}.attsheet table:not(.xr) tr:first-child td,.attsheet table:not(.xr) th{background:#f9fafb;font-weight:700}`}</style>
              {sheets.length > 1 && <div style={{ display: 'flex', gap: 4, padding: '8px 8px 0', flexWrap: 'wrap', borderBottom: '1px solid #eef0f2', background: '#fbfbfc' }}>
                {sheets.map((sh, i) => <button key={sh.name} type="button" onClick={() => setSheet(i)} style={{ fontSize: 12, fontWeight: 700, padding: '5px 11px', border: 'none', borderBottom: sheet === i ? '2px solid #c9922c' : '2px solid transparent', background: 'none', color: sheet === i ? '#a06a12' : '#6b7280', cursor: 'pointer' }}>{sh.name}</button>)}
              </div>}
              {/* Sanitized like the deal-doc viewer: a crafted workbook can carry javascript: links or raw markup. */}
              {sheets[sheet]?.rich && <style>{XR_CSS}</style>}
              <div className="attsheet" style={{ overflow: 'auto', touchAction: 'pan-x pan-y pinch-zoom' }}><div style={{ zoom }} dangerouslySetInnerHTML={{ __html: sheets[sheet]?.rich ? sheets[sheet].html : sanitizeHtml(sheets[sheet]?.html || '') }} /></div>
            </div>
          )}
          {kind === 'doc' && <>
            <style>{`.attdocx .docx-wrapper{background:transparent!important;padding:0!important}.attdocx .docx-wrapper>section.docx{box-shadow:0 1px 8px rgba(0,0,0,.16)!important;margin:0 auto 14px!important;max-width:100%}`}</style>
            <div ref={docHost} className="attdocx" style={{ display: docHtml ? 'none' : 'block', overflowX: 'auto' }} />
          </>}
          {docHtml && <div style={{ background: '#fff', borderRadius: 6, boxShadow: '0 1px 8px rgba(0,0,0,.12)', padding: p.isMobile ? 16 : 36, fontSize: 14, lineHeight: 1.6, color: '#1a1a1a', maxWidth: 820, margin: '0 auto' }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(docHtml) }} />}
          {imgSrc && /* eslint-disable-next-line @next/next/no-img-element */ <img src={imgSrc} alt={item.name} style={{ display: 'block', maxWidth: '100%', margin: '0 auto', borderRadius: 4, boxShadow: '0 1px 8px rgba(0,0,0,.16)', background: '#fff' }} />}
          {pages.map((pg, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={pg.src} alt={`${item.name} page ${i + 1}`} style={{ display: 'block', width: '100%', maxWidth: 820, margin: '0 auto 16px', borderRadius: 4, boxShadow: '0 1px 8px rgba(0,0,0,.16)', background: '#fff' }} />
          ))}
        </div>
      </div>
    </div>
  );
}
