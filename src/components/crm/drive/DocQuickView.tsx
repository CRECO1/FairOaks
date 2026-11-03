'use client';

/**
 * DocQuickView — look at a document without opening it: a read-only copy of what is saved, in a side panel on desktop and a bottom
 * sheet on phones, with Open (the full live editor) and Download as PDF one tap away.
 */
import { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { docExtensions } from './doc-extensions';
import { DocStyles } from './DocStyles';
import { loadDocJson } from './doc-export';
import { docToPdf, pdfName, saveBytes, type PMNode } from '@/lib/doc-pdf';

export default function DocQuickView({ docId, authToken, isMobile, onClose, onOpen, onToast }: {
  docId: string; authToken?: string; isMobile: boolean; onClose: () => void; onOpen: (id: string) => void; onToast: (m: string) => void;
}) {
  const [doc, setDoc] = useState<{ title: string; json: PMNode; empty: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false;
    loadDocJson(docId, authToken).then(d => { if (!off) setDoc(d); }).catch(e => { if (!off) setErr((e as Error).message); });
    return () => { off = true; };
  }, [docId, authToken]);
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions: docExtensions(), content: (doc?.json ?? '') as never, editorProps: { attributes: { class: 'drive-doc' } } }, [doc]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const pdf = async () => {
    if (!doc) return;
    setBusy(true);
    try { saveBytes(await docToPdf(doc.json, doc.title), pdfName(doc.title)); } catch { onToast('Could not make the PDF'); }
    setBusy(false);
  };
  const btn: React.CSSProperties = { height: isMobile ? 42 : 34, padding: '0 14px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(17,17,17,.4)', display: 'flex', justifyContent: 'flex-end', alignItems: isMobile ? 'flex-end' : 'stretch' }}>
      <div role="dialog" aria-label="Quick look" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--k-fff)', display: 'flex', flexDirection: 'column', width: isMobile ? '100%' : 'min(680px, 94vw)', height: isMobile ? '88dvh' : '100%', borderRadius: isMobile ? '18px 18px 0 0' : 0, boxShadow: '-12px 0 40px rgba(0,0,0,.22)', paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--k-eef0f2)', flexShrink: 0, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc?.title ?? 'Quick look'}</div>
            <div style={{ fontSize: 11.5, color: 'var(--k-9ca3af)' }}>Read-only preview of the saved document</div>
          </div>
          <button type="button" onClick={() => onOpen(docId)} style={{ ...btn, background: '#c9922c', color: '#fff', border: 'none' }}>Open ↗</button>
          <button type="button" onClick={() => void pdf()} disabled={!doc || busy} style={btn}>{busy ? '…' : '⬇ PDF'}</button>
          <button type="button" onClick={onClose} aria-label="Close preview" style={{ width: isMobile ? 42 : 34, height: isMobile ? 42 : 34, border: 'none', borderRadius: 8, background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--k-f3f4f6)', padding: isMobile ? 0 : '18px 14px 40px' }}>
          {err && <div style={{ padding: 24, color: 'var(--k-374151)', fontSize: 14 }}>{err}</div>}
          {!err && !doc && <div style={{ padding: 24, color: 'var(--k-9ca3af)', fontSize: 14 }}>Loading…</div>}
          {doc && (
            <div style={{ background: 'var(--k-fff)', borderRadius: isMobile ? 0 : 4, boxShadow: isMobile ? 'none' : '0 1px 3px rgba(0,0,0,.12)', padding: isMobile ? '16px 16px 60px' : '34px 40px 50px', minHeight: isMobile ? '100%' : 320 }}>
              {doc.empty ? <div style={{ color: 'var(--k-9ca3af)', fontSize: 14 }}>This document is empty so far.</div> : <EditorContent editor={editor} />}
            </div>
          )}
        </div>
      </div>
      <DocStyles />
    </div>
  );
}
