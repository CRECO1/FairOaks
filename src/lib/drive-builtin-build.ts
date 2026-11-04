// Server side: turns a built-in template (drive-builtin-templates.ts) into the starting state of a live sheet or document.

import * as Y from 'yjs';
import { cellKey, fmtMap, mkey, newTabMap, sheetText, tBold, tCells, tCols, tabsMap, validMap, type CellFmt } from '@/lib/drive-sheet';
import { markdownToDriveState } from '@/lib/drive-markdown';
import type { BuiltinTemplate } from '@/lib/drive-builtin-templates';

export function buildBuiltin(t: BuiltinTemplate): { ystate: string; text: string } {
  if (t.kind === 'doc') return markdownToDriveState(t.markdown ?? '');
  const doc = new Y.Doc();
  try {
    doc.transact(() => {
      (t.tabs ?? []).forEach((tab, i) => {
        const id = i === 0 ? 'tab1' : `tab${i + 1}`;
        const blank = tab.blankRows ?? 0, nRows = 1 + (tab.rows?.length ?? 0) + blank;
        const total = tab.totals ? 1 : 0;
        const m = newTabMap(tab.name, i, Math.max(100, nRows + total + 20), Math.max(12, tab.header.length + 2), 1);
        tabsMap(doc).set(id, m);
        const cells = tCells(m), bold = tBold(m), cols = tCols(m);
        const fmt = (r: number, c: number, f: CellFmt) => fmtMap(doc).set(mkey(id, r, c), JSON.stringify(f));
        tab.header.forEach((h, c) => { if (h) cells.set(cellKey(0, c), h); bold.set(cellKey(0, c), true); fmt(0, c, { bg: '#c9922c1f' }); });
        (tab.widths ?? []).forEach((w, c) => cols.set(String(c), w));
        const body = [...(tab.rows ?? [])];
        for (let k = 0; k < blank; k++) body.push([]);
        body.forEach((row, k) => {
          const r = k + 1;
          tab.header.forEach((_h, c) => {
            const v = row[c] ?? (tab.formulaCols?.[c] ? tab.formulaCols[c](r + 1) : '');
            // keep the example row's own formula column live too
            const val = tab.formulaCols?.[c] && (row[c] === '' || row[c] === undefined) ? tab.formulaCols[c](r + 1) : v;
            if (val) cells.set(cellKey(r, c), val);
          });
        });
        for (const [c, f] of Object.entries(tab.formats ?? {})) for (let r = 1; r < nRows; r++) { const ci = Number(c); const cur: CellFmt = { nf: f.nf, ...(f.dp !== undefined ? { dp: f.dp } : {}) }; fmt(r, ci, cur); }
        for (const [c, opts] of Object.entries(tab.lists ?? {})) for (let r = 1; r < nRows; r++) validMap(doc).set(mkey(id, r, Number(c)), JSON.stringify({ t: 'list', o: opts }));
        if (tab.totals) {
          const r = nRows;
          for (const [c, v] of Object.entries(tab.totals)) { cells.set(cellKey(r, Number(c)), v); bold.set(cellKey(r, Number(c)), true); const f = tab.formats?.[Number(c)]; fmt(r, Number(c), { bg: '#c9922c1f', ...(f ? { nf: f.nf, ...(f.dp !== undefined ? { dp: f.dp } : {}) } : {}) }); }
        }
      });
    });
    return { ystate: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), text: sheetText(doc) };
  } finally { doc.destroy(); }
}
