// Shared lightweight rich text for transaction docs. Editable field values are stored
// as plain strings with markdown-style inline markup — **bold**, *italic*, ***both*** —
// and a literal * or \ is escaped as \* / \\. Both PDF generators (the LOI builder and
// the TransactionDocEditor overlay) render the same markup via drawRichText; the editor
// control (RichText.tsx) produces and consumes it. Keep this file DOM-free so it is safe
// to import anywhere; DOM serialization lives in RichText.tsx.
import type { PDFPage, PDFFont, Color } from 'pdf-lib';

export interface Run { text: string; b: boolean; i: boolean }

export interface RichFonts { reg: PDFFont; bold: PDFFont; ital: PDFFont; boldItal: PDFFont }

/** Parse markup into styled runs. Unmatched toggles just carry to the end (harmless);
 *  `\*` and `\\` are literal. */
export function parseRich(s: string): Run[] {
  const runs: Run[] = [];
  let b = false, it = false, buf = '';
  const flush = () => { if (buf) { runs.push({ text: buf, b, i: it }); buf = ''; } };
  let i = 0;
  const str = s ?? '';
  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) { buf += str[i + 1]; i += 2; }
    else if (str.startsWith('***', i)) { flush(); b = !b; it = !it; i += 3; }
    else if (str.startsWith('**', i)) { flush(); b = !b; i += 2; }
    else if (str[i] === '*') { flush(); it = !it; i += 1; }
    else { buf += str[i]; i += 1; }
  }
  flush();
  return runs.length ? runs : [{ text: '', b: false, i: false }];
}

/** True when the string carries any (unescaped) markup — lets callers keep the plain
 *  fast path for the overwhelmingly common unformatted value. */
export function hasMarkup(s: string): boolean {
  return /(^|[^\\])\*/.test(s ?? '');
}

const fontFor = (r: Run, f: RichFonts): PDFFont => (r.b && r.i) ? f.boldItal : r.b ? f.bold : r.i ? f.ital : f.reg;

/** Split runs into words (whitespace-separated), each word an array of same-style pieces. */
function toWords(runs: Run[]): Run[][] {
  const words: Run[][] = [];
  let cur: Run[] = [];
  const add = (ch: string, r: Run) => {
    const last = cur[cur.length - 1];
    if (last && last.b === r.b && last.i === r.i) last.text += ch;
    else cur.push({ text: ch, b: r.b, i: r.i });
  };
  for (const r of runs) for (const ch of r.text) {
    if (/\s/.test(ch)) { if (cur.length) { words.push(cur); cur = []; } }
    else add(ch, r);
  }
  if (cur.length) words.push(cur);
  return words;
}

export interface RichDrawOpts {
  page: PDFPage;
  runs: Run[];
  x: number;
  y: number;              // baseline of the first line
  size: number;
  lineHeight: number;
  maxW: number;           // Infinity for single-line (no wrap)
  fonts: RichFonts;
  color: Color;
}

/** Draw wrapped rich text; returns the number of lines drawn. */
export function drawRichText(o: RichDrawOpts): number {
  const words = toWords(o.runs);
  const wordW = (w: Run[]) => w.reduce((a, s) => a + fontFor(s, o.fonts).widthOfTextAtSize(s.text, o.size), 0);
  const spaceW = o.fonts.reg.widthOfTextAtSize(' ', o.size);
  let line: Run[][] = [], lineW = 0, lines = 0;
  const flush = () => {
    let cx = o.x;
    line.forEach((w, wi) => {
      if (wi > 0) cx += spaceW;
      for (const s of w) {
        o.page.drawText(s.text, { x: cx, y: o.y - lines * o.lineHeight, size: o.size, font: fontFor(s, o.fonts), color: o.color });
        cx += fontFor(s, o.fonts).widthOfTextAtSize(s.text, o.size);
      }
    });
    lines++; line = []; lineW = 0;
  };
  for (const w of words) {
    const ww = wordW(w);
    if (line.length && lineW + spaceW + ww > o.maxW) flush();
    lineW += (line.length ? spaceW : 0) + ww;
    line.push(w);
  }
  if (line.length) flush();
  return Math.max(1, lines);
}

/** Line count a rich value will occupy at a given width (for layout that must reserve height). */
export function countRichLines(runs: Run[], fonts: RichFonts, size: number, maxW: number): number {
  const words = toWords(runs);
  const wordW = (w: Run[]) => w.reduce((a, s) => a + fontFor(s, fonts).widthOfTextAtSize(s.text, size), 0);
  const spaceW = fonts.reg.widthOfTextAtSize(' ', size);
  let lineW = 0, lines = 0, started = false;
  for (const w of words) {
    const ww = wordW(w);
    if (started && lineW + spaceW + ww > maxW) { lines++; lineW = 0; started = false; }
    lineW += (started ? spaceW : 0) + ww; started = true;
  }
  if (started) lines++;
  return Math.max(1, lines);
}
