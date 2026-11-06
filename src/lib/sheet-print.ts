import type * as Y from 'yjs';
import { cellKey, extMap, fmtMap, fontCss, mergeList, tBold, tCols, type CellFmt, type MergeRange, type TabInfo } from '@/lib/drive-sheet';

// Print / "Save as PDF" for a My Drive sheet that LOOKS like the sheet: fills, font + size + colour, bold / italic / underline, alignment
// (horizontal + vertical), wrap, borders, column widths, row heights, merged cells, and the frozen rows repeated at the top of every page.
// Returns a standalone HTML page; the caller opens it in a window and prints (the browser's print dialog has "Save as PDF").

const DEF_W = 120;
const esc = (v: string) => v.replace(/[&<>"]/g, ch => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
const color = (c?: string) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined);
// Cell formats are stored in the shared sheet, so anyone who can edit it (or an uploaded .xlsx) controls these strings.
// They land in a style="" attribute, so only plain font names and a bounded numeric size get through.
const safeFont = (n?: string) => (typeof n === 'string' && /^[A-Za-z0-9 ._-]{1,60}$/.test(n) ? n : undefined);
const safeSize = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.min(200, Math.max(4, v)) : 13; };
// The print page has no scripts of its own; this policy keeps it that way even if markup ever slips through.
export const PRINT_CSP = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'; base-uri \'none\'">';
const numeric = (v: string) => v !== '' && /^-?[\d,.$%]+$/.test(v.trim());

export function sheetPrintHtml(ydoc: Y.Doc, t: TabInfo, grid: string[][], title: string): string {
  const fm = fmtMap(ydoc), ext = extMap(ydoc), bold = tBold(t.map), cols = tCols(t.map);
  const fmtOf = (r: number, c: number): CellFmt => { try { const s = fm.get(`${t.id}|${r}:${c}`); return s ? JSON.parse(s) as CellFmt : {}; } catch { return {}; } };
  let maxR = grid.length, maxC = Math.max(0, ...grid.map(r => r.length));
  const prefix = `${t.id}|`;
  fm.forEach((_v, k) => { if (k.startsWith(prefix)) { const [r, c] = k.slice(prefix.length).split(':').map(Number); if (r + 1 > maxR) maxR = r + 1; if (c + 1 > maxC) maxC = c + 1; } });
  // trailing rows with neither text nor a look are not printed
  const rowUsed = (r: number) => { for (let c = 0; c < maxC; c++) if ((grid[r]?.[c] ?? '') !== '' || Object.keys(fmtOf(r, c)).length) return true; return false; };
  while (maxR > 0 && !rowUsed(maxR - 1)) maxR--;
  maxR = Math.min(maxR, 5000); maxC = Math.min(maxC, 60);
  const merges = mergeList(ydoc).toArray().map(x => { try { return JSON.parse(x) as MergeRange; } catch { return null; } }).filter((x): x is MergeRange => !!x && x.tab === t.id && x.r1 < maxR && x.c1 < maxC);
  const master = new Map<string, MergeRange>(), covered = new Set<string>();
  for (const m of merges) { master.set(`${m.r1}:${m.c1}`, m); for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r}:${c}`); }
  const widths = Array.from({ length: maxC }, (_, c) => { const w = Number(cols.get(String(c))); return w > 0 ? w : DEF_W; });
  const totalW = widths.reduce((a, b) => a + b, 0);
  let page: { orientation?: string } = {};
  try { page = JSON.parse(ext.get(`${t.id}|page`) ?? '{}') ?? {}; } catch { /* default */ }
  const portrait = page.orientation === 'portrait';
  const usable = portrait ? 700 : 960;               // px of printable width on US Letter with 8 mm margins
  const zoom = Math.min(1, usable / totalW);
  const frozen = Math.min(Number(t.map.get('frozen')) || 0, maxR);

  const tdStyle = (r: number, c: number, v: string) => {
    const f = fmtOf(r, c), isB = !!bold.get(cellKey(r, c));
    const css: string[] = [];
    const bg = color(f.bg); if (bg) css.push(`background:${bg}`);
    const fg = color(f.fg); if (fg) css.push(`color:${fg}`);
    if (isB) css.push('font-weight:700');
    if (f.i) css.push('font-style:italic');
    const deco = [f.u ? 'underline' : '', f.s ? 'line-through' : ''].filter(Boolean).join(' '); if (deco) css.push(`text-decoration:${deco}`);
    const fn = safeFont(f.fn); const fam = fn ? `'${fn}', Arial, sans-serif` : fontCss(f.ff); if (fam) css.push(`font-family:${fam}`);
    css.push(`font-size:${safeSize(f.fs ?? 13)}px`);
    css.push(`text-align:${f.al === 'c' ? 'center' : f.al === 'r' || (!f.al && numeric(v)) ? 'right' : 'left'}`);
    css.push(`vertical-align:${f.va === 't' ? 'top' : f.va === 'b' ? 'bottom' : f.wr && !f.va ? 'top' : 'middle'}`);
    css.push(f.wr ? 'white-space:pre-wrap;word-break:break-word' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
    const bd = f.bd ?? '', bc = color(f.bdc) ?? '#9ca3af';
    for (const [k, side] of [['l', 'left'], ['r', 'right'], ['t', 'top'], ['b', 'bottom']] as const) if (bd.includes(k)) css.push(`border-${side}:1px solid ${bc}`);
    return css.join(';');
  };
  const row = (r: number, head: boolean) => {
    const h = Number(ext.get(`${t.id}|rh|${r}`));
    const tds: string[] = [];
    for (let c = 0; c < maxC; c++) {
      const key = `${r}:${c}`;
      if (covered.has(key)) continue;
      const m = master.get(key);
      const v = grid[r]?.[c] ?? '';
      tds.push(`<td${m ? ` colspan="${m.c2 - m.c1 + 1}" rowspan="${m.r2 - m.r1 + 1}"` : ''} style="${esc(tdStyle(r, c, v))}">${esc(v)}</td>`);
    }
    return `<tr${h > 0 ? ` style="height:${h}px"` : ''}>${tds.join('')}</tr>`;
  };
  const head = Array.from({ length: frozen }, (_, r) => row(r, true)).join('');
  const body = Array.from({ length: Math.max(0, maxR - frozen) }, (_, i) => row(frozen + i, false)).join('');
  return `<!doctype html><html><head><meta charset="utf-8">${PRINT_CSP}<title>${esc(title)} — ${esc(t.name)}</title><style>
@page{size:${portrait ? 'portrait' : 'landscape'};margin:8mm}
html,body{margin:0;padding:0;background:#fff}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:Arial,Helvetica,sans-serif;color:#111}
table{border-collapse:collapse;table-layout:fixed;width:${totalW}px;zoom:${zoom}}
td{box-sizing:border-box;padding:2px 6px;border:1px solid #e5e7eb;line-height:1.3}
thead{display:table-header-group}tr{break-inside:avoid}
</style></head><body><table><colgroup>${widths.map(w => `<col style="width:${w}px">`).join('')}</colgroup>${frozen ? `<thead>${head}</thead>` : ''}<tbody>${body}</tbody></table></body></html>`;
}
