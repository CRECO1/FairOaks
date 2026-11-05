import type { CellFmt, ImportTab } from '@/lib/drive-sheet';
import { FONT_FAMILIES, MAX_COLS, MAX_ROWS } from '@/lib/drive-sheet';

// Reads an uploaded .xlsx into My Drive sheet tabs and KEEPS how it looks, so the sheet — and Download as Excel from it — mirror the original:
// fills, font name / size / colour / bold / italic, alignment (horizontal + vertical), wrap, borders (colour too), number formats, column widths,
// row heights (exact), merged ranges, frozen rows and the print setup. Server-only: exceljs.

const SHEETS = 20;
const hex = (argb?: string): string | undefined => {
  if (!argb || argb.length < 6) return undefined;
  const h = argb.slice(-6).toUpperCase();
  return /^[0-9A-F]{6}$/.test(h) ? `#${h}` : undefined;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const px = (pt: number) => r2(pt * 4 / 3);
const pad = (n: number) => String(n).padStart(2, '0');
// A date cell as the sheet shows it, following the cell's own number format.
export const dateText = (d: Date, nf?: string) => {
  const m = d.getUTCMonth() + 1, day = d.getUTCDate(), y = d.getUTCFullYear();
  const f = (nf ?? '').toLowerCase();
  if (/^m\.d\.yy/.test(f)) return `${m}.${day}.${String(y).slice(-2)}`;
  if (/^mm\/dd\/yyyy/.test(f)) return `${pad(m)}/${pad(day)}/${y}`;
  return `${m}/${day}/${y}`;
};

export async function xlsxToTabs(buf: Buffer): Promise<ImportTab[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const tabs: ImportTab[] = [];
  for (const ws of wb.worksheets.slice(0, SHEETS)) {
    const grid: string[][] = [];
    const fmts: Record<string, CellFmt> = {};
    const bold: string[] = [];
    const rowHeights: Record<number, number> = {};
    const maxR = Math.min(ws.rowCount, MAX_ROWS), maxC = Math.min(ws.columnCount, MAX_COLS);
    for (let r = 1; r <= maxR; r++) {
      const row = ws.getRow(r);
      const line: string[] = new Array(maxC).fill('');
      if (row.height && row.height > 0) rowHeights[r - 1] = px(row.height);
      for (let c = 1; c <= maxC; c++) {
        const cell = row.getCell(c);
        const key = `${r - 1}:${c - 1}`;
        // a merged range holds its text in the top-left cell only
        const slave = cell.isMerged && cell.master && cell.master.address !== cell.address;
        if (!slave) { try { line[c - 1] = cell.value instanceof Date ? dateText(cell.value, cell.numFmt) : cell.text ?? ''; } catch { line[c - 1] = ''; } }
        const f: CellFmt = {};
        const fill = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
        if (fill?.type === 'pattern' && fill.pattern === 'solid') { const bg = hex(fill.fgColor?.argb); if (bg && bg !== '#FFFFFF') f.bg = bg; }
        const font = cell.font;
        if (font) {
          const fg = hex(font.color?.argb); if (fg) f.fg = fg;
          if (font.bold) bold.push(key);
          if (font.italic) f.i = 1;
          if (font.underline) f.u = 1;
          if (font.strike) f.s = 1;
          if (font.name) { f.fn = font.name; if (FONT_FAMILIES.some(x => x[0] === font.name)) f.ff = font.name; }
          if (font.size && font.size !== 10) f.fs = px(font.size);   // 10pt is the sheet's default look; anything else is kept exactly
        }
        const al = cell.alignment;
        if (al?.horizontal === 'center' || al?.horizontal === 'centerContinuous') f.al = 'c'; else if (al?.horizontal === 'right') f.al = 'r'; else if (al?.horizontal === 'left') f.al = 'l';
        if (al?.vertical === 'top') f.va = 't'; else if (al?.vertical === 'bottom') f.va = 'b'; else if (al?.vertical === 'middle') f.va = 'm';
        if (al?.wrapText) f.wr = 1;
        const b = cell.border;
        if (b) {
          const bd = (b.left?.style ? 'l' : '') + (b.right?.style ? 'r' : '') + (b.top?.style ? 't' : '') + (b.bottom?.style ? 'b' : '');
          if (bd) { f.bd = bd; const col = hex((b.bottom ?? b.top ?? b.left ?? b.right)?.color?.argb); if (col) f.bdc = col; }
        }
        if (cell.numFmt && cell.numFmt !== 'General') f.xf = cell.numFmt;
        if (Object.keys(f).length) fmts[key] = f;
      }
      grid.push(line);
    }
    const widths: Record<number, number> = {};
    for (let c = 1; c <= maxC; c++) { const w = ws.getColumn(c).width; if (w && w > 0) widths[c - 1] = r2(w * 7 + 5); }
    const merges: Array<[number, number, number, number]> = [];
    const colIdx = (s: string) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    for (const m of ((ws.model as { merges?: string[] }).merges ?? [])) {
      const mm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
      if (mm) { const r1 = +mm[2] - 1, c1 = colIdx(mm[1]), r2_ = +mm[4] - 1, c2 = colIdx(mm[3]); if (r2_ < MAX_ROWS && c2 < MAX_COLS) merges.push([r1, c1, r2_, c2]); }
    }
    const view = ws.views?.[0] as { state?: string; ySplit?: number } | undefined;
    const ps = ws.pageSetup;
    const page = { orientation: ps.orientation, fitToPage: ps.fitToPage, fitToWidth: ps.fitToWidth, fitToHeight: ps.fitToHeight, scale: ps.scale, margins: ps.margins, paperSize: ps.paperSize };
    tabs.push({ name: ws.name, grid, frozen: view?.state === 'frozen' ? Math.min(view.ySplit ?? 0, 10) : 0, widths, bold, fmts, merges, rowHeights, page });
  }
  return tabs;
}
