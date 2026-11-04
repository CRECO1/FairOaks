'use client';

/**
 * DocQuickView — look at a document without opening it: a read-only copy of what is saved, in a side panel on desktop and a bottom
 * sheet on phones, with Open (the full live editor) and Download as PDF one tap away.
 */
import { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { docExtensions } from './doc-extensions';
import { DocStyles } from './DocStyles';
import { LetterheadHeader, LetterheadFooter } from './Letterhead';
import { loadDocJson } from './doc-export';
import { docToPdf, pdfName, saveBytes, type PMNode } from '@/lib/doc-pdf';
import * as Y from 'yjs';
import { fromBase64 } from 'lib0/buffer';
import { colName, displayVal, listTabs, readRangeFromDoc, SheetError } from '@/lib/drive-sheet';

export default function DocQuickView({ docId, authToken, isMobile, onClose, onOpen, onToast }: {
  docId: string; authToken?: string; isMobile: boolean; onClose: () => void; onOpen: (id: string) => void; onToast: (m: string) => void;
}) {
  const [doc, setDoc] = useState<{ title: string; json: PMNode; empty: boolean; letterhead: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A spreadsheet previews as a read-only table of its first rows, one button per tab.
  const [sheet, setSheet] = useState<{ title: string; tabs: Array<{ name: string; grid: string[][]; rows: number }> } | null>(null);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await fetch(`/api/crm/drive/doc-state/${docId}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
        const j = await r.json().catch(() => ({}));
        if (!off && r.ok && j.doc?.kind === 'sheet') {
          const y = new Y.Doc();
          try {
            if (j.state) Y.applyUpdate(y, fromBase64(j.state));
            const tabs = listTabs(y).map(t => {
              const grid = readRangeFromDoc(y, `${t.name}!A1:N60`).map(row => row.map(v => (v instanceof SheetError ? v.code : displayVal(v))));
              let last = grid.length - 1; while (last > 0 && grid[last].every(x => x === '')) last--;
              return { name: t.name, grid: grid.slice(0, last + 1), rows: Number(t.map.get('rows') ?? 0) };
            });
            if (!off) setSheet({ title: String(j.doc.title ?? 'Spreadsheet'), tabs });
          } finally { y.destroy(); }
          return;
        }
      } catch { /* fall through to the document preview */ }
      loadDocJson(docId, authToken).then(d => { if (!off) setDoc(d); }).catch(e => { if (!off) setErr((e as Error).message); });
    })();
    return () => { off = true; };
  }, [docId, authToken]);
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions: docExtensions(), content: (doc?.json ?? '') as never, editorProps: { attributes: { class: 'drive-doc' } } }, [doc]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const pdf = async () => {
    if (!doc) return;
    setBusy(true);
    try { saveBytes(await docToPdf(doc.json, doc.title, { letterhead: doc.letterhead }), pdfName(doc.title)); } catch { onToast('Could not make the PDF'); }
    setBusy(false);
  };
  const word = async () => {
    if (!doc) return;
    setBusy(true);
    try { const { docToDocx, docxName, DOCX_MIME } = await import('@/lib/doc-docx'); saveBytes(await docToDocx(doc.json, doc.title, { letterhead: doc.letterhead }), docxName(doc.title), DOCX_MIME); } catch { onToast('Could not make the Word file'); }
    setBusy(false);
  };
  const btn: React.CSSProperties = { height: isMobile ? 42 : 34, padding: '0 14px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(17,17,17,.4)', display: 'flex', justifyContent: 'flex-end', alignItems: isMobile ? 'flex-end' : 'stretch' }}>
      <div role="dialog" aria-label="Quick look" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--k-fff)', display: 'flex', flexDirection: 'column', width: isMobile ? '100%' : 'min(680px, 94vw)', height: isMobile ? '88dvh' : '100%', borderRadius: isMobile ? '18px 18px 0 0' : 0, boxShadow: '-12px 0 40px rgba(0,0,0,.22)', paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--k-eef0f2)', flexShrink: 0, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sheet?.title ?? doc?.title ?? 'Quick look'}</div>
            <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{sheet ? 'Read-only preview of the first rows' : 'Read-only preview of the saved document'}</div>
          </div>
          <button type="button" onClick={() => onOpen(docId)} style={{ ...btn, background: '#c9922c', color: '#fff', border: 'none' }}>Open ↗</button>
          {!sheet && <button type="button" onClick={() => void pdf()} disabled={!doc || busy} style={btn}>{busy ? '…' : '⬇ PDF'}</button>}
          {!sheet && <button type="button" onClick={() => void word()} disabled={!doc || busy} style={btn}>{busy ? '…' : '⬇ Word'}</button>}
          <button type="button" onClick={onClose} aria-label="Close preview" style={{ width: isMobile ? 42 : 34, height: isMobile ? 42 : 34, border: 'none', borderRadius: 8, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--k-f3f4f6)', padding: isMobile ? 0 : '18px 14px 40px' }}>
          {err && <div style={{ padding: 24, color: 'var(--k-374151)', fontSize: 14 }}>{err}</div>}
          {!err && !doc && !sheet && <div style={{ padding: 24, color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading…</div>}
          {sheet && (() => {
            const t = sheet.tabs[Math.min(tab, sheet.tabs.length - 1)];
            const cols = Math.max(1, ...t.grid.map(r => r.length));
            return (
              <div style={{ background: 'var(--k-fff)', minHeight: '100%' }}>
                {sheet.tabs.length > 1 && <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--k-eef0f2)', overflowX: 'auto' }}>{sheet.tabs.map((x, i) => <button key={i} type="button" onClick={() => setTab(i)} style={{ ...btn, height: 30, padding: '0 10px', background: i === tab ? 'var(--k-fdf6e9)' : 'var(--k-fff)', color: i === tab ? '#a06a12' : 'var(--k-374151)' }}>{x.name}</button>)}</div>}
                <div style={{ overflow: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
                    <thead><tr><th style={{ background: 'var(--k-f3f4f6)', width: 34 }} />{Array.from({ length: cols }, (_, c) => <th key={c} style={{ background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontWeight: 600, padding: '4px 8px', border: '1px solid var(--k-e5e7eb)', minWidth: 90 }}>{colName(c)}</th>)}</tr></thead>
                    <tbody>{t.grid.map((row, r) => <tr key={r}><td style={{ background: 'var(--k-f3f4f6)', color: 'var(--k-9ca3af)', textAlign: 'center', border: '1px solid var(--k-e5e7eb)' }}>{r + 1}</td>{Array.from({ length: cols }, (_, c) => <td key={c} style={{ padding: '4px 8px', border: '1px solid var(--k-e5e7eb)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: r === 0 ? 700 : 400 }}>{row[c] ?? ''}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--k-9ca3af)' }}>Showing up to the first 60 rows and 14 columns. Open it to see everything.</div>
              </div>
            );
          })()}
          {doc && (
            <div style={{ background: 'var(--k-fff)', borderRadius: isMobile ? 0 : 4, boxShadow: isMobile ? 'none' : '0 1px 3px rgba(0,0,0,.12)', padding: isMobile ? '16px 16px 60px' : '34px 40px 50px', minHeight: isMobile ? '100%' : 320 }}>
              {doc.letterhead && <LetterheadHeader />}
              {doc.empty ? <div style={{ color: 'var(--k-9ca3af)', fontSize: 14 }}>This document is empty so far.</div> : <EditorContent editor={editor} />}
              {doc.letterhead && <LetterheadFooter />}
            </div>
          )}
        </div>
      </div>
      <DocStyles />
    </div>
  );
}
