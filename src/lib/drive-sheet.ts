// My Drive spreadsheets ("Sheets"): the shared model used by the editor (browser) and the server (create, search text, import, live feeds).
//
// A sheet is a Yjs document, like the live docs, so teammates edit together and saves merge the same way:
//   Y.Map 'tabs'  tabId -> Y.Map {
//     name: string, order: number,
//     cells: Y.Map<"r:c" -> raw text>        (raw text is what the person typed: "42", "Hello", "=SUM(A1:A5)")
//     bold:  Y.Map<"r:c" -> true>
//     cols:  Y.Map<"c" -> width px>
//     frozen: number                        (rows kept visible at the top; 1 = header row)
//     rows / ncols: number                  (grid size)
//     feed?: string                         (a live CRM feed that fills this tab; see drive-sheet-feeds.ts)
//     feedKeys?: Y.Map<rowKey -> row index> (which row holds which CRM record, so the team's own notes stay attached on refresh)
//   }
// Rows and columns are 0-based inside; "A1" style is only for display and formulas.

import * as Y from 'yjs';

export const DEFAULT_ROWS = 100;
export const DEFAULT_COLS = 12;
export const MAX_ROWS = 5000;
export const MAX_COLS = 60;

export const colName = (c: number): string => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export const colIndex = (s: string): number => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
export const addr = (r: number, c: number) => `${colName(c)}${r + 1}`;
export const cellKey = (r: number, c: number) => `${r}:${c}`;
export const parseKey = (k: string): [number, number] => { const [r, c] = k.split(':'); return [Number(r), Number(c)]; };

export interface TabInfo { id: string; name: string; order: number; map: Y.Map<unknown> }

export function tabsMap(doc: Y.Doc) { return doc.getMap<Y.Map<unknown>>('tabs'); }
export function listTabs(doc: Y.Doc): TabInfo[] {
  const out: TabInfo[] = [];
  tabsMap(doc).forEach((m, id) => out.push({ id, name: String(m.get('name') ?? 'Sheet'), order: Number(m.get('order') ?? 0), map: m }));
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export const tCells = (t: Y.Map<unknown>) => t.get('cells') as Y.Map<string>;
export const tBold = (t: Y.Map<unknown>) => t.get('bold') as Y.Map<boolean>;
export const tCols = (t: Y.Map<unknown>) => t.get('cols') as Y.Map<number>;

export function newTabMap(name: string, order: number, rows = DEFAULT_ROWS, ncols = DEFAULT_COLS, frozen = 0): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('name', name); m.set('order', order); m.set('rows', rows); m.set('ncols', ncols); m.set('frozen', frozen);
  m.set('cells', new Y.Map<string>()); m.set('bold', new Y.Map<boolean>()); m.set('cols', new Y.Map<number>());
  return m;
}
export const newId = () => 't' + Math.random().toString(36).slice(2, 8);

/** A fresh spreadsheet: one empty tab. Built on the server when the sheet is created so two people opening it can't each add one. */
export function blankSheetState(): { ystate: string; text: string } {
  const doc = new Y.Doc();
  try {
    doc.transact(() => { tabsMap(doc).set('tab1', newTabMap('Sheet1', 0)); });
    return { ystate: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), text: '' };
  } finally { doc.destroy(); }
}

/** Searchable plain text of a sheet (tab names + cell text), for the My Drive search box. */
export function sheetText(doc: Y.Doc): string {
  const out: string[] = [];
  for (const t of listTabs(doc)) {
    out.push(t.name);
    const rows = new Map<number, Array<[number, string]>>();
    tCells(t.map)?.forEach((v, k) => { const [r, c] = parseKey(k); if (v) rows.set(r, [...(rows.get(r) ?? []), [c, v]]); });
    for (const r of [...rows.keys()].sort((a, b) => a - b)) out.push(rows.get(r)!.sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' '));
  }
  return out.join('\n').slice(0, 200_000);
}

// ── Formulas ─────────────────────────────────────────────────────────────────────────────

export type Val = number | string | boolean | null | SheetError;
export class SheetError { constructor(public code: string) {} toString() { return this.code; } }
const ERR = (c: string) => new SheetError(c);

/** Reads a cell's raw text; the evaluator calls this, so it works on a Y.Map or a plain object. */
export type RawGetter = (tabName: string | null, r: number, c: number) => string;

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'lp' | 'rp' | 'comma' | 'colon' | 'end'; v: string };
function lex(src: string): Tok[] {
  const toks: Tok[] = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; toks.push({ t: 'num', v: src.slice(i, j) }); i = j; continue; }
    if (ch === '"') { let j = i + 1, s = ''; while (j < src.length && src[j] !== '"') s += src[j++]; toks.push({ t: 'str', v: s }); i = j + 1; continue; }
    if (ch === "'") { let j = i + 1, s = ''; while (j < src.length && src[j] !== "'") s += src[j++]; toks.push({ t: 'id', v: s }); i = j + 1; continue; }
    if (/[A-Za-z_$]/.test(ch)) { let j = i; while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j])) j++; toks.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
    if (ch === '(') { toks.push({ t: 'lp', v: ch }); i++; continue; }
    if (ch === ')') { toks.push({ t: 'rp', v: ch }); i++; continue; }
    if (ch === ',' || ch === ';') { toks.push({ t: 'comma', v: ',' }); i++; continue; }
    if (ch === ':') { toks.push({ t: 'colon', v: ch }); i++; continue; }
    if (ch === '!') { toks.push({ t: 'op', v: '!' }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>%'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue; }
    throw ERR('#ERROR!');
  }
  toks.push({ t: 'end', v: '' });
  return toks;
}

const REF = /^\$?([A-Za-z]{1,3})\$?(\d{1,5})$/;
export function toNum(v: Val): number | SheetError {
  if (v instanceof SheetError) return v;
  if (v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(String(v).replace(/[$,%\s]/g, '') === '' ? NaN : String(v).replace(/[$,\s]/g, '').replace(/%$/, ''));
  if (Number.isNaN(n)) return ERR('#VALUE!');
  return /%\s*$/.test(String(v)) ? n / 100 : n;
}
const toStr = (v: Val): string => v === null ? '' : v instanceof SheetError ? v.code : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);

/** Interpret what someone typed into a cell as a value: numbers become numbers, everything else stays text. */
export function parseRaw(raw: string): Val {
  if (raw === '') return null;
  const s = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(s) || /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^TRUE$/i.test(s)) return true;
  if (/^FALSE$/i.test(s)) return false;
  return raw;
}

type Range = { tab: string | null; r1: number; c1: number; r2: number; c2: number };
type Arg = Val | Range;
const isRange = (a: Arg): a is Range => typeof a === 'object' && a !== null && 'r1' in a;

export class Evaluator {
  private cache = new Map<string, Val>();
  private stack = new Set<string>();
  constructor(private raw: RawGetter, private currentTab: string) {}

  /** The value shown for a cell: the formula's result, or the typed value. */
  value(tab: string | null, r: number, c: number): Val {
    const tn = tab ?? this.currentTab;
    const key = `${tn}!${r}:${c}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const raw = this.raw(tn, r, c);
    let out: Val;
    if (raw.startsWith('=') && raw.length > 1) {
      if (this.stack.has(key)) return ERR('#CIRC!');
      this.stack.add(key);
      try { out = this.run(raw.slice(1), tn); } catch (e) { out = e instanceof SheetError ? e : ERR('#ERROR!'); }
      this.stack.delete(key);
    } else out = parseRaw(raw);
    this.cache.set(key, out);
    return out;
  }

  private run(src: string, tab: string): Val {
    const toks = lex(src); let p = 0;
    const peek = () => toks[p]; const next = () => toks[p++];
    const self = this;
    const scalar = (a: Arg): Val => isRange(a) ? self.value(a.tab ?? tab, a.r1, a.c1) : a;
    const flat = (a: Arg): Val[] => {
      if (!isRange(a)) return [a];
      const out: Val[] = [];
      for (let r = a.r1; r <= a.r2; r++) for (let c = a.c1; c <= a.c2; c++) out.push(self.value(a.tab ?? tab, r, c));
      return out;
    };
    const nums = (args: Arg[]): number[] => {
      const out: number[] = [];
      for (const a of args) for (const v of flat(a)) {
        if (v instanceof SheetError) throw v;
        if (v === null || v === '') continue;
        if (typeof v === 'number') out.push(v); else if (typeof v === 'boolean') { if (!isRange(a)) out.push(v ? 1 : 0); }
        else if (!isRange(a)) { const n = toNum(v); if (n instanceof SheetError) throw n; out.push(n); }
      }
      return out;
    };
    const crit = (v: Val, c: Val): boolean => {
      const cs = toStr(c);
      const m = /^(<=|>=|<>|=|<|>)?(.*)$/.exec(cs)!;
      const op = m[1] || '=', rhs = m[2];
      const rn = Number(rhs), vn = typeof v === 'number' ? v : Number(v);
      if (rhs !== '' && !Number.isNaN(rn) && v !== null && v !== '' && !Number.isNaN(vn)) {
        return op === '=' ? vn === rn : op === '<>' ? vn !== rn : op === '<' ? vn < rn : op === '>' ? vn > rn : op === '<=' ? vn <= rn : vn >= rn;
      }
      const a = toStr(v).toLowerCase(), b = rhs.toLowerCase();
      if (b.includes('*') || b.includes('?')) { const re = new RegExp('^' + b.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'); return op === '<>' ? !re.test(a) : re.test(a); }
      return op === '<>' ? a !== b : a === b;
    };
    const FN: Record<string, (a: Arg[]) => Val> = {
      SUM: a => nums(a).reduce((x, y) => x + y, 0),
      AVERAGE: a => { const n = nums(a); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : ERR('#DIV/0!'); },
      MIN: a => { const n = nums(a); return n.length ? Math.min(...n) : 0; },
      MAX: a => { const n = nums(a); return n.length ? Math.max(...n) : 0; },
      COUNT: a => a.flatMap(flat).filter(v => typeof v === 'number').length,
      COUNTA: a => a.flatMap(flat).filter(v => v !== null && v !== '').length,
      ABS: a => { const n = toNum(scalar(a[0])); if (n instanceof SheetError) throw n; return Math.abs(n); },
      ROUND: a => { const n = toNum(scalar(a[0])); const d = a[1] === undefined ? 0 : toNum(scalar(a[1])); if (n instanceof SheetError) throw n; if (d instanceof SheetError) throw d; const f = 10 ** d; return Math.round(n * f) / f; },
      IF: a => { const c = scalar(a[0]); const t = c === true || (typeof c === 'number' && c !== 0) || (typeof c === 'string' && c !== '' && !/^false$/i.test(c)); return t ? scalar(a[1] ?? true) : scalar(a[2] ?? false); },
      IFERROR: a => { const v = scalar(a[0]); return v instanceof SheetError ? scalar(a[1] ?? '') : v; },
      AND: a => a.flatMap(flat).every(v => v === true || (typeof v === 'number' && v !== 0)),
      OR: a => a.flatMap(flat).some(v => v === true || (typeof v === 'number' && v !== 0)),
      NOT: a => { const v = scalar(a[0]); return !(v === true || (typeof v === 'number' && v !== 0)); },
      CONCAT: a => a.flatMap(flat).map(toStr).join(''),
      CONCATENATE: a => a.flatMap(flat).map(toStr).join(''),
      LEN: a => toStr(scalar(a[0])).length,
      UPPER: a => toStr(scalar(a[0])).toUpperCase(),
      LOWER: a => toStr(scalar(a[0])).toLowerCase(),
      TRIM: a => toStr(scalar(a[0])).trim().replace(/\s+/g, ' '),
      TODAY: () => new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' }),
      COUNTIF: a => { if (!isRange(a[0])) throw ERR('#VALUE!'); const c = scalar(a[1]); return flat(a[0]).filter(v => crit(v, c)).length; },
      SUMIF: a => {
        if (!isRange(a[0])) throw ERR('#VALUE!');
        const c = scalar(a[1]); const crange = flat(a[0]);
        const srange = a[2] && isRange(a[2]) ? flat(a[2]) : crange;
        let s = 0; crange.forEach((v, i) => { if (crit(v, c)) { const n = srange[i]; if (typeof n === 'number') s += n; } });
        return s;
      },
    };

    const cmp = (): Arg => {
      let left = concat();
      for (;;) {
        const t = peek();
        if (t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
          next(); const right = scalar(concat()), l = scalar(left);
          const ln = typeof l === 'number' ? l : Number(l), rn = typeof right === 'number' ? right : Number(right);
          const numeric = l !== null && right !== null && l !== '' && right !== '' && !Number.isNaN(ln) && !Number.isNaN(rn) && typeof l !== 'boolean';
          const a = numeric ? ln : toStr(l).toLowerCase(), b = numeric ? rn : toStr(right).toLowerCase();
          left = t.v === '=' ? a === b : t.v === '<>' ? a !== b : t.v === '<' ? a < b : t.v === '>' ? a > b : t.v === '<=' ? a <= b : a >= b;
        } else return left;
      }
    };
    const concat = (): Arg => {
      let left = add();
      while (peek().t === 'op' && peek().v === '&') { next(); const r = add(); left = toStr(scalar(left)) + toStr(scalar(r)); }
      return left;
    };
    const add = (): Arg => {
      let left = mul();
      while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = next().v; const r = scalar(mul()); const l = scalar(left);
        const a = toNum(l), b = toNum(r);
        if (a instanceof SheetError) throw a; if (b instanceof SheetError) throw b;
        left = op === '+' ? a + b : a - b;
      }
      return left;
    };
    const mul = (): Arg => {
      let left = pow();
      while (peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
        const op = next().v; const r = scalar(pow()); const l = scalar(left);
        const a = toNum(l), b = toNum(r);
        if (a instanceof SheetError) throw a; if (b instanceof SheetError) throw b;
        if (op === '/' && b === 0) throw ERR('#DIV/0!');
        left = op === '*' ? a * b : a / b;
      }
      return left;
    };
    const pow = (): Arg => {
      const base = unary();
      if (peek().t === 'op' && peek().v === '^') { next(); const e = scalar(pow()); const a = toNum(scalar(base)), b = toNum(e); if (a instanceof SheetError) throw a; if (b instanceof SheetError) throw b; return a ** b; }
      return base;
    };
    const unary = (): Arg => {
      if (peek().t === 'op' && (peek().v === '-' || peek().v === '+')) { const op = next().v; const v = toNum(scalar(unary())); if (v instanceof SheetError) throw v; return op === '-' ? -v : v; }
      let v = primary();
      while (peek().t === 'op' && peek().v === '%') { next(); const n = toNum(scalar(v)); if (n instanceof SheetError) throw n; v = n / 100; }
      return v;
    };
    const parseRef = (id: string, tabName: string | null): Range | null => {
      const m = REF.exec(id); if (!m) return null;
      const r = Number(m[2]) - 1, c = colIndex(m[1]);
      return { tab: tabName, r1: r, c1: c, r2: r, c2: c };
    };
    const primary = (): Arg => {
      const t = next();
      if (t.t === 'num') return Number(t.v);
      if (t.t === 'str') return t.v;
      if (t.t === 'lp') { const v = cmp(); if (next().t !== 'rp') throw ERR('#ERROR!'); return v; }
      if (t.t === 'id') {
        let tabName: string | null = null, id = t.v;
        if (peek().t === 'op' && peek().v === '!') { next(); tabName = id; id = next().v; }
        if (peek().t === 'lp') {
          next();
          const args: Arg[] = [];
          if (peek().t !== 'rp') for (;;) { args.push(cmp()); if (peek().t === 'comma') { next(); continue; } break; }
          if (next().t !== 'rp') throw ERR('#ERROR!');
          const fn = FN[id.toUpperCase()]; if (!fn) throw ERR('#NAME?');
          return fn(args);
        }
        if (/^true$/i.test(id)) return true;
        if (/^false$/i.test(id)) return false;
        const a = parseRef(id, tabName); if (!a) throw ERR('#NAME?');
        if (peek().t === 'colon') {
          next(); const b = parseRef(next().v, tabName); if (!b) throw ERR('#REF!');
          return { tab: tabName, r1: Math.min(a.r1, b.r1), c1: Math.min(a.c1, b.c1), r2: Math.max(a.r2, b.r2), c2: Math.max(a.c2, b.c2) };
        }
        return a;
      }
      throw ERR('#ERROR!');
    };

    const result = cmp();
    if (peek().t !== 'end') throw ERR('#ERROR!');
    const out = scalar(result);
    return out;
  }
}

export function displayVal(v: Val): string {
  if (v === null) return '';
  if (v instanceof SheetError) return v.code;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e9) / 1e9);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

// ── Import / export ──────────────────────────────────────────────────────────────────────

/** A table of text (CSV rows, an Excel sheet…) → the cells of a tab. */
export function fillTabFromGrid(tab: Y.Map<unknown>, grid: string[][]) {
  const cells = tCells(tab);
  let maxC = 0;
  grid.forEach((row, r) => row.forEach((v, c) => { if (v !== '' && v != null) { cells.set(cellKey(r, c), String(v)); maxC = Math.max(maxC, c + 1); } }));
  tab.set('rows', Math.min(MAX_ROWS, Math.max(DEFAULT_ROWS, grid.length + 20)));
  tab.set('ncols', Math.min(MAX_COLS, Math.max(DEFAULT_COLS, maxC + 1)));
}

/** Rows of text of a tab (what is typed, formulas included) trimmed to the used area — for CSV / Excel export. */
export function tabGrid(tab: Y.Map<unknown>, evaluated?: (r: number, c: number) => string): string[][] {
  let maxR = -1, maxC = -1;
  tCells(tab).forEach((v, k) => { if (v !== '') { const [r, c] = parseKey(k); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); } });
  const out: string[][] = [];
  for (let r = 0; r <= maxR; r++) { const row: string[] = []; for (let c = 0; c <= maxC; c++) row.push(evaluated ? evaluated(r, c) : tCells(tab).get(cellKey(r, c)) ?? ''); out.push(row); }
  return out;
}

export function csvEscape(v: string) { return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Build a whole sheet (one tab per entry) as a saved Yjs state. */
export function sheetStateFromTabs(tabs: Array<{ name: string; grid: string[][]; frozen?: number; feed?: string; widths?: Record<number, number>; bold?: string[] }>): { ystate: string; text: string } {
  const doc = new Y.Doc();
  try {
    doc.transact(() => {
      tabs.forEach((t, i) => {
        const m = newTabMap(t.name.slice(0, 60), i, 100, 12, t.frozen ?? 0);
        tabsMap(doc).set(i === 0 ? 'tab1' : newId(), m);
        fillTabFromGrid(m, t.grid);
        if (t.feed) m.set('feed', t.feed);
        for (const [c, w] of Object.entries(t.widths ?? {})) tCols(m).set(String(c), w);
        for (const k of t.bold ?? []) tBold(m).set(k, true);
      });
    });
    return { ystate: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), text: sheetText(doc) };
  } finally { doc.destroy(); }
}

// ── Live CRM feeds ───────────────────────────────────────────────────────────────────────
// A feed tab is filled from the CRM (the server builds the rows; the browser writes them, so teammates see the refresh live).
// The tab's first `header.length` columns belong to the feed and are rewritten on every refresh; any column the team adds to the
// right of them (notes, owner, status…) stays attached to the same CRM record even when the feed re-orders the rows.

export interface FeedData {
  feed: string;
  title: string;
  header: string[];
  widths?: number[];
  /** One row per CRM record. `key` is the record id — it ties the team's own columns to the record. */
  rows: Array<{ key: string; cells: string[] }>;
  /** Names for the team's own columns the first time (e.g. "Team notes"). */
  extraHeaders?: string[];
}

export function applyFeed(tab: Y.Map<unknown>, data: FeedData) {
  const cells = tCells(tab), bold = tBold(tab), cols = tCols(tab);
  const nSys = data.header.length;
  let keys = tab.get('feedKeys') as Y.Map<number> | undefined;
  if (!(keys instanceof Y.Map)) { keys = new Y.Map<number>(); tab.set('feedKeys', keys); }
  // what the team typed to the right of the feed's columns, per record
  const keep = new Map<string, Map<number, string>>();
  let maxC = nSys - 1;
  cells.forEach((v, k) => { const [r, c] = parseKey(k); if (c >= nSys) maxC = Math.max(maxC, c); if (r === 0 && c >= nSys) return; });
  keys.forEach((r, key) => {
    const extra = new Map<number, string>();
    for (let c = nSys; c <= maxC; c++) { const v = cells.get(cellKey(r, c)); if (v) extra.set(c, v); }
    if (extra.size) keep.set(key, extra);
  });
  const headerExtra = new Map<number, string>();
  for (let c = nSys; c <= maxC; c++) { const v = cells.get(cellKey(0, c)); if (v) headerExtra.set(c, v); }
  if (!headerExtra.size && data.extraHeaders) data.extraHeaders.forEach((h, i) => headerExtra.set(nSys + i, h));

  // wipe the feed's area (and the old extras) then rewrite in the feed's order
  const oldKeys = [...cells.keys()];
  for (const k of oldKeys) cells.delete(k);
  keys.forEach((_, key) => keys!.delete(key));
  data.header.forEach((h, c) => { cells.set(cellKey(0, c), h); bold.set(cellKey(0, c), true); });
  headerExtra.forEach((v, c) => { cells.set(cellKey(0, c), v); bold.set(cellKey(0, c), true); });
  data.rows.forEach((row, i) => {
    const r = i + 1;
    row.cells.forEach((v, c) => { if (v !== '') cells.set(cellKey(r, c), v); });
    keys!.set(row.key, r);
    keep.get(row.key)?.forEach((v, c) => cells.set(cellKey(r, c), v));
  });
  tab.set('frozen', 1);
  tab.set('rows', Math.min(MAX_ROWS, Math.max(DEFAULT_ROWS, data.rows.length + 30)));
  tab.set('ncols', Math.min(MAX_COLS, Math.max(DEFAULT_COLS, nSys + Math.max(1, headerExtra.size) + 2)));
  (data.widths ?? []).forEach((w, c) => cols.set(String(c), w));
  tab.set('feedAt', Date.now());
}
