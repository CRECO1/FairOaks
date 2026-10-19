// Text edits on uploaded Word (.docx) and PDF files, for the Copilot.
//
// DOCX is edited for real: the paragraph XML inside the file is changed (replace, delete a paragraph, insert a
// paragraph), keeping the surrounding formatting, so what comes out is an ordinary editable Word document.
//
// PDF has no paragraphs to edit — it is positioned glyphs — so:
//   • add_text   writes new text at a place found from an anchor phrase (to its right / below / above) or at
//                explicit coordinates, and REFUSES if it would print over existing text;
//   • remove_text covers the found text with a white box. By default that only hides it (the words stay in the
//                file's text layer and can still be selected/copied); with `permanent` the affected pages are
//                re-built as images so the text is truly gone.
// Callers get a human-readable report and a list of warnings for everything that was done or skipped.
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface EditResult { bytes: Uint8Array; report: string[]; warnings: string[] }
export type EditSpec = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// ───────────────────────────────── DOCX ─────────────────────────────────
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
type El = Element;
const kids = (list: HTMLCollectionOf<Element> | NodeListOf<Element>): El[] => Array.from(list as unknown as ArrayLike<El>);
const allParagraphs = (d: Document) => kids(d.getElementsByTagNameNS(W, 'p'));
const textNodes = (p: El) => kids(p.getElementsByTagNameNS(W, 't'));
const paraText = (p: El) => textNodes(p).map(t => t.textContent ?? '').join('');
const clip = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const setText = (t: El, s: string) => { t.textContent = s; t.setAttribute('xml:space', 'preserve'); };

function findAll(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  // exact first; if the exact text never occurs, tolerate a difference in case only
  const h = hay.includes(needle) ? hay : hay.toLowerCase();
  const n = hay.includes(needle) ? needle : needle.toLowerCase();
  for (let i = h.indexOf(n, from); i !== -1; i = h.indexOf(n, from)) { out.push(i); from = i + n.length; }
  return out;
}

/** Replace every occurrence of `find` inside one paragraph, across run boundaries, keeping the first run's formatting. */
function replaceInParagraph(p: El, find: string, repl: string): number {
  const nodes = textNodes(p);
  const texts = nodes.map(t => t.textContent ?? '');
  const full = texts.join('');
  const hits = findAll(full, find);
  if (!hits.length) return 0;
  const starts: number[] = []; let acc = 0;
  for (const t of texts) { starts.push(acc); acc += t.length; }
  const nodeAt = (idx: number) => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= idx) k++; return k; };
  // right-to-left, so earlier offsets stay valid while later text changes
  for (const s of [...hits].reverse()) {
    const e = s + find.length;
    const i = nodeAt(s), j = nodeAt(e - 1);
    const a = s - starts[i], b = e - starts[j];
    if (i === j) setText(nodes[i], texts[i].slice(0, a) + repl + texts[i].slice(b));
    else {
      setText(nodes[i], texts[i].slice(0, a) + repl);
      for (let k = i + 1; k < j; k++) setText(nodes[k], '');
      setText(nodes[j], texts[j].slice(b));
    }
    // keep later same-node edits consistent: refresh this node's cached text
    texts[i] = nodes[i].textContent ?? ''; texts[j] = nodes[j].textContent ?? '';
  }
  return hits.length;
}

function makeParagraphLike(doc: Document, ref: El, text: string, keepNumbering: boolean): El {
  const np = ref.cloneNode(true) as El;
  // a paragraph = optional properties + runs; keep only the properties and rebuild one run
  const pPr = kids(np.childNodes as unknown as NodeListOf<Element>).find(c => c.localName === 'pPr');
  const firstRun = kids(ref.getElementsByTagNameNS(W, 'r'))[0];
  const rPr = firstRun ? kids(firstRun.childNodes as unknown as NodeListOf<Element>).find(c => c.localName === 'rPr') : undefined;
  while (np.firstChild) np.removeChild(np.firstChild);
  if (pPr) {
    if (!keepNumbering) for (const n of kids(pPr.getElementsByTagNameNS(W, 'numPr'))) n.parentNode?.removeChild(n);
    np.appendChild(pPr);
  }
  const r = doc.createElementNS(W, 'w:r');
  if (rPr) r.appendChild(rPr.cloneNode(true));
  const t = doc.createElementNS(W, 'w:t');
  setText(t, text);
  r.appendChild(t); np.appendChild(r);
  return np;
}

export async function editDocx(input: Uint8Array | Buffer, edits: EditSpec[]): Promise<EditResult> {
  const zip = await JSZip.loadAsync(input);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('That does not look like a Word document (no word/document.xml).');
  const doc = new DOMParser().parseFromString(await entry.async('string'), 'text/xml');
  const report: string[] = [], warnings: string[] = [];

  for (const e of edits) {
    const op = str(e.op);
    if (op === 'replace' || op === 'delete_text') {
      const find = str(e.find);
      const repl = op === 'delete_text' ? '' : str(e.replace);
      if (!find) { warnings.push(`${op}: nothing to find.`); continue; }
      let n = 0;
      for (const p of allParagraphs(doc)) n += replaceInParagraph(p, find, repl);
      // wording that wraps across two paragraphs can't be matched here
      if (!n) warnings.push(`Could not find “${clip(find)}” — no change made for it.`);
      else report.push(op === 'delete_text' ? `Removed “${clip(find)}” (${n}×)` : `Replaced “${clip(find)}” with “${clip(repl)}” (${n}×)`);
    } else if (op === 'delete_paragraph') {
      const containing = str(e.containing || e.find);
      const hits = allParagraphs(doc).filter(p => paraText(p).includes(containing) || paraText(p).toLowerCase().includes(containing.toLowerCase()));
      if (!containing || !hits.length) { warnings.push(`No paragraph contains “${clip(containing)}” — nothing deleted.`); continue; }
      if (hits.length > 1 && e.all !== true) {
        warnings.push(`${hits.length} paragraphs contain “${clip(containing)}” (${hits.slice(0, 3).map(p => `“${clip(paraText(p), 40)}”`).join('; ')}) — nothing deleted; give more of the paragraph's wording, or set all.`);
        continue;
      }
      for (const p of hits) {
        const parent = p.parentNode as El | null;
        const onlyChild = parent && parent.localName === 'tc' && kids(parent.childNodes as unknown as NodeListOf<Element>).filter(c => c.localName === 'p').length === 1;
        if (onlyChild) for (const t of textNodes(p)) setText(t, ''); else parent?.removeChild(p);
        report.push(`Deleted the paragraph “${clip(paraText(p) || containing, 80)}”`);
      }
    } else if (op === 'insert_paragraph') {
      const text = str(e.text);
      if (!text.trim()) { warnings.push('insert_paragraph: no text given.'); continue; }
      const lines = text.split(/\r?\n/).filter(l => l.length);
      const body = kids(doc.getElementsByTagNameNS(W, 'body'))[0];
      const bodyParas = kids(body.childNodes as unknown as NodeListOf<Element>).filter(c => c.localName === 'p');
      let ref: El | undefined, before = false, keepNum = true;
      const after = str(e.after);
      if (after) {
        const hits = allParagraphs(doc).filter(p => paraText(p).includes(after) || paraText(p).toLowerCase().includes(after.toLowerCase()));
        if (!hits.length) { warnings.push(`No paragraph contains “${clip(after)}” — nothing inserted.`); continue; }
        if (hits.length > 1) { warnings.push(`${hits.length} paragraphs contain “${clip(after)}” — nothing inserted; give more of that paragraph's wording.`); continue; }
        ref = hits[0];
      } else if (e.position === 'start') { ref = bodyParas[0]; before = true; keepNum = false; }
      else { ref = bodyParas[bodyParas.length - 1]; keepNum = false; }
      if (!ref) { warnings.push('The document has no paragraph to place text next to.'); continue; }
      let anchor: El = ref;
      for (const l of lines) {
        const np = makeParagraphLike(doc, ref, l, keepNum);
        if (before) { ref.parentNode!.insertBefore(np, anchor); }
        else { anchor.parentNode!.insertBefore(np, anchor.nextSibling); anchor = np; }
      }
      report.push(`Inserted ${lines.length === 1 ? 'a paragraph' : `${lines.length} paragraphs`} ${after ? `after “${clip(after, 50)}”` : e.position === 'start' ? 'at the start' : 'at the end'}: “${clip(lines[0], 70)}”`);
    } else warnings.push(`Unknown edit “${op}” for a Word document (use replace, delete_text, delete_paragraph or insert_paragraph).`);
  }
  if (!report.length) return { bytes: new Uint8Array(0), report, warnings };
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  // prove the result opens before anyone is told it worked
  const mammoth = await import('mammoth');
  await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return { bytes, report, warnings };
}

// ───────────────────────────────── PDF ──────────────────────────────────
interface Item { str: string; x: number; y: number; w: number; h: number }
interface PageText { width: number; height: number; items: Item[] }
interface Rect { x0: number; x1: number; y: number; h: number }

/** pdf.js options shared by reading and rendering. Non-embedded standard fonts (Helvetica, Times…) need their data files to draw. */
function pdfjsOptions(bytes: Uint8Array) {
  const dir = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
  return { data: new Uint8Array(bytes.slice(0)), password: '', ...(fs.existsSync(dir) ? { standardFontDataUrl: dir } : {}) };
}

async function readPdfText(bytes: Uint8Array): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument(pdfjsOptions(bytes));
  const pdf = await task.promise;
  const pages: PageText[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str) continue;
        const t = it.transform;
        items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: it.height || Math.hypot(t[2], t[3]) || 10 });
      }
      pages.push({ width, height, items });
    }
  } finally { void task.destroy(); }
  return pages;
}

/** Where `phrase` sits on a page: one rectangle per line it spans. */
function locate(page: PageText, phrase: string, measure?: (s: string) => number): Rect[][] {
  const chars: string[] = []; const map: { i: number; o: number }[] = [];
  const push = (c: string, i: number, o: number) => { if (/\s/.test(c)) { if (chars.length && chars[chars.length - 1] !== ' ') { chars.push(' '); map.push({ i, o }); } } else { chars.push(c.toLowerCase()); map.push({ i, o }); } };
  page.items.forEach((it, i) => {
    if (i > 0) {
      const prev = page.items[i - 1];
      const sameLine = Math.abs(prev.y - it.y) < Math.max(prev.h, it.h) * 0.6;
      if (!sameLine || it.x - (prev.x + prev.w) > it.h * 0.25) push(' ', i - 1, Math.max(0, prev.str.length - 1));
    }
    for (let o = 0; o < it.str.length; o++) push(it.str[o], i, o);
  });
  const hay = chars.join('');
  const needle = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
  const out: Rect[][] = [];
  if (!needle) return out;
  for (let s = hay.indexOf(needle); s !== -1; s = hay.indexOf(needle, s + needle.length)) {
    const byItem = new Map<number, { a: number; b: number }>();
    for (let k = s; k < s + needle.length; k++) {
      const m = map[k]; const cur = byItem.get(m.i);
      if (cur) { cur.a = Math.min(cur.a, m.o); cur.b = Math.max(cur.b, m.o); } else byItem.set(m.i, { a: m.o, b: m.o });
    }
    const lines: Rect[] = [];
    for (const [i, { a, b }] of byItem) {
      const it = page.items[i]; const len = it.str.length || 1;
      // Where inside a long text item does the phrase start/end? Characters aren't equal width, so weigh each by a
      // real font's metrics (Helvetica's, as a stand-in) — counting characters left a sliver of the old text showing.
      const full = measure ? measure(it.str) : 0;
      const frac = (n: number) => (measure && full > 0 ? measure(it.str.slice(0, n)) / full : n / len);
      const partial = a > 0 || b + 1 < it.str.length;
      const r: Rect = { x0: it.x + it.w * frac(a) - (partial ? 1.4 : 0), x1: it.x + it.w * frac(b + 1) + (partial ? 0.6 : 0), y: it.y, h: it.h };
      const same = lines.find(l => Math.abs(l.y - r.y) < Math.max(l.h, r.h) * 0.6);
      if (same) { same.x0 = Math.min(same.x0, r.x0); same.x1 = Math.max(same.x1, r.x1); } else lines.push(r);
    }
    out.push(lines);
  }
  return out;
}

const sane = (s: string) => s.replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');
/** The part of a text item that is actual writing — trailing blanks (underscores, dots, spaces) are not "text" to avoid. */
function inkRect(it: Item): { x0: number; x1: number; y0: number; y1: number } | null {
  const len = it.str.length || 1;
  const first = it.str.search(/[A-Za-z0-9]/);
  if (first === -1) return null;
  let last = it.str.length - 1; while (last > first && !/[A-Za-z0-9]/.test(it.str[last])) last--;
  return { x0: it.x + it.w * (first / len), x1: it.x + it.w * ((last + 1) / len), y0: it.y - it.h * 0.2, y1: it.y + it.h * 0.9 };
}
const overlaps = (a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Re-build the given pages as images, so any text under a cover box is gone from the file. Throws if the renderer is unavailable. */
async function flattenPages(bytes: Uint8Array, pageNumbers: number[]): Promise<Uint8Array> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const task = pdfjs.getDocument(pdfjsOptions(bytes));
  const pdf = await task.promise;
  const out = await PDFDocument.load(bytes);
  try {
    const SCALE = 2.4;   // ≈170 dpi: crisp enough to read and print, small enough to keep the file reasonable
    for (const n of pageNumbers) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.render({ canvasContext: ctx as any, canvas: canvas as any, viewport: vp }).promise;
      const png = canvas.toBuffer('image/png');
      const img = await out.embedPng(png);
      const target = out.getPage(n - 1);
      const { width, height } = target.getSize();
      // swap the page for a fresh one carrying only the picture, at the same size and position in the document
      out.removePage(n - 1);
      const fresh = out.insertPage(n - 1, [width, height]);
      fresh.drawImage(img, { x: 0, y: 0, width, height });
    }
  } finally { void task.destroy(); }
  return out.save();
}

export async function editPdf(input: Uint8Array | Buffer, edits: EditSpec[]): Promise<EditResult> {
  const bytes0 = new Uint8Array(input);
  const pages = await readPdfText(bytes0);
  const pdf = await PDFDocument.load(bytes0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const report: string[] = [], warnings: string[] = [];
  const coveredPages = new Set<number>(); let wantPermanent = false;
  const measure = (s: string) => { try { return font.widthOfTextAtSize(sane(s), 10); } catch { return s.length * 5; } };
  const pageNo = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= pages.length ? n : 0; };

  for (const e of edits) {
    const op = str(e.op);
    if (op === 'remove_text') {
      const find = str(e.find);
      if (!find) { warnings.push('remove_text: nothing to find.'); continue; }
      const wanted = e.page ? [pageNo(e.page)].filter(Boolean) : pages.map((_, i) => i + 1);
      const found: { n: number; lines: Rect[] }[] = [];
      for (const n of wanted) for (const lines of locate(pages[n - 1], find, measure)) found.push({ n, lines });
      if (!found.length) { warnings.push(`Could not find “${clip(find)}” in the PDF${pages.every(p => !p.items.length) ? ' — it has no selectable text (it may be a scan)' : ''}.`); continue; }
      if (found.length > 1 && e.all !== true) { warnings.push(`“${clip(find)}” appears ${found.length} times (pages ${[...new Set(found.map(f => f.n))].join(', ')}) — nothing removed; say which page, or set all.`); continue; }
      for (const f of found) {
        const pg = pdf.getPage(f.n - 1);
        for (const r of f.lines) pg.drawRectangle({ x: r.x0 - 1.5, y: r.y - r.h * 0.28, width: r.x1 - r.x0 + 3, height: r.h * 1.3, color: rgb(1, 1, 1), borderWidth: 0 });
        coveredPages.add(f.n);
      }
      if (e.permanent === true) wantPermanent = true;
      report.push(`Removed “${clip(find)}” (${found.length}×, page${found.length === 1 ? '' : 's'} ${[...new Set(found.map(f => f.n))].join(', ')})`);
    } else if (op === 'add_text') {
      const text = sane(str(e.text));
      if (!text.trim()) { warnings.push('add_text: no text given.'); continue; }
      const anchor = str(e.anchor);
      let n = pageNo(e.page), x = 0, y = 0, size = Number(e.size) > 0 ? Math.min(Number(e.size), 36) : 0, aRect: Rect | null = null;
      if (anchor) {
        const order = n ? [n] : pages.map((_, i) => i + 1);
        for (const k of order) { const hit = locate(pages[k - 1], anchor, measure)[0]; if (hit) { n = k; aRect = hit[hit.length - 1]; break; } }
        if (!aRect) { warnings.push(`Could not find “${clip(anchor)}” to place the text next to — nothing added.`); continue; }
        size = size || Math.min(12, Math.max(8, Math.round(aRect.h * 0.95)));
        const placement = str(e.placement) || 'right';
        if (placement === 'below') { x = aRect.x0; y = aRect.y - size * 1.5; }
        else if (placement === 'above') { x = aRect.x0; y = aRect.y + aRect.h + 3; }
        else { x = aRect.x1 + 6; y = aRect.y; }
      } else {
        n = n || 1; size = size || 10;
        if (typeof e.x !== 'number' || typeof e.y !== 'number') { warnings.push('add_text needs an anchor phrase, or both x and y (points from the top-left corner).'); continue; }
        x = e.x; y = pages[n - 1].height - e.y;   // callers measure from the top
      }
      const page = pages[n - 1];
      const maxW = page.width - 36 - x;
      if (maxW < 40) { warnings.push('There is no room to the right of that spot on the page — try placement "below".'); continue; }
      // wrap to the space available
      const lines: string[] = []; let cur = '';
      for (const w of text.split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (cur && font.widthOfTextAtSize(t, size) > maxW) { lines.push(cur); cur = w; } else cur = t; }
      if (cur) lines.push(cur);
      const lh = size * 1.3;
      const box = { x0: x, x1: x + Math.max(...lines.map(l => font.widthOfTextAtSize(l, size))), y0: y - (lines.length - 1) * lh - size * 0.25, y1: y + size };
      if (box.y0 < 18 || box.y1 > page.height - 10) { warnings.push('That would run off the page — nothing added.'); continue; }
      // never print over existing words (blanks/underscores are fine — writing on a line is the point)
      const clash = page.items.find(it => { const ink = inkRect(it); return !!ink && overlaps(box, ink); });
      if (clash && e.allow_overlap !== true) {
        warnings.push(`Nothing added: the text would print over “${clip(clash.str, 40)}” on page ${n}. Try another placement (below/above/right) or another anchor.`);
        continue;
      }
      lines.forEach((l, k) => pdf.getPage(n - 1).drawText(l, { x, y: y - k * lh, size, font, color: rgb(0, 0, 0) }));
      report.push(`Added “${clip(text, 70)}” on page ${n}${anchor ? ` ${str(e.placement) || 'right'} of “${clip(anchor, 40)}”` : ` at (${Math.round(x)}, ${Math.round(pages[n - 1].height - y)})`}`);
    } else warnings.push(`Unknown edit “${op}” for a PDF (use add_text or remove_text).`);
  }
  if (!report.length) return { bytes: new Uint8Array(0), report, warnings };
  let out: Uint8Array = await pdf.save();
  if (wantPermanent && coveredPages.size) {
    try { out = await flattenPages(out, [...coveredPages].sort((a, b) => a - b)); report.push(`Made the changed page${coveredPages.size === 1 ? '' : 's'} (${[...coveredPages].sort((a, b) => a - b).join(', ')}) permanent: rebuilt as images, so the removed words are gone from the file`); }
    catch (err) { console.warn('[doc-text-edit] flatten failed', err); warnings.push('Could not make the removal permanent (the page renderer is unavailable) — the words are only covered, and could still be selected or copied from the PDF.'); }
  } else if (coveredPages.size) {
    warnings.push('The removed words are covered with a white box but still exist in the PDF’s text layer (they can be selected or copied). For anything confidential, ask for a permanent removal.');
  }
  return { bytes: out, report, warnings };
}
