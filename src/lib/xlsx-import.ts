import type { CellFmt, ImportTab } from '@/lib/drive-sheet';
import { MAX_COLS, MAX_ROWS } from '@/lib/drive-sheet';

// Reads an uploaded .xlsx into My Drive sheet tabs and KEEPS how it looks: fills, font colour / bold / italic / size,
// alignment, wrap, borders, column widths, row heights, merged ranges and frozen rows. (The old importer read values only,
// so a styled sheet such as the Leasing Activity report arrived as a plain grid.) Server-only: exceljs.

const SHEETS = 20;
const DEF_W = 120;                  // the editor's default column width, px
const hex = (argb?: string): string | undefined => {
  if (!argb || argb.length < 6) return undefined;
  const h = argb.slice(-6).toUpperCase();
  return /^[0-9A-F]{6}$/.test(h) ? `#${h}` : undefined;
};
const px = (pt: number) => Math.round(pt * 4 / 3);
const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36];

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
        if (!slave) { try { line[c - 1] = cell.text ?? ''; } catch { line[c - 1] = ''; } }
        const f: CellFmt = {};
        const fill = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
        if (fill?.type === 'pattern' && fill.pattern === 'solid') { const bg = hex(fill.fgColor?.argb); if (bg && bg !== '#FFFFFF') f.bg = bg; }
        const font = cell.font;
        if (font) {
          const fg = hex(font.color?.argb); if (fg && fg !== '#000000') f.fg = fg;
          if (font.bold) bold.push(key);
          if (font.italic) f.i = 1;
          if (font.underline) f.u = 1;
          if (font.strike) f.s = 1;
          if (font.size) { const want = px(font.size); const near = FONT_SIZES.reduce((a, b) => Math.abs(b - want) < Math.abs(a - want) ? b : a); if (near !== 13) f.fs = near; }
        }
        const al = cell.alignment;
        if (al?.horizontal === 'center' || al?.horizontal === 'centerContinuous') f.al = 'c'; else if (al?.horizontal === 'right') f.al = 'r'; else if (al?.horizontal === 'left') f.al = 'l';
        if (al?.wrapText) f.wr = 1;
        const b = cell.border;
        if (b) { const bd = (b.left?.style ? 'l' : '') + (b.right?.style ? 'r' : '') + (b.top?.style ? 't' : '') + (b.bottom?.style ? 'b' : ''); if (bd) f.bd = bd; }
        if (Object.keys(f).length) fmts[key] = f;
      }
      grid.push(line);
    }
    const widths: Record<number, number> = {};
    for (let c = 1; c <= maxC; c++) { const w = ws.getColumn(c).width; if (w && w > 0) { const p = Math.round(w * 7 + 5); if (Math.abs(p - DEF_W) > 2) widths[c - 1] = p; } }
    const merges: Array<[number, number, number, number]> = [];
    const colIdx = (s: string) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    for (const m of ((ws.model as { merges?: string[] }).merges ?? [])) {
      const mm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
      if (mm) { const r1 = +mm[2] - 1, c1 = colIdx(mm[1]), r2 = +mm[4] - 1, c2 = colIdx(mm[3]); if (r2 < MAX_ROWS && c2 < MAX_COLS) merges.push([r1, c1, r2, c2]); }
    }
    const view = ws.views?.[0] as { state?: string; ySplit?: number } | undefined;
    tabs.push({ name: ws.name, grid, frozen: view?.state === 'frozen' ? Math.min(view.ySplit ?? 0, 10) : 0, widths, bold, fmts, merges, rowHeights });
  }
  return tabs;
}
