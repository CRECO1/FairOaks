import type * as Y from 'yjs';
import { cellKey, extMap, fmtMap, mergeList, tBold, tCols, type CellFmt, type MergeRange, type TabInfo } from '@/lib/drive-sheet';

// "Download as Excel" for a My Drive sheet that KEEPS how it looks: fills, font colour / bold / italic / size, alignment, wrap, borders,
// column widths, row heights, merged ranges and frozen rows. The cell text is whatever the sheet shows (formulas already worked out).
// exceljs is loaded on demand, so this works in the browser (unsaved edits included) and in a script.

const DEF_W = 120;
const argb = (c?: string) => {
  if (!c) return undefined;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
  return `FF${h.toUpperCase()}`;
};
const isDateFmt = (nf: string) => !/[#0]/.test(nf.replace(/"[^"]*"/g, '')) && /[ymd]/i.test(nf);
const toDate = (v: string): Date | null => {
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/.exec(v.trim()); if (m) return new Date(Date.UTC(2000 + +m[3], +m[1] - 1, +m[2], 12));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim()); if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], 12));
  return null;
};
const numeric = (v: string) => v !== '' && !Number.isNaN(Number(v.replace(/,/g, ''))) && !/^0\d/.test(v);

export async function sheetToXlsxBuffer(ydoc: Y.Doc, tabs: TabInfo[], gridOf: (t: TabInfo) => string[][]): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const merges = mergeList(ydoc).toArray().map(x => { try { return JSON.parse(x) as MergeRange; } catch { return null; } }).filter((x): x is MergeRange => !!x);
  const ext = extMap(ydoc), fm = fmtMap(ydoc);
  const used = new Set<string>();
  for (const t of tabs) {
    let name = t.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ').trim() || 'Sheet';
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${used.size + 1}`;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name);
    const grid = gridOf(t);
    const bold = tBold(t.map), cols = tCols(t.map);
    const fmtOf = (r: number, c: number): CellFmt => { try { const s = fm.get(`${t.id}|${r}:${c}`); return s ? JSON.parse(s) as CellFmt : {}; } catch { return {}; } };
    // the used area: the text, plus anything that only carries a look (the coloured bands)
    let maxR = grid.length, maxC = Math.max(0, ...grid.map(r => r.length));
    const prefix = `${t.id}|`;
    fm.forEach((_v, k) => { if (k.startsWith(prefix)) { const [r, c] = k.slice(prefix.length).split(':').map(Number); if (r + 1 > maxR) maxR = r + 1; if (c + 1 > maxC) maxC = c + 1; } });
    maxR = Math.min(maxR, 5000); maxC = Math.min(maxC, 60);
    // inside a merged range only the top-left cell carries text and look (like Excel's own files)
    const slave = new Set<string>();
    for (const m of merges) if (m.tab === t.id) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) slave.add(`${r}:${c}`);
    for (let r = 0; r < maxR; r++) {
      const row = ws.getRow(r + 1);
      const h = Number(ext.get(`${t.id}|rh|${r}`));
      if (h > 0) row.height = Math.round(h * 75) / 100;
      for (let c = 0; c < maxC; c++) {
        if (slave.has(`${r}:${c}`)) continue;
        const v = grid[r]?.[c] ?? '';
        const f = fmtOf(r, c);
        const isB = !!bold.get(cellKey(r, c));
        if (v === '' && !Object.keys(f).length && !isB) continue;
        const cell = row.getCell(c + 1);
        if (v !== '') { const dt = f.xf && isDateFmt(f.xf) ? toDate(v) : null; cell.value = dt ?? (numeric(v) ? Number(v.replace(/[$,]/g, '')) : v); }
        if (f.xf) cell.numFmt = f.xf;
        const bg = argb(f.bg), fg = argb(f.fg);
        if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        const fname = f.fn ?? (f.ff && f.ff !== 'Default' ? f.ff : undefined);
        if (isB || f.i || f.u || f.s || fg || f.fs || fname) cell.font = { name: fname, bold: isB || undefined, italic: f.i ? true : undefined, underline: f.u ? true : undefined, strike: f.s ? true : undefined, color: fg ? { argb: fg } : undefined, size: f.fs ? Math.round(f.fs * 75) / 100 : fname ? 10 : undefined };
        if (f.al || f.wr || f.va) cell.alignment = { horizontal: f.al === 'c' ? 'center' : f.al === 'r' ? 'right' : f.al === 'l' ? 'left' : undefined, vertical: f.va === 't' ? 'top' : f.va === 'b' ? 'bottom' : f.va === 'm' ? 'middle' : undefined, wrapText: f.wr ? true : undefined };
        if (f.bd) { const thin = { style: 'thin' as const, color: { argb: argb(f.bdc) ?? 'FF9CA3AF' } }; cell.border = { left: f.bd.includes('l') ? thin : undefined, right: f.bd.includes('r') ? thin : undefined, top: f.bd.includes('t') ? thin : undefined, bottom: f.bd.includes('b') ? thin : undefined }; }
      }
    }
    for (let c = 0; c < maxC; c++) { const w = Number(cols.get(String(c))); ws.getColumn(c + 1).width = Math.max(4, Math.round(((w > 0 ? w : DEF_W) - 5) / 7 * 100) / 100); }
    for (const m of merges) if (m.tab === t.id && m.r2 < maxR && m.c2 < maxC) ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1);
    try { const pg = JSON.parse(ext.get(`${t.id}|page`) ?? 'null'); if (pg) ws.pageSetup = { ...ws.pageSetup, ...Object.fromEntries(Object.entries(pg).filter(([, v]) => v !== undefined && v !== null)) }; } catch { /* default print setup */ }
    const frozen = Number(t.map.get('frozen')) || 0;
    if (frozen > 0) ws.views = [{ state: 'frozen', ySplit: frozen }];
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
