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
    for (let r = 0; r < maxR; r++) {
      const row = ws.getRow(r + 1);
      const h = Number(ext.get(`${t.id}|rh|${r}`));
      if (h > 0) row.height = Math.round(h * 0.75);
      for (let c = 0; c < maxC; c++) {
        const v = grid[r]?.[c] ?? '';
        const f = fmtOf(r, c);
        const isB = !!bold.get(cellKey(r, c));
        if (v === '' && !Object.keys(f).length && !isB) continue;
        const cell = row.getCell(c + 1);
        if (v !== '') cell.value = numeric(v) ? Number(v.replace(/,/g, '')) : v;
        const bg = argb(f.bg), fg = argb(f.fg);
        if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        if (isB || f.i || f.u || f.s || fg || f.fs) cell.font = { bold: isB || undefined, italic: f.i ? true : undefined, underline: f.u ? true : undefined, strike: f.s ? true : undefined, color: fg ? { argb: fg } : undefined, size: f.fs ? Math.round(f.fs * 0.75) : undefined };
        if (f.al || f.wr) cell.alignment = { horizontal: f.al === 'c' ? 'center' : f.al === 'r' ? 'right' : f.al === 'l' ? 'left' : undefined, vertical: 'middle', wrapText: f.wr ? true : undefined };
        if (f.bd) { const thin = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } }; cell.border = { left: f.bd.includes('l') ? thin : undefined, right: f.bd.includes('r') ? thin : undefined, top: f.bd.includes('t') ? thin : undefined, bottom: f.bd.includes('b') ? thin : undefined }; }
      }
    }
    for (let c = 0; c < maxC; c++) { const w = Number(cols.get(String(c))); ws.getColumn(c + 1).width = Math.max(4, ((w > 0 ? w : DEF_W) - 5) / 7); }
    for (const m of merges) if (m.tab === t.id && m.r2 < maxR && m.c2 < maxC) ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1);
    const frozen = Number(t.map.get('frozen')) || 0;
    if (frozen > 0) ws.views = [{ state: 'frozen', ySplit: frozen }];
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
