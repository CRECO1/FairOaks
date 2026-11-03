'use client';
import * as Y from 'yjs';
import { fromBase64 } from 'lib0/buffer';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { docToPdf, pdfName, saveBytes, type PMNode } from '@/lib/doc-pdf';

/** A live document's saved content as ProseMirror JSON (for a read-only preview or a PDF), straight from the server copy. */
export async function loadDocJson(docId: string, authToken?: string): Promise<{ title: string; json: PMNode; empty: boolean; letterhead: boolean }> {
  const r = await fetch(`/api/crm/drive/doc-state/${docId}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || 'Could not open this document');
  const d = new Y.Doc();
  try {
    if (j.state) Y.applyUpdate(d, fromBase64(j.state as string));
    const json = yXmlFragmentToProsemirrorJSON(d.getXmlFragment('default')) as PMNode;
    return { title: (j.doc?.title as string) || 'Document', json, empty: !j.state, letterhead: d.getMap('meta').get('letterhead') === true };
  } finally { d.destroy(); }
}

/** Build the Word (.docx) file for a document and download it. */
export async function exportDocDocx(docId: string, authToken?: string, titleHint?: string): Promise<void> {
  const { title, json, letterhead } = await loadDocJson(docId, authToken);
  const t = titleHint || title;
  const { docToDocx, docxName, DOCX_MIME } = await import('@/lib/doc-docx');   // loaded only when someone asks for Word
  saveBytes(await docToDocx(json, t, { letterhead }), docxName(t), DOCX_MIME);
}

/** Build the PDF for a document and download it. */
export async function exportDocPdf(docId: string, authToken?: string, titleHint?: string): Promise<void> {
  const { title, json, letterhead } = await loadDocJson(docId, authToken);
  const t = titleHint || title;
  saveBytes(await docToPdf(json, t, { letterhead }), pdfName(t));
}
