// Shared lightweight rich text for transaction docs. Editable field values are stored
// as plain strings with markdown-style inline markup — **bold**, *italic*, ***both*** —
// and a literal * or \ is escaped as \* / \\. Text colour is {c:#rrggbb}…{/c} (a run with no
// colour prints in the document's normal ink). Both PDF generators (the LOI builder and
// the TransactionDocEditor overlay) render the same markup via drawRichText; the editor
// control (RichText.tsx) produces and consumes it. Keep this file DOM-free so it is safe
// to import anywhere; DOM serialization lives in RichText.tsx.
import { pushGraphicsState, popGraphicsState, setTextRenderingMode, setLineWidth, setStrokingColor, TextRenderingMode } from 'pdf-lib';
import type { PDFPage, PDFFont, Color } from 'pdf-lib';

// Every form field is filled in at ONE look — size, ink colour and weight — in the editor, the saved PDF and the server stamper, so a form always reads the same.
// Size is in points before the 0.85 scale the editor has always applied (12.5 → 10.6pt on the page; it was 11 → 9.35pt).
export const FORM_FONT_SIZE = 12.5;
// Ink for everything filled into a form: the dark blue the zipForms exports use, so answers stand out from the printed form.
export const FORM_INK_HEX = '#0d1a8c';
export const FORM_INK_RGB: [number, number, number] = [0.05, 0.1, 0.55];
// A medium weight, between Helvetica regular and bold (the standard PDF fonts have no in-between): the glyphs get a hairline outline in the same ink,
// this fraction of the font size wide. The editor draws the same thing with -webkit-text-stroke so screen and PDF match. Real **bold** still reads as bold.
export const FORM_INK_WEIGHT = 0.012;

/** Draw one run of text; with `weight` it is outlined in its own colour for the medium weight above. */
export function drawInkText(page: PDFPage, text: string, o: { x: number; y: number; size: number; font: PDFFont; color: Color; weight?: number }) {
  if (!o.weight) { page.drawText(text, { x: o.x, y: o.y, size: o.size, font: o.font, color: o.color }); return; }
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(o.size * o.weight), setStrokingColor(o.color));
  page.drawText(text, { x: o.x, y: o.y, size: o.size, font: o.font, color: o.color });
  page.pushOperators(popGraphicsState());
}

export interface Run { text: string; b: boolean; i: boolean; c?: string }   // c = '#rrggbb' when coloured

export interface RichFonts { reg: PDFFont; bold: PDFFont; ital: PDFFont; boldItal: PDFFont }

/** Parse markup into styled runs. Unmatched toggles just carry to the end (harmless);
 *  `\*` and `\\` are literal. */
const COLOR_OPEN = /^\{c:(#[0-9a-fA-F]{6})\}/;   // '{c:#rrggbb}' is 11 characters
export function parseRich(s: string): Run[] {
  const runs: Run[] = [];
  let b = false, it = false, col: string | undefined, buf = '';
  const flush = () => { if (buf) { runs.push({ text: buf, b, i: it, ...(col ? { c: col } : {}) }); buf = ''; } };
  let i = 0;
  const str = s ?? '';
  while (i < str.length) {
    if (str[i] === '\\' && (str[i + 1] === '*' || str[i + 1] === '\\')) { buf += str[i + 1]; i += 2; }   // only \* and \\ are escapes; any other backslash is just a backslash
    else if (str.startsWith('***', i)) { flush(); b = !b; it = !it; i += 3; }
    else if (str.startsWith('**', i)) { flush(); b = !b; i += 2; }
    else if (str[i] === '*') { flush(); it = !it; i += 1; }
    else if (str[i] === '{' && COLOR_OPEN.test(str.slice(i, i + 11))) { flush(); col = COLOR_OPEN.exec(str.slice(i, i + 11))![1].toLowerCase(); i += 11; }
    else if (str.startsWith('{/c}', i)) { flush(); col = undefined; i += 4; }
    else { buf += str[i]; i += 1; }
  }
  flush();
  return runs.length ? runs : [{ text: '', b: false, i: false }];
}

/** True when the string carries any (unescaped) markup — lets callers keep the plain
 *  fast path for the overwhelmingly common unformatted value. */
export function hasMarkup(s: string): boolean {
  // An escape sequence (\* or \\) counts too: a value like "5\*3" is still markup that must be unescaped before it is drawn, or the backslash prints.
  return /(^|[^\\])\*/.test(s ?? '') || /(^|[^\\])\{c:#[0-9a-fA-F]{6}\}/.test(s ?? '') || /\\[*\\]/.test(s ?? '');
}

/** Width a string actually occupies when drawn. pdf-lib's widthOfTextAtSize subtracts
 *  kerning pairs (Times "VA" is -135/1000), but drawText emits no kerning — so a word
 *  placed by that measure overruns into the following space ("HVACin"). Summing glyphs
 *  one at a time measures what is really painted. */
export function drawnWidth(font: PDFFont, text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += font.widthOfTextAtSize(ch, size);
  return w;
}

// Forms use ONE ink colour. A stored {c:#…} marker (from the brief colour-picker build) is still read so it never prints as stray text, but it is not drawn.
const runColor = (_r: Run, dflt: Color): Color => dflt;
const fontFor = (r: Run, f: RichFonts): PDFFont => (r.b && r.i) ? f.boldItal : r.b ? f.bold : r.i ? f.ital : f.reg;

/** Split runs into words (whitespace-separated), each word an array of same-style pieces. */
function toWords(runs: Run[]): Run[][] {
  const words: Run[][] = [];
  let cur: Run[] = [];
  const add = (ch: string, r: Run) => {
    const last = cur[cur.length - 1];
    if (last && last.b === r.b && last.i === r.i && last.c === r.c) last.text += ch;
    else cur.push({ text: ch, b: r.b, i: r.i, c: r.c });
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
  /** Medium-weight outline as a fraction of the font size (see FORM_INK_WEIGHT); omit for plain text. */
  weight?: number;
}

/** Draw wrapped rich text; returns the number of lines drawn. */
export function drawRichText(o: RichDrawOpts): number {
  const words = toWords(o.runs);
  const wordW = (w: Run[]) => w.reduce((a, s) => a + drawnWidth(fontFor(s, o.fonts), s.text, o.size), 0);
  const spaceW = o.fonts.reg.widthOfTextAtSize(' ', o.size);
  let line: Run[][] = [], lineW = 0, lines = 0;
  const flush = () => {
    let cx = o.x;
    line.forEach((w, wi) => {
      if (wi > 0) cx += spaceW;
      for (const s of w) {
        drawInkText(o.page, s.text, { x: cx, y: o.y - lines * o.lineHeight, size: o.size, font: fontFor(s, o.fonts), color: runColor(s, o.color), weight: o.weight });
        cx += drawnWidth(fontFor(s, o.fonts), s.text, o.size);
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
  const wordW = (w: Run[]) => w.reduce((a, s) => a + drawnWidth(fontFor(s, fonts), s.text, size), 0);
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
