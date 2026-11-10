// Faithful spreadsheet rendering: draws an .xlsx the way Excel shows it — fills, fonts, borders, column widths, row heights,
// merged cells, alignment, number formats, hidden rows/columns — as an HTML table. (SheetJS' own sheet_to_html drops ALL
// formatting, which made previews look nothing like the file.) Parsed in the browser; nothing leaves the page.
// SAFETY: every piece of text is escaped here and every style value is validated/whitelisted, so the result can be dropped
// straight into the page. Hyperlinks are shown as plain text on purpose; formulas never run.

export interface RenderedSheet { name: string; html: string; width: number; truncated: boolean }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Office default theme (the file's own theme only matters for theme-coloured cells; this matches ~all workbooks).
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
const INDEXED: Record<number, string> = { 0: '000000', 1: 'FFFFFF', 2: 'FF0000', 3: '00FF00', 4: '0000FF', 5: 'FFFF00', 6: 'FF00FF', 7: '00FFFF', 8: '000000', 9: 'FFFFFF', 10: 'FF0000', 11: '00FF00', 12: '0000FF', 13: 'FFFF00', 14: 'FF00FF', 15: '00FFFF', 16: '800000', 17: '008000', 18: '000080', 19: '808000', 20: '800080', 21: '008080', 22: 'C0C0C0', 23: '808080', 64: '000000' };

function tint(hex: string, t: number): string {
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const out = c.map(v => Math.round(t < 0 ? v * (1 + t) : v * (1 - t) + 255 * t));
  return out.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

type XColor = { argb?: string; theme?: number; tint?: number; indexed?: number } | undefined;
function css(c: XColor): string | null {
  if (!c) return null;
  let hex: string | null = null;
  if (c.argb && /^[0-9a-f]{8}$/i.test(c.argb)) hex = c.argb.slice(2);
  else if (c.argb && /^[0-9a-f]{6}$/i.test(c.argb)) hex = c.argb;
  else if (typeof c.theme === 'number' && THEME[c.theme]) hex = THEME[c.theme];
  else if (typeof c.indexed === 'number' && INDEXED[c.indexed]) hex = INDEXED[c.indexed];
  if (!hex) return null;
  if (c.tint) hex = tint(hex, c.tint);
  return '#' + hex.toLowerCase();
}

const BORDER_W: Record<string, string> = { thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed', dashDotDot: '1px dashed', slantDashDot: '1px dashed', mediumDashed: '2px dashed', mediumDashDot: '2px dashed', mediumDashDotDot: '2px dashed', medium: '2px solid', thick: '3px solid', double: '3px double' };

export const colPx = (w?: number | null) => Math.round((w && w > 0 ? w : 8.43) * 7 + 5);
export const isXlsxName = (n: string) => /\.(xlsx|xlsm)$/i.test(n);

/** Render every visible sheet. `maxRows` trims very long sheets (the viewer says so); `maxCols` guards pathological ranges. */
export async function renderWorkbook(bytes: ArrayBuffer, opts: { maxRows?: number; maxCols?: number; onlyFirst?: boolean } = {}): Promise<RenderedSheet[]> {
  const maxRows = opts.maxRows ?? 1500, maxCols = opts.maxCols ?? 60;
  const mod = await import('exceljs');
  const ExcelJS = (mod as { default?: typeof import('exceljs') }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const out: RenderedSheet[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== 'visible') continue;
    out.push(renderSheet(ws, maxRows, maxCols));
    if (opts.onlyFirst) break;
  }
  return out;
}

function renderSheet(ws: import('exceljs').Worksheet, maxRows: number, maxCols: number): RenderedSheet {
  const totalRows = ws.actualRowCount ? ws.rowCount : 0;
  const rowsN = Math.min(totalRows, maxRows);
  const colsN = Math.min(Math.max(ws.columnCount, 1), maxCols);
  const grid = ws.views?.[0] && (ws.views[0] as { showGridLines?: boolean }).showGridLines === false ? false : true;

  // Merges: master cell gets colspan/rowspan, covered cells are skipped.
  const master = new Map<string, { rs: number; cs: number }>();
  const covered = new Set<string>();
  const merges = ((ws.model as unknown as { merges?: string[] }).merges) ?? [];
  for (const m of merges) {
    const mt = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m); if (!mt) continue;
    const c1 = colNum(mt[1]), r1 = +mt[2], c2 = colNum(mt[3]), r2 = +mt[4];
    master.set(`${r1},${c1}`, { rs: r2 - r1 + 1, cs: c2 - c1 + 1 });
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r},${c}`);
  }

  const hiddenCol = (c: number) => !!ws.getColumn(c).hidden;
  const widths: number[] = [];
  for (let c = 1; c <= colsN; c++) widths.push(hiddenCol(c) ? 0 : colPx(ws.getColumn(c).width));
  const width = widths.reduce((a, b) => a + b, 0);
  const defH = ws.properties?.defaultRowHeight ? Math.round((ws.properties.defaultRowHeight as number) * 4 / 3) : 20;

  let html = `<table class="xr" style="border-collapse:collapse;table-layout:fixed;width:${width}px;border-spacing:0"><colgroup>${widths.map(w => `<col style="width:${w}px">`).join('')}</colgroup><tbody>`;
  for (let r = 1; r <= rowsN; r++) {
    const row = ws.getRow(r);
    if (row.hidden) continue;
    const h = row.height ? Math.round(row.height * 4 / 3) : defH;
    html += `<tr style="height:${h}px">`;
    for (let c = 1; c <= colsN; c++) {
      if (hiddenCol(c) || covered.has(`${r},${c}`)) continue;
      const cell = row.getCell(c);
      const mg = master.get(`${r},${c}`);
      const st: string[] = [];
      const f = cell.font;
      if (f) {
        if (f.name && /^[\w .\-]{1,40}$/.test(f.name)) st.push(`font-family:'${f.name}',Arial,sans-serif`);
        if (f.size) st.push(`font-size:${Math.round(f.size * 4 / 3 * 10) / 10}px`);
        if (f.bold) st.push('font-weight:700');
        if (f.italic) st.push('font-style:italic');
        const deco = [f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' ');
        if (deco) st.push(`text-decoration:${deco}`);
        const fc = css(f.color as XColor); if (fc) st.push(`color:${fc}`);
      }
      const fill = cell.fill as { type?: string; pattern?: string; fgColor?: XColor; bgColor?: XColor } | undefined;
      if (fill?.type === 'pattern' && fill.pattern && fill.pattern !== 'none') {
        const bg = css(fill.pattern === 'solid' ? fill.fgColor : (fill.fgColor ?? fill.bgColor)); if (bg) st.push(`background:${bg}`);
      }
      const b = cell.border;
      const edge = (name: string, e?: { style?: string; color?: XColor }) => {
        if (e?.style && BORDER_W[e.style]) st.push(`border-${name}:${BORDER_W[e.style]} ${css(e.color) ?? '#000'}`);
        else if (grid) st.push(`border-${name}:1px solid #e1e1e1`);
      };
      edge('top', b?.top); edge('right', b?.right); edge('bottom', b?.bottom); edge('left', b?.left);
      const al = cell.alignment;
      const isNum = typeof cell.value === 'number' || (cell.value instanceof Date);
      const ha = al?.horizontal === 'center' || al?.horizontal === 'centerContinuous' ? 'center' : al?.horizontal === 'right' ? 'right' : al?.horizontal === 'justify' ? 'justify' : al?.horizontal === 'left' ? 'left' : isNum ? 'right' : 'left';
      st.push(`text-align:${ha}`);
      st.push(`vertical-align:${al?.vertical === 'top' ? 'top' : al?.vertical === 'middle' ? 'middle' : 'bottom'}`);
      st.push(al?.wrapText ? 'white-space:pre-wrap;word-break:break-word' : 'white-space:nowrap');
      if (al?.indent) st.push(`padding-left:${3 + al.indent * 9}px`);
      let text = '';
      try { text = cell.text ?? ''; } catch { text = ''; }
      html += `<td${mg && mg.rs > 1 ? ` rowspan="${mg.rs}"` : ''}${mg && mg.cs > 1 ? ` colspan="${mg.cs}"` : ''} style="${st.join(';')}"><div style="overflow:hidden;text-overflow:clip">${esc(String(text)) || '&nbsp;'}</div></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return { name: ws.name, html, width, truncated: totalRows > rowsN };
}

function colNum(s: string): number { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

/** Shared CSS for the rendered table (cells keep their own formatting; this only sets the base). */
export const XR_CSS = `.xr td{padding:1px 3px;font-family:Calibri,Arial,sans-serif;font-size:14.6px;color:#000;overflow:hidden}.xr{background:#fff}`;
