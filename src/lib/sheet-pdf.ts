import type * as Y from 'yjs';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { cellKey, extMap, fmtMap, mergeList, tBold, tCols, type CellFmt, type MergeRange, type TabInfo } from '@/lib/drive-sheet';
import { winAnsi } from '@/lib/doc-pdf';

// "Download as PDF" for a My Drive sheet — a real PDF, one click, that looks like the sheet: fills, font / size / colour, bold / italic,
// alignment (horizontal + vertical), wrap, borders, column widths, row heights, merged cells, frozen rows repeated on every page, page numbers.
// Drawn straight with pdf-lib (standard fonts: Arial / Verdana → Helvetica, Georgia / Times → Times, Courier → Courier), so it runs in the browser.

const DEF_W = 120, DEF_FS = 13, DEF_ROW = 22;
const hexRgb = (c?: string) => {
  const m = c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
};
const numeric = (v: string) => v !== '' && /^-?[\d,.$%]+$/.test(v.trim());
type Fam = 'sans' | 'serif' | 'mono';
const famOf = (f: CellFmt): Fam => {
  const n = (f.fn ?? f.ff ?? '').toLowerCase();
  return /georgia|times|serif/.test(n) && !/sans/.test(n) ? 'serif' : /courier|mono/.test(n) ? 'mono' : 'sans';
};

export async function sheetToPdf(ydoc: Y.Doc, t: TabInfo, grid: string[][], title: string): Promise<Uint8Array> {
  const fm = fmtMap(ydoc), ext = extMap(ydoc), bold = tBold(t.map), cols = tCols(t.map);
  const fmtOf = (r: number, c: number): CellFmt => { try { const s = fm.get(`${t.id}|${r}:${c}`); return s ? JSON.parse(s) as CellFmt : {}; } catch { return {}; } };
  let maxR = grid.length, maxC = Math.max(0, ...grid.map(r => r.length));
  const prefix = `${t.id}|`;
  fm.forEach((_v, k) => { if (k.startsWith(prefix)) { const [r, c] = k.slice(prefix.length).split(':').map(Number); if (r + 1 > maxR) maxR = r + 1; if (c + 1 > maxC) maxC = c + 1; } });
  const used = (r: number) => { for (let c = 0; c < maxC; c++) if ((grid[r]?.[c] ?? '') !== '' || Object.keys(fmtOf(r, c)).length) return true; return false; };
  while (maxR > 0 && !used(maxR - 1)) maxR--;
  maxR = Math.min(maxR, 5000); maxC = Math.min(maxC, 60);
  const merges = mergeList(ydoc).toArray().map(x => { try { return JSON.parse(x) as MergeRange; } catch { return null; } }).filter((x): x is MergeRange => !!x && x.tab === t.id && x.r1 < maxR && x.c1 < maxC);
  const master = new Map<string, MergeRange>(), covered = new Set<string>();
  for (const m of merges) { master.set(`${m.r1}:${m.c1}`, m); for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r}:${c}`); }

  let pg: { orientation?: string } = {};
  try { pg = JSON.parse(ext.get(`${t.id}|page`) ?? '{}') ?? {}; } catch { /* default */ }
  const portrait = pg.orientation === 'portrait';
  const M = 24, FOOT = 18;
  const widthsPx = Array.from({ length: maxC }, (_, c) => { const w = Number(cols.get(String(c))); return w > 0 ? w : DEF_W; });
  const totalPx = widthsPx.reduce((a, b) => a + b, 0);
  // US Letter, unless the sheet is so wide the text would be tiny: then Tabloid (11 × 17 in) landscape, which reads at about 60% instead of 40%.
  let PW = portrait ? 612 : 792, PH = portrait ? 792 : 612;
  if (!portrait && (PW - 2 * M) / totalPx < 0.5) { PW = 1224; PH = 792; }
  const f = Math.min(0.75, (PW - 2 * M) / totalPx);                    // px → pt (never bigger than 100% screen size)
  const xs = widthsPx.map(w => w * f).reduce<number[]>((a, w) => (a.push(a[a.length - 1] + w), a), [0]);

  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(title) || 'Spreadsheet'); pdf.setCreator('CRECO CRM');
  const F = {
    sans: { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold), i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique) },
    serif: { r: await pdf.embedFont(StandardFonts.TimesRoman), b: await pdf.embedFont(StandardFonts.TimesRomanBold), i: await pdf.embedFont(StandardFonts.TimesRomanItalic), bi: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic) },
    mono: { r: await pdf.embedFont(StandardFonts.Courier), b: await pdf.embedFont(StandardFonts.CourierBold), i: await pdf.embedFont(StandardFonts.CourierOblique), bi: await pdf.embedFont(StandardFonts.CourierBoldOblique) },
  };
  const fontOf = (fmt: CellFmt, isB: boolean): PDFFont => { const g = F[famOf(fmt)]; return isB && fmt.i ? g.bi : isB ? g.b : fmt.i ? g.i : g.r; };
  const HAIR = rgb(0.9, 0.91, 0.92), PAD = 3;

  type Cell = { r: number; c: number; fmt: CellFmt; text: string; font: PDFFont; size: number; w: number; lines: string[] };
  const lineH = (size: number) => size * 1.25;
  const layout = (r: number): { cells: Cell[]; h: number } => {
    const cells: Cell[] = [];
    const given = Number(ext.get(`${t.id}|rh|${r}`));
    let h = (given > 0 ? given : DEF_ROW) * f;
    for (let c = 0; c < maxC; c++) {
      const key = `${r}:${c}`;
      if (covered.has(key)) continue;
      const m = master.get(key), span = m ? m.c2 - m.c1 + 1 : 1;
      const fmt = fmtOf(r, c), isB = !!bold.get(cellKey(r, c));
      const size = Math.max(4, (fmt.fs ?? DEF_FS) * f);
      const font = fontOf(fmt, isB);
      const w = xs[Math.min(maxC, c + span)] - xs[c];
      const text = winAnsi(grid[r]?.[c] ?? '');
      let lines: string[];
      if (fmt.wr && text) {
        lines = [];
        for (const para of text.split('\n')) {
          let cur = '';
          for (const word of para.split(/\s+/).filter(Boolean)) {
            const tryLine = cur ? `${cur} ${word}` : word;
            if (font.widthOfTextAtSize(tryLine, size) <= w - 2 * PAD || !cur) cur = tryLine; else { lines.push(cur); cur = word; }
          }
          lines.push(cur);
        }
        h = Math.max(h, lines.length * lineH(size) + 2 * PAD);   // a wrapped cell grows its row when the sheet's height is too short
      } else lines = [text.replace(/\s*\n\s*/g, ' ')];
      cells.push({ r, c, fmt, text, font, size, w, lines });
    }
    return { cells, h };
  };

  const head = Math.min(Number(t.map.get('frozen')) || 0, maxR, 12);
  let page!: PDFPage, y = 0;
  const pages: PDFPage[] = [];
  const draw = (rl: { cells: Cell[]; h: number }) => {
    const { cells, h } = rl;
    for (const cell of cells) {
      const x = M + xs[cell.c], { fmt } = cell;
      const bg = hexRgb(fmt.bg);
      if (bg) page.drawRectangle({ x, y: y - h - 0.35, width: cell.w + 0.35, height: h + 0.35, color: bg });   // a hair of overlap: no white seams between filled cells
      if (!bg) {   // the faint grid only on unfilled cells (a pale line across a dark fill shows as a white seam)
        page.drawLine({ start: { x, y: y - h }, end: { x: x + cell.w, y: y - h }, thickness: 0.3, color: HAIR });
        page.drawLine({ start: { x: x + cell.w, y }, end: { x: x + cell.w, y: y - h }, thickness: 0.3, color: HAIR });
      }
      const bd = fmt.bd ?? '', bc = hexRgb(fmt.bdc) ?? rgb(0.61, 0.64, 0.69);
      if (bd.includes('b')) page.drawLine({ start: { x, y: y - h }, end: { x: x + cell.w, y: y - h }, thickness: 0.6, color: bc });
      if (bd.includes('t')) page.drawLine({ start: { x, y }, end: { x: x + cell.w, y }, thickness: 0.6, color: bc });
      if (bd.includes('l')) page.drawLine({ start: { x, y }, end: { x, y: y - h }, thickness: 0.6, color: bc });
      if (bd.includes('r')) page.drawLine({ start: { x: x + cell.w, y }, end: { x: x + cell.w, y: y - h }, thickness: 0.6, color: bc });
      if (!cell.text) continue;
      const col = hexRgb(fmt.fg) ?? rgb(0.1, 0.1, 0.12);
      const lines = cell.lines, blockH = lines.length * lineH(cell.size);
      const va = fmt.va ?? (fmt.wr ? 't' : 'm');
      const top = va === 't' ? y - PAD : va === 'b' ? y - h + PAD + blockH : y - (h - blockH) / 2;
      for (let li = 0; li < lines.length; li++) {
        let s = lines[li];
        const maxW = cell.w - 2 * PAD;
        if (!fmt.wr && cell.font.widthOfTextAtSize(s, cell.size) > maxW) { while (s.length > 1 && cell.font.widthOfTextAtSize(`${s}..`, cell.size) > maxW) s = s.slice(0, -1); s += '..'; }
        const tw = cell.font.widthOfTextAtSize(s, cell.size);
        const al = fmt.al ?? (numeric(cell.text) ? 'r' : 'l');
        const tx = al === 'c' ? x + (cell.w - tw) / 2 : al === 'r' ? x + cell.w - PAD - tw : x + PAD;
        const base = top - lineH(cell.size) * (li + 1) + (lineH(cell.size) - cell.size) / 2 + cell.size * 0.12;
        try { page.drawText(s, { x: tx, y: base, size: cell.size, font: cell.font, color: col }); } catch { /* a glyph the standard font cannot draw */ }
        if (fmt.u) page.drawLine({ start: { x: tx, y: base - 1 }, end: { x: tx + tw, y: base - 1 }, thickness: 0.4, color: col });
        if (fmt.s) page.drawLine({ start: { x: tx, y: base + cell.size * 0.3 }, end: { x: tx + tw, y: base + cell.size * 0.3 }, thickness: 0.4, color: col });
      }
    }
    y -= h;
  };
  const headRows = Array.from({ length: head }, (_, r) => layout(r));
  const newPage = () => { page = pdf.addPage([PW, PH]); pages.push(page); y = PH - M; if (pages.length > 1) for (const hr of headRows) draw(hr); };
  newPage();
  for (let r = 0; r < maxR; r++) {
    const rl = layout(r);
    if (r < head) { if (pages.length === 1) draw(rl); continue; }     // header rows sit on page 1 in place and repeat on later pages
    if (y - rl.h < M + FOOT) newPage();
    draw(rl);
  }
  const fnt = F.sans.r;
  pages.forEach((p, i) => { const s = `${winAnsi(title)} · ${winAnsi(t.name)} · page ${i + 1} of ${pages.length}`; p.drawText(s, { x: (PW - fnt.widthOfTextAtSize(s, 7)) / 2, y: 10, size: 7, font: fnt, color: rgb(0.6, 0.62, 0.66) }); });
  return pdf.save();
}
