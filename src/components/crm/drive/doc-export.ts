'use client';
import * as Y from 'yjs';
import { fromBase64 } from 'lib0/buffer';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { LETTERHEAD, docToPdf, pdfName, saveBytes, type PMNode } from '@/lib/doc-pdf';
import { Editor } from '@tiptap/core';
import { docExtensions } from './doc-extensions';

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

const escHtml = (v: string) => v.replace(/[&<>"]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
const PRINT_CSS = `
@page{size:letter;margin:.75in}
html,body{margin:0;padding:0;background:#fff}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;color:#111;overflow-wrap:anywhere}
.doc>*+*{margin-top:.55em}
.doc h1{font-size:20pt;line-height:1.25;margin:.9em 0 .3em}.doc h2{font-size:15pt;line-height:1.3;margin:.9em 0 .3em}.doc h3{font-size:12.5pt;line-height:1.35;margin:.8em 0 .2em}
.doc ul,.doc ol{padding-left:1.5em}.doc ul{list-style:disc}.doc ol{list-style:decimal}.doc li>p{margin:0}
.doc ul[data-type="taskList"]{list-style:none;padding-left:.2em}.doc ul[data-type="taskList"] li{display:flex;gap:8px;align-items:flex-start}
.doc ul[data-type="taskList"] li>label{flex:0 0 auto;margin-top:.25em}.doc ul[data-type="taskList"] li>div{flex:1;min-width:0}
.doc ul[data-type="taskList"] li[data-checked="true"]>div{text-decoration:line-through;color:#6b7280}
.doc blockquote{border-left:3px solid #c9922c;margin-left:0;padding:2px 0 2px 14px;color:#4b5563}
.doc hr{border:none;border-top:1px solid #d1d5db;margin:1.1em 0}
.doc a{color:#1d4ed8;text-decoration:underline}.doc mark{color:inherit;border-radius:2px;padding:0 1px}
.doc code{background:#f3f4f6;border-radius:4px;padding:1px 5px;font-size:.9em}.doc pre{background:#f3f4f6;border-radius:8px;padding:10px 12px;white-space:pre-wrap}
.doc table{border-collapse:collapse;width:100%;margin:.7em 0;table-layout:auto}.doc table td,.doc table th{border:1px solid #d1d5db;padding:5px 8px;vertical-align:top}
.doc table th{background:#f3f4f6;font-weight:700;text-align:left}.doc table td>p,.doc table th>p{margin:0}
.doc img{max-width:100%;height:auto}tr,img{break-inside:avoid}h1,h2,h3{break-after:avoid}
.doc .crm-ref{display:inline-block;padding:0 6px;border-radius:10px;background:#fdf6e9;color:#8a5a0b;border:1px solid #ecd9b0;font-size:.92em}
/* review marks do not print: comment highlights off, proposed deletions hidden, proposed additions as normal text */
.doc .comment-hl{background:none;border:none}.doc .sg-del{display:none}.doc .sg-add{color:inherit;background:none;text-decoration:none}
.lh-top{text-align:center;margin-bottom:18px}.lh-top img{display:block;width:240px;max-width:66%;margin:0 auto 6px}
.lh-top .c{font-size:8pt;color:#57595e;white-space:pre-wrap}.lh-top .r{border-bottom:2.4px solid #1c1c1f;margin-top:8px}
.lh-foot{border-top:2.4px solid #1c1c1f;margin-top:32px;padding-top:8px;text-align:center}.lh-foot .t{font-style:italic;font-size:8.5pt;color:#3a3a3f}.lh-foot .c{font-size:7.5pt;color:#57595e;margin-top:2px;white-space:pre-wrap}
`;

/** A document as a standalone print page (letterhead included), built from its saved content with the same editor schema. */
export async function docPrintHtml(docId: string, authToken?: string, titleHint?: string): Promise<string> {
  const { title, json, letterhead } = await loadDocJson(docId, authToken);
  const ed = new Editor({ extensions: docExtensions(), content: json as never });
  let body = '';
  try { body = ed.getHTML(); } finally { ed.destroy(); }
  const origin = window.location.origin;
  const logo = LETTERHEAD.logoPath.startsWith('http') ? LETTERHEAD.logoPath : `${origin}${LETTERHEAD.logoPath}`;
  const top = letterhead ? `<div class="lh-top"><img src="${escHtml(logo)}" alt="CRECO"><div class="c">${escHtml(LETTERHEAD.contact)}</div><div class="r"></div></div>` : '';
  const foot = letterhead ? `<div class="lh-foot"><div class="t">${escHtml(LETTERHEAD.tagline)}</div><div class="c">${escHtml(LETTERHEAD.footContact)}</div></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'"><title>${escHtml(titleHint || title)}</title><style>${PRINT_CSS}</style></head><body>${top}<div class="doc">${body}</div>${foot}</body></html>`;
}

/** Print a document straight from the app: its pages (letterhead, fonts, sizes, colours) go to the browser's print dialog, no download first. */
export async function printDoc(docId: string, authToken?: string, titleHint?: string): Promise<void> {
  const html = await docPrintHtml(docId, authToken, titleHint);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  let printed = false;
  const run = () => {
    const w = frame.contentWindow; if (!w || printed) return;
    printed = true;
    const imgs = Array.from(w.document.images).filter(i => !i.complete);
    Promise.all(imgs.map(i => new Promise<void>(res => { i.onload = i.onerror = () => res(); }))).then(() => setTimeout(() => { try { w.focus(); w.print(); } catch { const win = window.open('', '_blank'); if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 400); } } }, 150));
  };
  frame.onload = run;
  frame.srcdoc = html;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 180_000);
}
