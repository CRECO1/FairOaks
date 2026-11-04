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
  if (Number.isNaN(n)) { const d = dateSerial(String(v)); return d === null ? ERR('#VALUE!') : d; }
  return /%\s*$/.test(String(v)) ? n / 100 : n;
}
const toStr = (v: Val): string => v === null ? '' : v instanceof SheetError ? v.code : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);


// ── dates + number formats ───────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);
export const serialOf = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS);
export const dateOf = (serial: number) => new Date(EPOCH + Math.round(serial) * DAY_MS);
/** "10/14/2026", "2026-10-14" → a day number (days since 1899-12-30, like Excel / Sheets). */
export function dateSerial(s: string): number | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(t);
  if (m) return serialOf(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) return serialOf(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}
export const fmtDate = (serial: number) => { const d = dateOf(serial); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`; };

export interface CellFmt { i?: 1; u?: 1; s?: 1; bg?: string; fg?: string; al?: 'l' | 'c' | 'r'; nf?: 'plain' | 'num' | 'cur' | 'pct' | 'date' | 'text'; dp?: number }

const withCommas = (n: number, dp: number) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** What a cell shows, after its number format (the typed text / formula is unchanged). */
export function formatVal(v: Val, f: CellFmt | undefined): string {
  if (v === null) return '';
  if (v instanceof SheetError) return v.code;
  const nf = f?.nf, dp = f?.dp;
  if (nf === 'text') return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
  if (nf === 'date') { const n = typeof v === 'number' ? v : dateSerial(String(v)); return n === null || n === undefined ? String(v) : fmtDate(n); }
  if (typeof v === 'number') {
    if (nf === 'num') return withCommas(v, dp ?? 2);
    if (nf === 'cur') return (v < 0 ? '-$' : '$') + withCommas(Math.abs(v), dp ?? 2);
    if (nf === 'pct') return `${(v * 100).toFixed(dp ?? 0)}%`;
    if (dp !== undefined) return v.toFixed(dp);
  }
  return displayVal(v);
}

/** Excel-style TEXT(): dates (m/d/yyyy, mm/dd/yyyy, yyyy-mm-dd) and numbers (0.00, #,##0, $#,##0.00, 0%). */
export function textFormat(v: Val, pattern: string): string {
  const p = pattern.trim();
  if (/[ymd]/i.test(p) && !/[0#]/.test(p)) {
    const n = typeof v === 'number' ? v : dateSerial(toStr(v)); if (n === null) return toStr(v);
    const d = dateOf(n), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return p.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gi, t => { const k = t.toLowerCase(); return k === 'yyyy' ? String(y) : k === 'yy' ? String(y).slice(2) : k === 'mmmm' ? months[m - 1] : k === 'mmm' ? months[m - 1].slice(0, 3) : k === 'mm' ? String(m).padStart(2, '0') : k === 'm' ? String(m) : k === 'dd' ? String(dd).padStart(2, '0') : String(dd); });
  }
  const n = toNum(v); if (n instanceof SheetError) return toStr(v);
  const dec = (p.split('.')[1] ?? '').replace(/[^0#]/g, '').length, pct = p.includes('%'), cur = p.includes('$'), comma = p.includes(',');
  const x = pct ? n * 100 : n;
  const body = comma ? withCommas(Math.abs(x), dec) : Math.abs(x).toFixed(dec);
  return `${x < 0 ? '-' : ''}${cur ? '$' : ''}${body}${pct ? '%' : ''}`;
}

/** Conditional-format rule test. */
export type CondOp = 'gt' | 'lt' | 'ge' | 'le' | 'eq' | 'ne' | 'contains' | 'empty' | 'notempty';
export function condMatch(v: Val, op: CondOp, val: string): boolean {
  const blank = v === null || v === '';
  if (op === 'empty') return blank;
  if (op === 'notempty') return !blank;
  if (blank) return false;
  if (op === 'contains') return toStr(v).toLowerCase().includes(val.toLowerCase());
  const a = typeof v === 'number' ? v : Number(v), b = Number(val);
  const numeric = !Number.isNaN(a) && val.trim() !== '' && !Number.isNaN(b);
  const x = numeric ? a : toStr(v).toLowerCase(), y = numeric ? b : val.toLowerCase();
  return op === 'gt' ? x > y : op === 'lt' ? x < y : op === 'ge' ? x >= y : op === 'le' ? x <= y : op === 'eq' ? x === y : x !== y;
}

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
  curRow: number | null = null; curCol: number | null = null;
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
      const pr = this.curRow, pc = this.curCol; this.curRow = r; this.curCol = c;
      try { out = this.run(raw.slice(1), tn); } catch (e) { out = e instanceof SheetError ? e : ERR('#ERROR!'); }
      this.curRow = pr; this.curCol = pc;
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

    // ── more functions (the everyday Google Sheets / Excel set) ──
    const sNum = (x: Arg | undefined, dflt = 0): number => { if (x === undefined) return dflt; const n = toNum(scalar(x)); if (n instanceof SheetError) throw n; return n; };
    const sStr = (x: Arg | undefined): string => (x === undefined ? '' : toStr(scalar(x)));
    const matrix = (a: Arg): Val[][] => { if (!isRange(a)) return [[a]]; const out: Val[][] = []; for (let r = a.r1; r <= a.r2; r++) { const row: Val[] = []; for (let c = a.c1; c <= a.c2; c++) row.push(self.value(a.tab ?? tab, r, c)); out.push(row); } return out; };
    const same = (a: Val, b: Val) => (typeof a === 'number' && typeof b === 'number') ? a === b : toStr(a).toLowerCase() === toStr(b).toLowerCase();
    const isBlank = (v: Val) => v === null || v === '';
    const pairs = (a: Arg[]) => { const out: Array<[Val[], Val]> = []; for (let i = 0; i + 1 < a.length; i += 2) out.push([flat(a[i]), scalar(a[i + 1])]); return out; };
    const allMatch = (ps: Array<[Val[], Val]>, i: number) => ps.every(([range, c]) => crit(range[i], c));
    const lookup = (key: Val, rowsOf: Val[][], col: number, exact: boolean): Val => {
      if (exact) { const hit = rowsOf.find(r => same(r[0], key)); if (!hit) throw ERR('#N/A'); return hit[col] ?? ERR('#REF!'); }
      let best: Val[] | null = null; for (const r of rowsOf) { if (typeof r[0] === 'number' && typeof key === 'number' ? r[0] <= key : toStr(r[0]).toLowerCase() <= toStr(key).toLowerCase()) best = r; else break; }
      if (!best) throw ERR('#N/A'); return best[col] ?? ERR('#REF!');
    };
    Object.assign(FN, {
      MEDIAN: (a: Arg[]) => { const n = nums(a).sort((x, y) => x - y); if (!n.length) throw ERR('#NUM!'); const m = Math.floor(n.length / 2); return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
      PRODUCT: (a: Arg[]) => nums(a).reduce((x, y) => x * y, 1),
      POWER: (a: Arg[]) => sNum(a[0]) ** sNum(a[1]),
      SQRT: (a: Arg[]) => { const n = sNum(a[0]); if (n < 0) throw ERR('#NUM!'); return Math.sqrt(n); },
      MOD: (a: Arg[]) => { const d = sNum(a[1]); if (d === 0) throw ERR('#DIV/0!'); const n = sNum(a[0]); return n - d * Math.floor(n / d); },
      INT: (a: Arg[]) => Math.floor(sNum(a[0])),
      ROUNDUP: (a: Arg[]) => { const f = 10 ** sNum(a[1], 0), n = sNum(a[0]); return (n < 0 ? -Math.ceil(-n * f) : Math.ceil(n * f)) / f; },
      ROUNDDOWN: (a: Arg[]) => { const f = 10 ** sNum(a[1], 0), n = sNum(a[0]); return (n < 0 ? -Math.floor(-n * f) : Math.floor(n * f)) / f; },
      CEILING: (a: Arg[]) => { const m = sNum(a[1], 1) || 1; return Math.ceil(sNum(a[0]) / m) * m; },
      FLOOR: (a: Arg[]) => { const m = sNum(a[1], 1) || 1; return Math.floor(sNum(a[0]) / m) * m; },
      LARGE: (a: Arg[]) => { const n = nums([a[0]]).sort((x, y) => y - x), k = sNum(a[1]); if (k < 1 || k > n.length) throw ERR('#NUM!'); return n[k - 1]; },
      SMALL: (a: Arg[]) => { const n = nums([a[0]]).sort((x, y) => x - y), k = sNum(a[1]); if (k < 1 || k > n.length) throw ERR('#NUM!'); return n[k - 1]; },
      LEFT: (a: Arg[]) => sStr(a[0]).slice(0, sNum(a[1], 1)),
      RIGHT: (a: Arg[]) => { const t = sStr(a[0]), n = sNum(a[1], 1); return n <= 0 ? '' : t.slice(-n); },
      MID: (a: Arg[]) => sStr(a[0]).substr(Math.max(0, sNum(a[1]) - 1), sNum(a[2])),
      FIND: (a: Arg[]) => { const i = sStr(a[1]).indexOf(sStr(a[0]), Math.max(0, sNum(a[2], 1) - 1)); if (i < 0) throw ERR('#VALUE!'); return i + 1; },
      SEARCH: (a: Arg[]) => { const i = sStr(a[1]).toLowerCase().indexOf(sStr(a[0]).toLowerCase(), Math.max(0, sNum(a[2], 1) - 1)); if (i < 0) throw ERR('#VALUE!'); return i + 1; },
      SUBSTITUTE: (a: Arg[]) => { const find = sStr(a[1]); return find === '' ? sStr(a[0]) : sStr(a[0]).split(find).join(sStr(a[2])); },
      TEXT: (a: Arg[]) => textFormat(scalar(a[0]), sStr(a[1])),
      VALUE: (a: Arg[]) => { const n = toNum(scalar(a[0])); if (n instanceof SheetError) throw n; return n; },
      TEXTJOIN: (a: Arg[]) => { const d = sStr(a[0]), skip = scalar(a[1]) === true; return a.slice(2).flatMap(flat).filter(v => !(skip && isBlank(v))).map(toStr).join(d); },
      REPT: (a: Arg[]) => sStr(a[0]).repeat(Math.max(0, Math.min(1000, sNum(a[1])))),
      PROPER: (a: Arg[]) => sStr(a[0]).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, p1: string, p2: string) => p1 + p2.toUpperCase()),
      DATE: (a: Arg[]) => fmtDate(serialOf(sNum(a[0]), sNum(a[1]), sNum(a[2]))),
      NOW: () => new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
      YEAR: (a: Arg[]) => dateOf(sNum(a[0])).getUTCFullYear(),
      MONTH: (a: Arg[]) => dateOf(sNum(a[0])).getUTCMonth() + 1,
      DAY: (a: Arg[]) => dateOf(sNum(a[0])).getUTCDate(),
      DAYS: (a: Arg[]) => sNum(a[0]) - sNum(a[1]),
      EDATE: (a: Arg[]) => { const d = dateOf(sNum(a[0])); return fmtDate(serialOf(d.getUTCFullYear(), d.getUTCMonth() + 1 + sNum(a[1]), d.getUTCDate())); },
      ISBLANK: (a: Arg[]) => isBlank(scalar(a[0])),
      ISNUMBER: (a: Arg[]) => typeof scalar(a[0]) === 'number',
      ISTEXT: (a: Arg[]) => { const v = scalar(a[0]); return typeof v === 'string' && v !== ''; },
      ISERROR: (a: Arg[]) => scalar(a[0]) instanceof SheetError,
      COUNTBLANK: (a: Arg[]) => a.flatMap(flat).filter(isBlank).length,
      COUNTIFS: (a: Arg[]) => { const ps = pairs(a); if (!ps.length) return 0; let n = 0; for (let i = 0; i < ps[0][0].length; i++) if (allMatch(ps, i)) n++; return n; },
      SUMIFS: (a: Arg[]) => { const sum = flat(a[0]), ps = pairs(a.slice(1)); let t = 0; sum.forEach((v, i) => { if (allMatch(ps, i) && typeof v === 'number') t += v; }); return t; },
      AVERAGEIF: (a: Arg[]) => { if (!isRange(a[0])) throw ERR('#VALUE!'); const c = scalar(a[1]), rng = flat(a[0]), avg = a[2] && isRange(a[2]) ? flat(a[2]) : rng; const v = rng.map((x, i) => (crit(x, c) && typeof avg[i] === 'number' ? (avg[i] as number) : null)).filter((x): x is number => x !== null); if (!v.length) throw ERR('#DIV/0!'); return v.reduce((x, y) => x + y, 0) / v.length; },
      SUMPRODUCT: (a: Arg[]) => { const arrs = a.map(x => flat(x).map(v => (typeof v === 'number' ? v : 0))); const n = arrs[0]?.length ?? 0; let t = 0; for (let i = 0; i < n; i++) t += arrs.reduce((p, r) => p * (r[i] ?? 0), 1); return t; },
      VLOOKUP: (a: Arg[]) => lookup(scalar(a[0]), matrix(a[1]), sNum(a[2]) - 1, a[3] === undefined ? false : scalar(a[3]) === false || scalar(a[3]) === 0 ? true : false),
      HLOOKUP: (a: Arg[]) => { const m = matrix(a[1]); const cols = m[0].map((_, c) => m.map(r => r[c])); return lookup(scalar(a[0]), cols, sNum(a[2]) - 1, a[3] === undefined ? false : scalar(a[3]) === false || scalar(a[3]) === 0 ? true : false); },
      INDEX: (a: Arg[]) => { const m = matrix(a[0]); const r = sNum(a[1], 1) - 1, c = sNum(a[2], 1) - 1; const row = m.length === 1 && a[2] === undefined ? undefined : m[r]; if (m.length === 1 && a[2] === undefined) return m[0][r] ?? ERR('#REF!'); return row?.[c] ?? ERR('#REF!'); },
      MATCH: (a: Arg[]) => { const key = scalar(a[0]), arr = flat(a[1]), mode = sNum(a[2], 1); if (mode === 0) { const i = arr.findIndex(v => same(v, key)); if (i < 0) throw ERR('#N/A'); return i + 1; } let best = -1; arr.forEach((v, i) => { if (typeof v === 'number' && typeof key === 'number' ? (mode > 0 ? v <= key : v >= key) : false) best = i; }); if (best < 0) throw ERR('#N/A'); return best + 1; },
      XLOOKUP: (a: Arg[]) => { const key = scalar(a[0]), look = flat(a[1]), ret = flat(a[2]); const i = look.findIndex(v => same(v, key)); if (i < 0) { if (a[3] !== undefined) return scalar(a[3]); throw ERR('#N/A'); } return ret[i] ?? ERR('#REF!'); },
      CHOOSE: (a: Arg[]) => { const i = sNum(a[0]); if (i < 1 || i >= a.length) throw ERR('#VALUE!'); return scalar(a[i]); },
      IFS: (a: Arg[]) => { for (let i = 0; i + 1 < a.length; i += 2) { const c = scalar(a[i]); if (c === true || (typeof c === 'number' && c !== 0)) return scalar(a[i + 1]); } throw ERR('#N/A'); },
      SWITCH: (a: Arg[]) => { const v = scalar(a[0]); let i = 1; for (; i + 1 < a.length; i += 2) if (same(v, scalar(a[i]))) return scalar(a[i + 1]); if (i < a.length) return scalar(a[i]); throw ERR('#N/A'); },
      PMT: (a: Arg[]) => { const r = sNum(a[0]), n = sNum(a[1]), pv = sNum(a[2]), fv = sNum(a[3], 0); if (r === 0) return -(pv + fv) / n; const k = (1 + r) ** n; return -(pv * k + fv) * r / (k - 1); },
      ROW: (a: Arg[]) => (a[0] && isRange(a[0]) ? a[0].r1 + 1 : (self.curRow ?? 0) + 1),
      COLUMN: (a: Arg[]) => (a[0] && isRange(a[0]) ? a[0].c1 + 1 : (self.curCol ?? 0) + 1),
    });

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
  if (!tab.get('feedAt')) tab.set('frozen', 1);   // the header row is frozen the first time only — after that it is the team's choice
  tab.set('rows', Math.min(MAX_ROWS, Math.max(DEFAULT_ROWS, data.rows.length + 30)));
  tab.set('ncols', Math.min(MAX_COLS, Math.max(DEFAULT_COLS, nSys + Math.max(1, headerExtra.size) + 2)));
  (data.widths ?? []).forEach((w, c) => cols.set(String(c), w));
  tab.set('feedAt', Date.now());
}

// ── formulas that move (copy / paste / fill, insert / delete rows and columns, tab rename) ──────────────

const REF_G = /(?<![A-Za-z0-9_.])(?:('[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,5})(?::(\$?)([A-Za-z]{1,3})(\$?)(\d{1,5}))?(?![A-Za-z0-9_(])/g;
const unq = (t: string) => (t.startsWith("'") ? t.slice(1, -1) : t);
const quoteTab = (t: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? t : `'${t}'`);

interface RefParts { tab: string | null; ac1: boolean; c1: number; ar1: boolean; r1: number; range: boolean; ac2: boolean; c2: number; ar2: boolean; r2: number }
function rewrite(formula: string, fn: (p: RefParts) => RefParts | null): string {
  if (!formula.startsWith('=')) return formula;
  return formula.split(/("(?:[^"]|"")*")/).map((seg, i) => (i % 2 ? seg : seg.replace(REF_G, (_m, tab, d1, col1, d2, row1, d3, col2, d4, row2) => {
    const p: RefParts = { tab: tab ?? null, ac1: !!d1, c1: colIndex(col1), ar1: !!d2, r1: Number(row1) - 1, range: col2 !== undefined, ac2: !!d3, c2: col2 ? colIndex(col2) : 0, ar2: !!d4, r2: row2 ? Number(row2) - 1 : 0 };
    const q = fn(p);
    if (!q) return '#REF!';
    const one = (ac: boolean, c: number, ar: boolean, r: number) => `${ac ? '$' : ''}${colName(c)}${ar ? '$' : ''}${r + 1}`;
    return `${q.tab ? q.tab + '!' : ''}${one(q.ac1, q.c1, q.ar1, q.r1)}${q.range ? ':' + one(q.ac2, q.c2, q.ar2, q.r2) : ''}`;
  }))).join('');
}

/** The formula as it reads when its cell is copied `dr` rows down and `dc` columns right (absolute $refs stay). */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  return rewrite(formula, p => {
    const q = { ...p, c1: p.ac1 ? p.c1 : p.c1 + dc, r1: p.ar1 ? p.r1 : p.r1 + dr, c2: p.ac2 ? p.c2 : p.c2 + dc, r2: p.ar2 ? p.r2 : p.r2 + dr };
    return q.c1 < 0 || q.r1 < 0 || q.c2 < 0 || q.r2 < 0 ? null : q;
  });
}

/** A row / column was inserted (delta 1) or deleted (delta -1) at `at` in `targetTab`: keep every reference to that tab pointing at the same cells. */
export function adjustFormula(formula: string, formulaTab: string, targetTab: string, axis: 'row' | 'col', at: number, delta: 1 | -1): string {
  return rewrite(formula, p => {
    if ((p.tab ? unq(p.tab) : formulaTab) !== targetTab) return p;
    const k1 = axis === 'row' ? 'r1' : 'c1', k2 = axis === 'row' ? 'r2' : 'c2';
    const q = { ...p } as RefParts;
    const a = p[k1], b = p.range ? p[k2] : p[k1];
    let na: number, nb: number;
    if (delta === 1) { na = a >= at ? a + 1 : a; nb = b >= at ? b + 1 : b; }
    else {
      if (!p.range && a === at) return null;
      if (p.range && a === at && b === at) return null;
      na = a > at ? a - 1 : a; nb = b >= at ? b - 1 : b;
      if (nb < na) return null;
    }
    q[k1] = na; if (p.range) q[k2] = nb;
    return q;
  });
}

export function renameTabRefs(formula: string, oldName: string, newName: string): string {
  return rewrite(formula, p => (p.tab && unq(p.tab) === oldName ? { ...p, tab: quoteTab(newName) } : p));
}

// ── per-cell extras live in doc-level maps keyed "<tabId>|r:c" (formats, validation, notes) + a list of conditional rules ──

export const mkey = (tabId: string, r: number, c: number) => `${tabId}|${r}:${c}`;
export const fmtMap = (d: Y.Doc) => d.getMap<string>('fmt');
export const validMap = (d: Y.Doc) => d.getMap<string>('valid');
export const notesMap = (d: Y.Doc) => d.getMap<string>('notes');
export const condList = (d: Y.Doc) => d.getArray<string>('cond');

export interface ValidRule { t: 'list' | 'check'; o?: string[] }
export interface NoteInfo { t: string; by: string; at: number }
export interface CondRule { id: string; tab: string; r1: number; c1: number; r2: number; c2: number; op: CondOp; val: string; bg?: string; fg?: string; b?: 1 }

const jparse = <T,>(s: string | undefined): T | undefined => { if (!s) return undefined; try { return JSON.parse(s) as T; } catch { return undefined; } };
export const getFmt = (d: Y.Doc, tabId: string, r: number, c: number): CellFmt => jparse<CellFmt>(fmtMap(d).get(mkey(tabId, r, c))) ?? {};
export function patchFmt(d: Y.Doc, tabId: string, r: number, c: number, patch: { [K in keyof CellFmt]?: CellFmt[K] | null }) {
  const cur: Record<string, unknown> = { ...getFmt(d, tabId, r, c) };
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) delete cur[k]; else cur[k] = v; }
  const k = mkey(tabId, r, c);
  if (Object.keys(cur).length) fmtMap(d).set(k, JSON.stringify(cur)); else fmtMap(d).delete(k);
}
export const getValid = (d: Y.Doc, tabId: string, r: number, c: number) => jparse<ValidRule>(validMap(d).get(mkey(tabId, r, c)));
export const getNote = (d: Y.Doc, tabId: string, r: number, c: number) => jparse<NoteInfo>(notesMap(d).get(mkey(tabId, r, c)));
export const condRules = (d: Y.Doc, tabId: string): CondRule[] => condList(d).toArray().map(s => jparse<CondRule>(s)).filter((x): x is CondRule => !!x && x.tab === tabId);

/** Insert / delete a row or column: move the formats, validation and notes of that tab the same way the cells move. */
export function shiftMeta(d: Y.Doc, tabId: string, axis: 'row' | 'col', at: number, delta: 1 | -1) {
  for (const m of [fmtMap(d), validMap(d), notesMap(d)]) {
    const moves: Array<[string, string | null, string]> = [];
    m.forEach((v, key) => {
      if (!key.startsWith(tabId + '|')) return;
      const [r, c] = parseKey(key.slice(tabId.length + 1)); const i = axis === 'row' ? r : c;
      if (delta === 1 && i >= at) moves.push([key, axis === 'row' ? mkey(tabId, r + 1, c) : mkey(tabId, r, c + 1), v]);
      if (delta === -1) { if (i === at) moves.push([key, null, v]); else if (i > at) moves.push([key, axis === 'row' ? mkey(tabId, r - 1, c) : mkey(tabId, r, c - 1), v]); }
    });
    for (const [k] of moves) m.delete(k);
    for (const [, to, v] of moves) if (to) m.set(to, v);
  }
}

/** Deep copy of one tab's data (used by "Duplicate tab" and "Restore version"). */
export function cloneTabMap(src: Y.Map<unknown>): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  src.forEach((v, k) => {
    if (v instanceof Y.Map) { const m = new Y.Map<unknown>(); v.forEach((x, kk) => m.set(kk, x)); out.set(k, m); } else out.set(k, v);
  });
  return out;
}
/** Make `target` look exactly like `source` (tabs, formats, validation, notes, rules). One transaction, so everyone editing sees it at once. */
export function replaceSheetContents(target: Y.Doc, source: Y.Doc) {
  target.transact(() => {
    const t = tabsMap(target); [...t.keys()].forEach(k => t.delete(k));
    tabsMap(source).forEach((m, id) => t.set(id, cloneTabMap(m)));
    for (const [get] of [[fmtMap], [validMap], [notesMap]] as Array<[(d: Y.Doc) => Y.Map<string>]>) { const tm = get(target); [...tm.keys()].forEach(k => tm.delete(k)); get(source).forEach((v, k) => tm.set(k, v)); }
    const cl = condList(target); if (cl.length) cl.delete(0, cl.length); cl.push(condList(source).toArray());
  }, 'sheet-local');
}
