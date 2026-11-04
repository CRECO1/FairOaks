'use client';

/**
 * SheetEditor — a Google-Sheets-style spreadsheet in My Drive that teammates edit together in real time.
 *
 * Same plumbing as LiveDocEditor: a Yjs document owned by the module-level registry, live traffic over the private Realtime
 * channel `drive-doc:<id>`, durable saves merged by /api/crm/drive/doc-state/<id>. The cells live in the `tabs` map of that
 * document (see lib/drive-sheet.ts); formats, dropdown/checkbox rules, notes and conditional-format rules live in doc-level maps.
 * The grid is drawn here (only the visible rows are rendered) with frozen rows + columns, filters, find & replace, a right-click
 * menu, autofill, formulas that follow when rows move, and CSV / Excel download.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';
import { createClient } from '@/lib/supabase/client';
import { acquireDoc, releaseDoc, type CollabHandle } from '@/lib/collab/doc-registry';
import type { CollabStatus } from '@/lib/collab/supabase-yjs-provider';
import type { DriveDoc } from '@/lib/drive-types';
import {
  Evaluator, MAX_COLS, MAX_ROWS, SheetError, addr, adjustFormula, applyFeed, cellKey, chartList, colIndex, colName, condList, condMatch, csvEscape, extMap, fmtMap, formatVal, getNote, getValid, listTabs, mergeList, mkey, newId, newTabMap, cloneTabMap,
  notesMap, parseKey, patchFmt, renameTabRefs, shiftFormula, shiftMeta, tBold, tCells, tCols, tabGrid, tabsMap, validMap,
  type CellFmt, type CondOp, type CondRule, type ChartDef, type FeedData, type MergeRange, type NoteInfo, type TabInfo, type ValidRule,
} from '@/lib/drive-sheet';
import { Frame, btnStyle, colorFor, iconBtn } from './DocChrome';
import { ActivityPanel } from './DocPanel';
import { CondDialog, Divider, HistoryDialog, Item, NoteDialog, Palette, Pop, ValidDialog } from './SheetParts';
import { ChartDialog, ChartSvg, type ChartData } from './SheetChart';
import type { DrivePerson } from './DocsDrive';

interface Props {
  doc: DriveDoc;
  initialState: Uint8Array | null;
  authToken?: string;
  user: { id: string; name: string };
  isMobile: boolean;
  onClose: () => void;
  onShare?: (doc: DriveDoc) => void;
  onToast: (msg: string) => void;
  onTitle?: (id: string, title: string) => void;
  people?: DrivePerson[];
}
interface Peer { name: string; color: string; cell?: { tab: string; r: number; c: number } }
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
interface Sel { r: number; c: number; r2: number; c2: number }
type Edit = { r: number; c: number; text: string } | null;
interface ClipCell { raw: string; fmt: string; bold: boolean; valid: string }
interface Clip { text: string; r1: number; c1: number; cells: ClipCell[][] }

const ROW_H = 26, HEAD_H = 26, NUM_W = 48, DEF_W = 120, MIN_W = 36;
const LOCAL = 'sheet-local';
const LINK = /^(https?:\/\/\S+|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

export default function SheetWorkspace({ doc, initialState, authToken, user, isMobile, onClose, onShare, onToast, onTitle, people = [] }: Props) {
  const [handle, setHandle] = useState<CollabHandle | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [save, setSave] = useState<SaveState>('saved');
  const [title, setTitle] = useState(doc.title);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [panel, setPanel] = useState<null | 'activity'>(null);
  const [history, setHistory] = useState(false);
  const me = useMemo<Peer>(() => ({ name: user.name || 'Teammate', color: colorFor(user.id) }), [user.id, user.name]);
  const authRef = useRef(authToken); authRef.current = authToken;
  const toastRef = useRef(onToast); toastRef.current = onToast;
  const flushRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const supabase = createClient();
    if (authToken) supabase.realtime.setAuth(authToken);
    const h = acquireDoc(supabase, doc.id, { onStatus: setStatus, initialState });
    h.awareness.setLocalStateField('user', me);
    const refreshPeers = () => {
      const list: Peer[] = [];
      h.awareness.getStates().forEach((s, clientId) => {
        if (clientId === h.ydoc.clientID) return;
        const st = s as { user?: Peer; cell?: Peer['cell'] };
        if (st.user?.name) list.push({ ...st.user, cell: st.cell });
      });
      setPeers(list);
    };
    h.awareness.on('change', refreshPeers); refreshPeers();

    const meta = h.ydoc.getMap<unknown>('meta');
    const onMeta = (ev: Y.YMapEvent<unknown>) => {
      if (ev.transaction.local || !ev.keysChanged.has('title')) return;
      const t = meta.get('title');
      if (typeof t === 'string') { setTitle(t); onTitle?.(doc.id, t); }
    };
    meta.observe(onMeta);

    // Saving: collect updates, merge, send after typing pauses (or every 6 s while typing).
    const pending: Uint8Array[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined, maxTimer: ReturnType<typeof setTimeout> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    let saving = false, again = false;
    const headers = () => ({ 'Content-Type': 'application/json', ...(authRef.current ? { Authorization: `Bearer ${authRef.current}` } : {}) });
    const flush = async (leaving = false) => {
      clearTimeout(timer); clearTimeout(maxTimer); timer = undefined; maxTimer = undefined;
      if (!pending.length) return;
      if (saving) { again = true; return; }
      const batch = pending.splice(0);
      const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
      const b64 = toBase64(merged);
      saving = true; setSave('saving');
      try {
        const r = await fetch(`/api/crm/drive/doc-state/${doc.id}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ update: b64 }), keepalive: leaving && b64.length < 60_000 });
        if (!r.ok) {
          if (r.status === 404 || r.status === 410) { setSave('error'); toastRef.current('This spreadsheet is no longer available — your last changes could not be saved'); return; }
          throw new Error(String(r.status));
        }
        if (!pending.length) setSave('saved');
      } catch {
        pending.unshift(merged); setSave('error');
        clearTimeout(retry); retry = setTimeout(() => void flush(), 5000);
      } finally {
        saving = false;
        if ((again || pending.length) && !retry) { again = false; timer = setTimeout(() => void flush(), 400); }
      }
    };
    flushRef.current = async () => {
      await flush();
      for (let i = 0; i < 30 && (saving || pending.length); i++) { await new Promise(r => setTimeout(r, 150)); if (!saving && pending.length) await flush(); }
    };
    const onUpdate = (u: Uint8Array, origin: unknown) => {
      if (origin === 'seed') return;
      pending.push(u);
      setSave(s => (s === 'saving' ? s : 'dirty'));
      clearTimeout(timer); timer = setTimeout(() => void flush(), 1200);
      if (!maxTimer) maxTimer = setTimeout(() => void flush(), 6000);
    };
    h.ydoc.on('update', onUpdate);
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(true); };
    const onPageHide = () => void flush(true);
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (pending.length || saving) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    setHandle(h);
    return () => {
      h.awareness.off('change', refreshPeers); meta.unobserve(onMeta); h.ydoc.off('update', onUpdate);
      document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onPageHide); window.removeEventListener('beforeunload', onBeforeUnload);
      clearTimeout(retry); void flush(true); releaseDoc(doc.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const titleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onTitleInput = (v: string) => {
    setTitle(v);
    handle?.ydoc.getMap<string>('meta').set('title', v);
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      const t = v.trim(); if (!t) return;
      onTitle?.(doc.id, t);
      try { await fetch(`/api/crm/drive/items/doc/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(authRef.current ? { Authorization: `Bearer ${authRef.current}` } : {}) }, body: JSON.stringify({ title: t }) }); } catch { /* the next keystroke retries */ }
    }, 700);
  };

  const dot = status === 'connected' ? '#16a34a' : status === 'connecting' ? '#d97706' : '#dc2626';
  const statusLabel = status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : status === 'denied' ? 'No live access' : 'Reconnecting…';
  const saveLabel = save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes' : 'Couldn’t save — retrying';

  return (
    <Frame isMobile={isMobile}>
      <header style={{ display: 'flex', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', rowGap: isMobile ? 4 : 0, gap: isMobile ? 4 : 12, padding: isMobile ? '8px 10px' : '8px 18px', background: 'var(--k-fff)', borderBottom: '1px solid var(--k-e5e7eb)', flexShrink: 0 }}>
        <button type="button" onClick={onClose} aria-label="Back to Docs" style={{ ...iconBtn(isMobile), fontSize: 18 }}>←</button>
        <div style={{ flex: isMobile ? '1 1 calc(100% - 56px)' : 1, minWidth: 0 }}>
          <input value={title} onChange={e => onTitleInput(e.target.value)} aria-label="Spreadsheet title" maxLength={300}
            style={{ width: '100%', border: '1px solid transparent', borderRadius: 6, background: 'transparent', fontSize: isMobile ? 16 : 17, fontWeight: 600, color: 'var(--k-1a1a1a)', padding: '3px 6px', fontFamily: "'DM Sans',sans-serif", textOverflow: 'ellipsis' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--k-d1d5db)')} onBlur={e => (e.currentTarget.style.borderColor = 'transparent')} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11.5, color: 'var(--k-9ca3af)', padding: '0 6px', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />{statusLabel}</span>
            <span style={{ color: save === 'error' ? 'var(--k-dc2626)' : undefined }}>{saveLabel}</span>
            {doc.visibility === 'private' && <span>🔒 Private</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {[me, ...peers].slice(0, 5).map((p, i) => (
            <span key={i} title={i === 0 ? `${p.name} (you)` : p.name}
              style={{ width: 28, height: 28, borderRadius: '50%', background: p.color, color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: i ? -7 : 0, border: '2px solid var(--k-fff)' }}>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
          {peers.length > 4 && <span style={{ fontSize: 11, marginLeft: 4, color: 'var(--k-6b7280)' }}>+{peers.length - 4}</span>}
        </div>
        <button type="button" onClick={() => setPanel(p => (p ? null : 'activity'))} aria-pressed={!!panel} aria-label="Activity log" title="Activity — every change to this spreadsheet"
          style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px', background: panel ? 'var(--k-fdf6e9)' : 'var(--k-fff)' }}>📜</button>
        <button type="button" onClick={() => setHistory(true)} aria-label="Version history" title="Version history" style={{ ...btnStyle(isMobile), padding: isMobile ? '0 8px' : '0 10px' }}>🕘</button>
        {onShare && <button type="button" onClick={() => onShare(doc)} style={{ ...btnStyle(isMobile), background: '#c9922c', color: '#fff', border: 'none' }}>Share</button>}
      </header>
      {status === 'denied' && (
        <div style={{ background: 'var(--k-fffbeb)', color: 'var(--k-92400e)', padding: '8px 16px', fontSize: 13, borderBottom: '1px solid var(--k-fde68a)' }}>
          Live editing isn’t available for you on this spreadsheet. What you type is saved, but others won’t see it until they reload.
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {handle ? <Grid handle={handle} me={me} peers={peers} isMobile={isMobile} docId={doc.id} authToken={authToken} title={title} onToast={onToast} />
          : <div style={{ padding: 28, color: 'var(--k-9ca3af)' }}>Connecting…</div>}
        {panel === 'activity' && <ActivityPanel docId={doc.id} authToken={authToken} me={user} people={people} isMobile={isMobile} onToast={onToast} onClose={() => setPanel(null)} />}
      </div>
      {history && handle && <HistoryDialog docId={doc.id} authToken={authToken} ydoc={handle.ydoc} people={people} flush={() => flushRef.current()} onToast={onToast} onClose={() => setHistory(false)} />}
    </Frame>
  );
}

// ── the grid ─────────────────────────────────────────────────────────────────────────────

const rangeLabel = (a: { r1: number; c1: number; r2: number; c2: number }) => (a.r1 === a.r2 && a.c1 === a.c2 ? addr(a.r1, a.c1) : `${addr(a.r1, a.c1)}:${addr(a.r2, a.c2)}`);
function parseRange(t: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d{1,5})(?:\s*:\s*\$?([A-Za-z]{1,3})\$?(\d{1,5}))?\s*$/.exec(t); if (!m) return null;
  const c1 = colIndex(m[1]), r1 = Number(m[2]) - 1, c2 = m[3] ? colIndex(m[3]) : c1, r2 = m[4] ? Number(m[4]) - 1 : r1;
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}
const moveKeys = (m: Y.Map<unknown>, axis: 'row' | 'col', at: number, delta: 1 | -1) => {
  const moves: Array<[string, string | null, unknown]> = [];
  m.forEach((v, k) => {
    const [r, c] = parseKey(k); const i = axis === 'row' ? r : c;
    if (delta === 1 && i >= at) moves.push([k, axis === 'row' ? cellKey(r + 1, c) : cellKey(r, c + 1), v]);
    if (delta === -1) { if (i === at) moves.push([k, null, v]); else if (i > at) moves.push([k, axis === 'row' ? cellKey(r - 1, c) : cellKey(r, c - 1), v]); }
  });
  for (const [k] of moves) m.delete(k);
  for (const [, to, v] of moves) if (to) m.set(to, v);
};

function Grid({ handle, me, peers, isMobile, docId, authToken, title, onToast }: { handle: CollabHandle; me: Peer; peers: Peer[]; isMobile: boolean; docId: string; authToken?: string; title: string; onToast: (m: string) => void }) {
  const ydoc = handle.ydoc;
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>({ r: 0, c: 0, r2: 0, c2: 0 });
  const [edit, setEditState] = useState<Edit>(null);
  const editRef = useRef<Edit>(null);   // always current, so keys typed before React re-renders are not lost
  const setEdit = (v: Edit) => { editRef.current = v; setEditState(v); };
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [box, setBox] = useState({ w: 800, h: 500 });
  const [bar, setBar] = useState<string | null>(null);       // formula bar text while it is focused
  const [tabMenu, setTabMenu] = useState<{ id: string; left: number; bottom: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filtersOn, setFiltersOn] = useState(false);
  const [filters, setFilters] = useState<Record<number, string[]>>({});     // column -> hidden values (this person only)
  const [filterMenu, setFilterMenu] = useState<{ c: number; q: string } | null>(null);
  const [find, setFind] = useState<{ q: string; rep: string; idx: number; replace: boolean } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; r: number; c: number; head?: 'col' | 'row' } | null>(null);
  const [dlg, setDlg] = useState<null | 'cond' | 'valid' | 'note' | 'chart'>(null);
  const [chartEdit, setChartEdit] = useState<ChartDef | null>(null);
  const [painter, setPainter] = useState<{ fmt: string; bold: boolean } | null>(null);
  const painterRef = useRef<typeof painter>(null); painterRef.current = painter;
  const [dd, setDd] = useState<{ r: number; c: number } | null>(null);
  const [fill, setFill] = useState<{ r: number; c: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const clip = useRef<Clip | null>(null);
  const fmtCache = useRef(new Map<string, CellFmt>());
  const undo = useMemo(() => new Y.UndoManager([tabsMap(ydoc), fmtMap(ydoc), validMap(ydoc), notesMap(ydoc), condList(ydoc), extMap(ydoc), mergeList(ydoc), chartList(ydoc)], { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 }), [ydoc]);
  useEffect(() => () => undo.destroy(), [undo]);

  // Re-render whenever anything in the sheet changes (mine or a teammate's).
  useEffect(() => {
    const on = () => bump();
    const shared = [tabsMap(ydoc), fmtMap(ydoc), validMap(ydoc), notesMap(ydoc), condList(ydoc), extMap(ydoc), mergeList(ydoc), chartList(ydoc)] as Array<Y.AbstractType<unknown>>;
    shared.forEach(t => t.observeDeep(on));
    return () => shared.forEach(t => t.unobserveDeep(on));
  }, [ydoc]);

  const tabs = useMemo(() => listTabs(ydoc), [ydoc, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tab: TabInfo | undefined = tabs.find(t => t.id === activeId) ?? tabs[0];
  const tabId = tab?.id ?? '';
  const rows = Math.min(MAX_ROWS, Number(tab?.map.get('rows') ?? 100));
  const ncols = Math.min(MAX_COLS, Number(tab?.map.get('ncols') ?? 12));
  const frozen = Math.min(rows, Number(tab?.map.get('frozen') ?? 0));
  const fc = Math.min(ncols - 1, Number(tab?.map.get('frozenCols') ?? 0));
  const widths = useMemo(() => {
    const w: number[] = [];
    for (let c = 0; c < ncols; c++) w.push(extMap(ydoc).get(`${tabId}|hc|${c}`) ? 0 : Math.max(MIN_W, Number(tab ? tCols(tab.map).get(String(c)) : 0) || DEF_W));
    return w;
  }, [tab, ncols, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const lefts = useMemo(() => { const l = [0]; widths.forEach((w, i) => l.push(l[i] + w)); return l; }, [widths]);
  const totalW = lefts[lefts.length - 1];
  const fcW = lefts[fc];

  const evaluator = useMemo(() => {
    const byName = new Map(tabs.map(t => [t.name, t.map]));
    return new Evaluator((tn, r, c) => (byName.get(tn ?? '')?.get('cells') as Y.Map<string> | undefined)?.get(cellKey(r, c)) ?? '', tab?.name ?? '');
  }, [tabs, tab?.name, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const raw = useCallback((r: number, c: number) => (tab ? tCells(tab.map).get(cellKey(r, c)) ?? '' : ''), [tab, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const fmtOf = (r: number, c: number): CellFmt => {
    const s = fmtMap(ydoc).get(mkey(tabId, r, c)); if (!s) return {};
    let f = fmtCache.current.get(s); if (!f) { try { f = JSON.parse(s) as CellFmt; } catch { f = {}; } fmtCache.current.set(s, f); }
    return f;
  };
  const rules = useMemo(() => condList(ydoc).toArray().map(s => { try { return JSON.parse(s) as CondRule; } catch { return null; } }).filter((x): x is CondRule => !!x && x.tab === tabId), [ydoc, tabId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (r: number, c: number) => formatVal(evaluator.value(null, r, c), fmtOf(r, c));

  // ── which rows are visible (hidden rows and filters), and how tall each one is (display index ↔ sheet row) ──
  const hdrRows = Math.max(frozen, 1);
  const filterKey = JSON.stringify(filters);
  const order = useMemo(() => {
    const hiddenSet = new Set<number>();
    extMap(ydoc).forEach((_v, k) => { if (k.startsWith(tabId + '|hr|')) hiddenSet.add(Number(k.slice(tabId.length + 4))); });
    const hidden = filtersOn ? Object.entries(filters).map(([c, v]) => [Number(c), new Set(v)] as [number, Set<string>]) : [];
    const out: number[] = [];
    for (let r = 0; r < rows; r++) {
      if (hiddenSet.has(r)) continue;
      if (r >= hdrRows && hidden.length && !hidden.every(([c, set]) => !set.has(formatVal(evaluator.value(null, r, c), fmtOf(r, c))))) continue;
      out.push(r);
    }
    return out.length ? out : [0];
  }, [filtersOn, filterKey, rows, evaluator, tabId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const posOf = useMemo(() => { const m = new Map<number, number>(); order.forEach((r, i) => m.set(r, i)); return m; }, [order]);
  const nRows = order.length;
  const rowAt = (i: number) => order[Math.max(0, Math.min(nRows - 1, i))];
  const idxOf = (r: number) => posOf.get(r) ?? -1;
  // wrapped text makes a row taller (an estimate from the text length and the column width); a person can also drag a row's height
  const wrapH = useMemo(() => {
    const m = new Map<number, number>();
    fmtMap(ydoc).forEach((sv, k) => {
      if (!k.startsWith(tabId + '|') || !sv.includes('"wr"')) return;
      const [r, c] = parseKey(k.slice(tabId.length + 1)); const w = Math.max(30, (widths[c] ?? DEF_W) - 14); if (!widths[c]) return;
      const txt = formatVal(evaluator.value(null, r, c), fmtOf(r, c));
      const lines = txt.split('\n').reduce((a, part) => a + Math.max(1, Math.ceil((part.length * 7.1) / w)), 0);
      m.set(r, Math.max(m.get(r) ?? 0, lines * 17 + 9));
    });
    return m;
  }, [ydoc, tabId, widths, evaluator, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const heights = useMemo(() => order.map(r => Math.max(Number(extMap(ydoc).get(`${tabId}|rh|${r}`)) || ROW_H, wrapH.get(r) ?? 0)), [order, wrapH, ydoc, tabId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tops = useMemo(() => { const t = [0]; heights.forEach((h, i) => t.push(t[i] + h)); return t; }, [heights]);
  const idxAtY = (y: number) => { let lo = 0, hi = nRows - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= y) lo = mid; else hi = mid - 1; } return lo; };
  const frozenH = tops[Math.min(frozen, nRows)];
  const bandOn = !!extMap(ydoc).get(`${tabId}|band`);
  const merges = useMemo(() => mergeList(ydoc).toArray().map(x => { try { return JSON.parse(x) as MergeRange; } catch { return null; } }).filter((x): x is MergeRange => !!x && x.tab === tabId), [ydoc, tabId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const mergeOf = useMemo(() => { const m = new Map<string, { a: MergeRange; anchor: boolean }>(); for (const a of merges) for (let r = a.r1; r <= a.r2; r++) for (let c = a.c1; c <= a.c2; c++) m.set(cellKey(r, c), { a, anchor: r === a.r1 && c === a.c1 }); return m; }, [merges]);
  const charts = useMemo(() => chartList(ydoc).toArray().map(x => { try { return JSON.parse(x) as ChartDef; } catch { return null; } }).filter((x): x is ChartDef => !!x && x.tab === tabId), [ydoc, tabId, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = body.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [tabId]);
  useEffect(() => { const el = body.current; if (el) { el.scrollTop = 0; el.scrollLeft = 0; } setScroll({ top: 0, left: 0 }); setFilters({}); setFilterMenu(null); setDd(null); }, [tabId]);
  useEffect(() => { handle.awareness.setLocalStateField('cell', { tab: tabId, r: sel.r, c: sel.c }); }, [handle, tabId, sel.r, sel.c]);

  // ── edits (every change is one transaction tagged LOCAL so Undo only undoes my own) ──
  const tx = useCallback((fn: () => void) => { ydoc.transact(fn, LOCAL); }, [ydoc]);
  const setCell = useCallback((r: number, c: number, text: string) => {
    if (!tab) return;
    tx(() => {
      const cells = tCells(tab.map), k = cellKey(r, c);
      if (text === '') cells.delete(k); else cells.set(k, text);
      if (r >= Number(tab.map.get('rows') ?? 100) - 1) tab.map.set('rows', Math.min(MAX_ROWS, r + 21));
      if (c >= Number(tab.map.get('ncols') ?? 12) - 1) tab.map.set('ncols', Math.min(MAX_COLS, c + 3));
    });
  }, [tab, tx]);

  const range = (s: Sel) => ({ r1: Math.min(s.r, s.r2), r2: Math.max(s.r, s.r2), c1: Math.min(s.c, s.c2), c2: Math.max(s.c, s.c2) });
  const R = range(sel);
  const forEachSel = (fn: (r: number, c: number) => void) => { for (let r = R.r1; r <= Math.min(R.r2, rows - 1); r++) for (let c = R.c1; c <= R.c2; c++) fn(r, c); };

  const clearRange = () => { if (!tab) return; tx(() => forEachSel((r, c) => tCells(tab.map).delete(cellKey(r, c)))); };
  const toggleBold = () => { if (!tab) return; const b = tBold(tab.map); const on = !b.get(cellKey(R.r1, R.c1)); tx(() => forEachSel((r, c) => { if (on) b.set(cellKey(r, c), true); else b.delete(cellKey(r, c)); })); };
  const applyFmt = (patch: { [K in keyof CellFmt]?: CellFmt[K] | null }) => { tx(() => forEachSel((r, c) => patchFmt(ydoc, tabId, r, c, patch))); };
  const toggleFmt = (k: 'i' | 'u' | 's') => { const on = !fmtOf(R.r1, R.c1)[k]; applyFmt({ [k]: on ? 1 : null }); };
  const selRef = useRef(sel); selRef.current = sel;
  const toggleWrap = () => applyFmt({ wr: fmtOf(R.r1, R.c1).wr ? null : 1 });
  const setBorders = (mode: 'all' | 'outer' | 'top' | 'bottom' | 'left' | 'right' | 'none') => {
    tx(() => forEachSel((r, c) => {
      const b = new Set((fmtOf(r, c).bd ?? '').split('').filter(Boolean));
      const edge: Record<string, boolean> = { t: r === R.r1, b: r === R.r2, l: c === R.c1, r: c === R.c2 };
      if (mode === 'none') b.clear();
      else if (mode === 'all') ['t', 'b', 'l', 'r'].forEach(x => b.add(x));
      else if (mode === 'outer') Object.entries(edge).forEach(([k, v]) => { if (v) b.add(k); });
      else { const k = mode === 'top' ? 't' : mode === 'bottom' ? 'b' : mode === 'left' ? 'l' : 'r'; if (edge[k]) b.add(k); }
      patchFmt(ydoc, tabId, r, c, { bd: b.size ? [...b].join('') : null });
    }));
  };
  const clearFormat = () => { if (!tab) return; tx(() => forEachSel((r, c) => { fmtMap(ydoc).delete(mkey(tabId, r, c)); tBold(tab.map).delete(cellKey(r, c)); })); };
  const startPainter = () => { setPainter({ fmt: fmtMap(ydoc).get(mkey(tabId, sel.r, sel.c)) ?? '', bold: !!(tab && tBold(tab.map).get(cellKey(sel.r, sel.c))) }); onToast('Paint format: now select the cells to format'); };
  const applyPainter = (pt: { fmt: string; bold: boolean }) => {
    if (!tab) return; const x = range(selRef.current);
    tx(() => { for (let r = x.r1; r <= Math.min(x.r2, rows - 1); r++) for (let c = x.c1; c <= x.c2; c++) { const k = mkey(tabId, r, c); if (pt.fmt) fmtMap(ydoc).set(k, pt.fmt); else fmtMap(ydoc).delete(k); if (pt.bold) tBold(tab.map).set(cellKey(r, c), true); else tBold(tab.map).delete(cellKey(r, c)); } });
  };
  const toggleMerge = () => {
    if (!tab) return;
    const overlapping = merges.filter(m => !(m.r2 < R.r1 || m.r1 > R.r2 || m.c2 < R.c1 || m.c1 > R.c2));
    tx(() => {
      const l = mergeList(ydoc);
      const keep = l.toArray().filter(x => { try { const m = JSON.parse(x) as MergeRange; return !(m.tab === tabId && !(m.r2 < R.r1 || m.r1 > R.r2 || m.c2 < R.c1 || m.c1 > R.c2)); } catch { return true; } });
      if (l.length) l.delete(0, l.length);
      l.push(keep);
      if (!overlapping.length && (R.r1 !== R.r2 || R.c1 !== R.c2)) {
        l.push([JSON.stringify({ tab: tabId, r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c2 } satisfies MergeRange)]);
        forEachSel((r, c) => { if (!(r === R.r1 && c === R.c1)) tCells(tab.map).delete(cellKey(r, c)); });
      }
    });
  };
  const hide = (axis: 'row' | 'col') => { tx(() => { if (axis === 'row') { for (let r = R.r1; r <= R.r2; r++) extMap(ydoc).set(`${tabId}|hr|${r}`, '1'); } else for (let c = R.c1; c <= R.c2; c++) extMap(ydoc).set(`${tabId}|hc|${c}`, '1'); }); };
  const hiddenCount = (() => { let n = 0; extMap(ydoc).forEach((_v, k) => { if (k.startsWith(tabId + '|hr|') || k.startsWith(tabId + '|hc|')) n++; }); return n; })();
  const unhideAll = () => tx(() => { [...extMap(ydoc).keys()].forEach(k => { if (k.startsWith(tabId + '|hr|') || k.startsWith(tabId + '|hc|')) extMap(ydoc).delete(k); }); });
  const toggleBand = () => tx(() => { const k = `${tabId}|band`; if (extMap(ydoc).get(k)) extMap(ydoc).delete(k); else extMap(ydoc).set(k, '1'); });
  const chartData = (d: ChartDef): ChartData => {
    const r0 = d.hdr && d.r2 > d.r1 ? d.r1 + 1 : d.r1; const labels: string[] = []; const cols = Math.max(1, d.c2 - d.c1);
    const names = Array.from({ length: cols }, (_, i) => (d.hdr && d.r2 > d.r1 ? shown(d.r1, d.c1 + (d.c2 > d.c1 ? i + 1 : 0)) : '') || (cols > 1 ? `Series ${i + 1}` : 'Value'));
    const series = names.map(name => ({ name, values: [] as number[] }));
    for (let r = r0; r <= d.r2; r++) {
      labels.push(d.c2 > d.c1 ? shown(r, d.c1) : String(r - r0 + 1));
      series.forEach((sr, i) => { const v = evaluator.value(null, r, d.c2 > d.c1 ? d.c1 + 1 + i : d.c1); sr.values.push(typeof v === 'number' ? v : Number(v) || 0); });
    }
    return { labels, series };
  };
  const saveChart = (v: { type: ChartDef['type']; title: string; range: string; hdr: boolean }, existing?: ChartDef | null): string | null => {
    const rg = parseRange(v.range); if (!rg) return 'Type a range like A1:C10';
    const def: ChartDef = existing ? { ...existing, type: v.type, title: v.title.slice(0, 80), hdr: v.hdr, ...rg } : { id: newId(), tab: tabId, type: v.type, title: v.title.slice(0, 80), hdr: v.hdr, ...rg, x: Math.round((lefts[rg.c2 + 1] ?? 0) + 30), y: Math.round(tops[Math.max(0, idxOf(rg.r1))] ?? 0), w: 460, h: 300 };
    tx(() => { const l = chartList(ydoc); const i = l.toArray().findIndex(x => { try { return (JSON.parse(x) as ChartDef).id === def.id; } catch { return false; } }); if (i >= 0) { l.delete(i, 1); l.insert(i, [JSON.stringify(def)]); } else l.push([JSON.stringify(def)]); });
    return null;
  };
  const patchChart = (d: ChartDef) => tx(() => { const l = chartList(ydoc); const i = l.toArray().findIndex(x => { try { return (JSON.parse(x) as ChartDef).id === d.id; } catch { return false; } }); if (i >= 0) { l.delete(i, 1); l.insert(i, [JSON.stringify(d)]); } });
  const deleteChart = (id: string) => tx(() => { const l = chartList(ydoc); const i = l.toArray().findIndex(x => { try { return (JSON.parse(x) as ChartDef).id === id; } catch { return false; } }); if (i >= 0) l.delete(i, 1); });
  const [chartTmp, setChartTmp] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const dragChart = (d: ChartDef, mode: 'move' | 'size', e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx0 = e.clientX, sy0 = e.clientY; let last = { x: d.x, y: d.y, w: d.w, h: d.h };
    const move = (ev: MouseEvent) => { const dx = ev.clientX - sx0, dy = ev.clientY - sy0; last = mode === 'move' ? { ...last, x: Math.max(0, d.x + dx), y: Math.max(0, d.y + dy) } : { ...last, w: Math.max(240, d.w + dx), h: Math.max(160, d.h + dy) }; setChartTmp(t => ({ ...t, [d.id]: last })); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); patchChart({ ...d, ...last }); setChartTmp(t => { const n = { ...t }; delete n[d.id]; return n; }); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const cur = fmtOf(sel.r, sel.c);
  const boldOn = !!(tab && tBold(tab.map).get(cellKey(sel.r, sel.c)));
  const setDecimals = (d: 1 | -1) => {
    const v = evaluator.value(null, sel.r, sel.c);
    const base = cur.dp ?? (cur.nf === 'pct' ? 0 : cur.nf === 'num' || cur.nf === 'cur' ? 2 : typeof v === 'number' ? (String(v).split('.')[1]?.length ?? 0) : 0);
    applyFmt({ dp: Math.max(0, Math.min(8, base + d)), ...(cur.nf ? {} : { nf: 'plain' as const }) });
  };

  // a display-index based cursor, so arrows skip rows a filter hides
  const step = (r: number, dir: number) => { const i = idxOf(r); return rowAt((i < 0 ? 0 : i) + dir); };
  const stepCol = (c: number, dir: number) => { let n = c + dir; while (n > 0 && n < ncols - 1 && !widths[n]) n += dir; return Math.max(0, Math.min(ncols - 1, n)); };
  const moveTo = (r: number, c: number, extend = false) => {
    const rr = Math.max(0, Math.min(MAX_ROWS - 1, r)), cc = Math.max(0, Math.min(MAX_COLS - 1, c));
    const next = extend ? { ...selRef.current, r2: rr, c2: cc } : { r: rr, c: cc, r2: rr, c2: cc };
    selRef.current = next; setSel(next);   // the ref moves at once so keys pressed in quick succession build on each other
    const el = body.current; if (!el) return;
    const i = Math.max(0, idxOf(rr));
    const top = tops[i], bottom = tops[i + 1], left = lefts[cc] ?? cc * DEF_W, right = left + (widths[cc] ?? DEF_W);
    if (i >= frozen && top < el.scrollTop + frozenH) el.scrollTop = top - frozenH;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    if (cc >= fc) { if (left < el.scrollLeft + fcW) el.scrollLeft = left - fcW; else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth; }
  };
  const startEdit = (r: number, c: number, text?: string) => { const v = getValid(ydoc, tabId, r, c); if (v?.t === 'check' && text === undefined) { toggleCheck(r, c); return; } setEdit({ r, c, text: text ?? raw(r, c) }); };
  const toggleCheck = (r: number, c: number) => { const on = /^true$/i.test(raw(r, c)); setCell(r, c, on ? 'FALSE' : 'TRUE'); };
  const commitEdit = (then?: 'down' | 'right' | 'stay') => {
    const e = editRef.current; if (!e) return;
    const { r, c, text } = e;
    setEdit(null);
    if (text !== raw(r, c)) setCell(r, c, text);
    if (then === 'down') moveTo(step(r, 1), c); else if (then === 'right') moveTo(r, c + 1);
    setTimeout(() => wrap.current?.focus(), 0);
  };

  // ── copy / cut / paste (formulas follow the move, formats come along) ──
  const grabCells = (s: Sel): ClipCell[][] => {
    const x = range(s); const out: ClipCell[][] = [];
    for (let r = x.r1; r <= x.r2; r++) { const row: ClipCell[] = []; for (let c = x.c1; c <= x.c2; c++) row.push({ raw: raw(r, c), fmt: fmtMap(ydoc).get(mkey(tabId, r, c)) ?? '', bold: !!(tab && tBold(tab.map).get(cellKey(r, c))), valid: validMap(ydoc).get(mkey(tabId, r, c)) ?? '' }); out.push(row); }
    return out;
  };
  const gridText = (cells: ClipCell[][]) => cells.map(row => row.map(x => (x.raw.startsWith('=') ? x.raw : x.raw)).join('\t')).join('\n');
  const doCopy = (cut: boolean): string => {
    const cells = grabCells(sel); const text = gridText(cells);
    clip.current = { text, r1: R.r1, c1: R.c1, cells };
    if (cut) clearRange();
    return text;
  };
  const paste = (text: string) => {
    if (!tab) return;
    const mine = clip.current && clip.current.text === text.replace(/\r\n?/g, '\n').replace(/\n$/, '') ? clip.current : null;
    const lines = (mine ? mine.cells.map(row => row.map(x => x.raw)) : text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(l => l.split('\t')));
    const dr = mine ? R.r1 - mine.r1 : 0, dc = mine ? R.c1 - mine.c1 : 0;
    tx(() => {
      lines.forEach((cols, i) => cols.forEach((v, j) => {
        const r = R.r1 + i, c = R.c1 + j; if (r >= MAX_ROWS || c >= MAX_COLS) return;
        const cells = tCells(tab.map), k = cellKey(r, c);
        const val = mine && v.startsWith('=') ? shiftFormula(v, dr, dc) : v;
        if (val === '') cells.delete(k); else cells.set(k, val);
        if (mine) {
          const src = mine.cells[i][j];
          if (src.fmt) fmtMap(ydoc).set(mkey(tabId, r, c), src.fmt); else fmtMap(ydoc).delete(mkey(tabId, r, c));
          if (src.valid) validMap(ydoc).set(mkey(tabId, r, c), src.valid); else validMap(ydoc).delete(mkey(tabId, r, c));
          if (src.bold) tBold(tab.map).set(k, true); else tBold(tab.map).delete(k);
        }
      }));
      const lastR = R.r1 + lines.length - 1, lastC = R.c1 + Math.max(...lines.map(l => l.length)) - 1;
      if (lastR >= Number(tab.map.get('rows') ?? 100) - 1) tab.map.set('rows', Math.min(MAX_ROWS, lastR + 21));
      if (lastC >= Number(tab.map.get('ncols') ?? 12) - 1) tab.map.set('ncols', Math.min(MAX_COLS, lastC + 3));
    });
    setSel({ r: R.r1, c: R.c1, r2: Math.min(MAX_ROWS - 1, R.r1 + lines.length - 1), c2: Math.min(MAX_COLS - 1, R.c1 + Math.max(...lines.map(l => l.length)) - 1) });
  };

  // ── autofill (drag the little square) and Ctrl+D / Ctrl+R ──
  const autofill = (src: { r1: number; c1: number; r2: number; c2: number }, to: { r: number; c: number }) => {
    if (!tab) return;
    const vertical = Math.abs(to.r - (to.r < src.r1 ? src.r1 : src.r2)) >= Math.abs(to.c - (to.c < src.c1 ? src.c1 : src.c2)) || (to.c >= src.c1 && to.c <= src.c2);
    const sh = src.r2 - src.r1 + 1, sw = src.c2 - src.c1 + 1;
    const fromR = vertical ? (to.r > src.r2 ? src.r2 + 1 : to.r < src.r1 ? to.r : src.r1) : src.r1, toR = vertical ? (to.r > src.r2 ? to.r : to.r < src.r1 ? src.r1 - 1 : src.r2) : src.r2;
    const fromC = !vertical ? (to.c > src.c2 ? src.c2 + 1 : to.c < src.c1 ? to.c : src.c1) : src.c1, toC = !vertical ? (to.c > src.c2 ? to.c : to.c < src.c1 ? src.c1 - 1 : src.c2) : src.c2;
    if (fromR > toR || fromC > toC || toR >= MAX_ROWS || toC >= MAX_COLS) return;
    tx(() => {
      const cells = tCells(tab.map), bold = tBold(tab.map);
      const series = (line: Array<{ r: number; c: number }>) => {                       // 1, 2 → 3, 4, 5 …
        const vals = line.map(p => raw(p.r, p.c));
        if (line.length < 2 || vals.some(v => v === '' || Number.isNaN(Number(v)))) return null;
        const n = vals.map(Number), d = n[1] - n[0];
        return n.slice(1).every((x, i) => Math.abs(x - n[i] - d) < 1e-9) ? d : null;
      };
      for (let r = fromR; r <= toR; r++) for (let c = fromC; c <= toC; c++) {
        const sr = vertical ? src.r1 + ((((r - src.r1) % sh) + sh) % sh) : r, sc = vertical ? c : src.c1 + ((((c - src.c1) % sw) + sw) % sw);
        const line = vertical ? Array.from({ length: sh }, (_, i) => ({ r: src.r1 + i, c })) : Array.from({ length: sw }, (_, i) => ({ r, c: src.c1 + i }));
        const step_ = series(line);
        let v = raw(sr, sc);
        if (step_ !== null && !v.startsWith('=')) { const base = vertical ? (r < src.r1 ? Number(raw(src.r1, c)) - step_ * (src.r1 - r) : Number(raw(src.r2, c)) + step_ * (r - src.r2)) : (c < src.c1 ? Number(raw(r, src.c1)) - step_ * (src.c1 - c) : Number(raw(r, src.c2)) + step_ * (c - src.c2)); v = String(Math.round(base * 1e9) / 1e9); }
        else if (v.startsWith('=')) v = shiftFormula(v, r - sr, c - sc);
        const k = cellKey(r, c); if (v === '') cells.delete(k); else cells.set(k, v);
        const f = fmtMap(ydoc).get(mkey(tabId, sr, sc)); if (f) fmtMap(ydoc).set(mkey(tabId, r, c), f); else fmtMap(ydoc).delete(mkey(tabId, r, c));
        const vr = validMap(ydoc).get(mkey(tabId, sr, sc)); if (vr) validMap(ydoc).set(mkey(tabId, r, c), vr); else validMap(ydoc).delete(mkey(tabId, r, c));
        if (bold.get(cellKey(sr, sc))) bold.set(k, true); else bold.delete(k);
      }
      if (toR >= Number(tab.map.get('rows') ?? 100) - 1) tab.map.set('rows', Math.min(MAX_ROWS, toR + 21));
    });
    setSel({ r: Math.min(src.r1, fromR), c: Math.min(src.c1, fromC), r2: Math.max(src.r2, toR), c2: Math.max(src.c2, toC) });
  };
  const fillDir = (dir: 'down' | 'right') => { if (dir === 'down') autofill({ r1: R.r1, c1: R.c1, r2: R.r1, c2: R.c2 }, { r: R.r2, c: R.c2 }); else autofill({ r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c1 }, { r: R.r2, c: R.c2 }); };

  // ── insert / delete / sort ──
  const shift = (axis: 'row' | 'col', at: number, delta: 1 | -1) => {
    if (!tab) return;
    tx(() => {
      moveKeys(tCells(tab.map) as Y.Map<unknown>, axis, at, delta); moveKeys(tBold(tab.map) as Y.Map<unknown>, axis, at, delta);
      shiftMeta(ydoc, tabId, axis, at, delta);
      for (const t of tabs) { const cm = tCells(t.map); cm.forEach((v, k) => { if (v.startsWith('=')) { const nv = adjustFormula(v, t.name, tab.name, axis, at, delta); if (nv !== v) cm.set(k, nv); } }); }
      if (axis === 'row') tab.map.set('rows', Math.min(MAX_ROWS, Math.max(30, rows + delta)));
      else tab.map.set('ncols', Math.min(MAX_COLS, Math.max(6, ncols + delta)));
    });
  };
  const insertMany = (axis: 'row' | 'col', at: number, n: number) => { for (let i = 0; i < n; i++) shift(axis, at, 1); };
  const deleteMany = (axis: 'row' | 'col', from: number, to: number) => { for (let i = to; i >= from; i--) shift(axis, i, -1); setSel(s => ({ ...s, r2: s.r, c2: s.c })); };

  const sortBy = (c: number, dir: 1 | -1) => {
    if (!tab) return;
    const head = filtersOn ? hdrRows : frozen;
    let last = -1; tCells(tab.map).forEach((v, k) => { if (v !== '') last = Math.max(last, parseKey(k)[0]); });
    const list: Array<{ r: number; key: string | number }> = [];
    for (let r = head; r <= last; r++) { const v = evaluator.value(null, r, c); list.push({ r, key: v instanceof SheetError ? String(v) : typeof v === 'number' ? v : (v ?? '') === '' ? '￿' : String(v).toLowerCase() }); }
    const blank = (x: { key: string | number }) => x.key === '￿';
    list.sort((a, b) => (blank(a) ? 1 : blank(b) ? -1 : (typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : String(a.key).localeCompare(String(b.key), undefined, { numeric: true })) * dir));
    tx(() => {
      const cells = tCells(tab.map), bold = tBold(tab.map);
      const snap = new Map<string, { v: string; b: boolean; f?: string; vr?: string; n?: string }>();
      for (const { r } of list) for (let cc = 0; cc < ncols; cc++) { const k = cellKey(r, cc); snap.set(k, { v: cells.get(k) ?? '', b: !!bold.get(k), f: fmtMap(ydoc).get(mkey(tabId, r, cc)), vr: validMap(ydoc).get(mkey(tabId, r, cc)), n: notesMap(ydoc).get(mkey(tabId, r, cc)) }); }
      list.forEach(({ r: from }, i) => {
        const to = head + i;
        for (let cc = 0; cc < ncols; cc++) {
          const s = snap.get(cellKey(from, cc))!, k = cellKey(to, cc);
          const val = s.v.startsWith('=') ? shiftFormula(s.v, to - from, 0) : s.v;
          if (val === '') cells.delete(k); else cells.set(k, val);
          if (s.b) bold.set(k, true); else bold.delete(k);
          for (const [m, x] of [[fmtMap(ydoc), s.f], [validMap(ydoc), s.vr], [notesMap(ydoc), s.n]] as Array<[Y.Map<string>, string | undefined]>) { if (x) m.set(mkey(tabId, to, cc), x); else m.delete(mkey(tabId, to, cc)); }
        }
      });
    });
  };

  // ── tabs ──
  const addTab = () => {
    const id = newId(); const name = `Sheet${tabs.length + 1}`;
    tx(() => { tabsMap(ydoc).set(id, newTabMap(name, (tabs[tabs.length - 1]?.order ?? 0) + 1)); });
    setActiveId(id); setSel({ r: 0, c: 0, r2: 0, c2: 0 });
  };
  const renameTab = (id: string, name: string) => {
    const t = tabs.find(x => x.id === id); const n = name.trim().slice(0, 60); if (!t || !n || n === t.name) return;
    if (tabs.some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) { onToast('Another tab already has that name'); return; }
    tx(() => { t.map.set('name', n); for (const x of tabs) { const cm = tCells(x.map); cm.forEach((v, k) => { if (v.startsWith('=')) { const nv = renameTabRefs(v, t.name, n); if (nv !== v) cm.set(k, nv); } }); } });
  };
  const deleteTab = (id: string) => { if (tabs.length < 2) { onToast('A spreadsheet needs at least one tab'); return; } if (!window.confirm('Delete this tab and everything on it?')) return; tx(() => tabsMap(ydoc).delete(id)); if (activeId === id) setActiveId(null); };
  const moveTab = (id: string, dir: -1 | 1) => { const i = tabs.findIndex(t => t.id === id), j = i + dir; if (i < 0 || j < 0 || j >= tabs.length) return; tx(() => { tabs.forEach((t, k) => t.map.set('order', k === i ? j : k === j ? i : k)); }); };
  const dupTab = (id: string) => {
    const t = tabs.find(x => x.id === id); if (!t) return;
    const nid = newId(), m = cloneTabMap(t.map); m.set('name', `${t.name} copy`.slice(0, 60)); m.set('order', (tabs[tabs.length - 1]?.order ?? 0) + 1); m.delete('feed');
    tx(() => { tabsMap(ydoc).set(nid, m); for (const mp of [fmtMap(ydoc), validMap(ydoc), notesMap(ydoc), extMap(ydoc)]) mp.forEach((v, k) => { if (k.startsWith(id + '|')) mp.set(nid + k.slice(id.length), v); });
      for (const l of [mergeList(ydoc), chartList(ydoc)]) { const add: string[] = []; l.forEach(x => { try { const o = JSON.parse(x) as { tab: string; id?: string }; if (o.tab === id) add.push(JSON.stringify({ ...o, tab: nid, ...(o.id ? { id: newId() } : {}) })); } catch { /* skip */ } }); if (add.length) l.push(add); } });
    setActiveId(nid);
  };

  // ── export ──
  const download = async (kind: 'csv' | 'xlsx') => {
    if (!tab) return;
    const base = (title || 'spreadsheet').replace(/[^\w\- ]+/g, '').trim() || 'spreadsheet';
    const textOf = (t: TabInfo) => { const ev = new Evaluator((tn, r, c) => (tabs.find(x => x.name === tn)?.map.get('cells') as Y.Map<string> | undefined)?.get(cellKey(r, c)) ?? '', t.name); return (r: number, c: number) => { const s = fmtMap(ydoc).get(mkey(t.id, r, c)); let f: CellFmt = {}; try { f = s ? JSON.parse(s) : {}; } catch { /* plain */ } return formatVal(ev.value(null, r, c), f); }; };
    try {
      if (kind === 'csv') {
        const csv = tabGrid(tab.map, textOf(tab)).map(r => r.map(csvEscape).join(',')).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `${base} - ${tab.name}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } else {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        for (const t of tabs) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tabGrid(t.map, textOf(t)).map(r => r.map(v => (v !== '' && !Number.isNaN(Number(v.replace(/,/g, ''))) && !/^0\d/.test(v) ? Number(v.replace(/,/g, '')) : v)))), t.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
        XLSX.writeFile(wb, `${base}.xlsx`);
      }
    } catch { onToast('Could not make that download'); }
  };

  // Feed tabs: ask the server for the latest CRM rows and write them into the shared sheet (everyone sees it live).
  const refreshFeed = useCallback(async (quiet = false) => {
    const feeds = listTabs(ydoc).map(t => t.map.get('feed')).filter((f): f is string => typeof f === 'string');
    if (!feeds.length) return;
    setRefreshing(true);
    try {
      const r = await fetch(`/api/crm/drive/sheet-feed/${docId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }, body: JSON.stringify({ feeds }) });
      const j = await r.json().catch(() => ({})) as { error?: string; message?: string; feeds?: FeedData[] };
      if (!r.ok || !j.feeds) throw new Error(j?.error || 'Could not refresh');
      tx(() => { for (const f of j.feeds!) { const t = listTabs(ydoc).find(x => x.map.get('feed') === f.feed); if (t) applyFeed(t.map, f); } });
      if (!quiet) onToast(j.message || 'Refreshed from the CRM');
    } catch (e) { if (!quiet) onToast((e as Error).message); }
    finally { setRefreshing(false); }
  }, [ydoc, docId, authToken, tx, onToast]);
  const feedTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => {
      const stale = listTabs(ydoc).some(x => x.map.get('feed') && Date.now() - Number(x.map.get('feedAt') ?? 0) > 60_000);
      if (stale) void refreshFeed(true);
    }, 1500);
    feedTimer.current = setInterval(() => { if (document.visibilityState === 'visible') void refreshFeed(true); }, 5 * 60_000);
    return () => { clearTimeout(t); clearInterval(feedTimer.current); };
  }, [ydoc, refreshFeed]);

  // ── find & replace ──
  const matches = useMemo(() => {
    if (!find || !find.q || !tab) return [] as Array<{ r: number; c: number }>;
    const q = find.q.toLowerCase(); const out: Array<{ r: number; c: number }> = [];
    tCells(tab.map).forEach((v, k) => { if (v === '') return; const [r, c] = parseKey(k); const t = v.startsWith('=') ? shown(r, c) + ' ' + v : v; if (t.toLowerCase().includes(q)) out.push({ r, c }); });
    return out.sort((a, b) => a.r - b.r || a.c - b.c);
  }, [find?.q, tab, version, evaluator]); // eslint-disable-line react-hooks/exhaustive-deps
  const matchSet = useMemo(() => new Set(matches.map(m => cellKey(m.r, m.c))), [matches]);
  const goMatch = (i: number) => { if (!matches.length) return; const k = ((i % matches.length) + matches.length) % matches.length; setFind(f => (f ? { ...f, idx: k } : f)); moveTo(matches[k].r, matches[k].c); };
  const replaceOne = () => { if (!find || !matches.length) return; const m = matches[find.idx % matches.length]; const v = raw(m.r, m.c); setCell(m.r, m.c, v.replace(new RegExp(find.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), find.rep)); };
  const replaceAll = () => { if (!find || !tab || !matches.length) return; const re = new RegExp(find.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); tx(() => { for (const m of matches) { const v = raw(m.r, m.c); tCells(tab.map).set(cellKey(m.r, m.c), v.replace(re, find.rep)); } }); onToast(`Replaced in ${matches.length} cell${matches.length === 1 ? '' : 's'}`); };

  // ── pointer + keyboard ──
  const cellAt = (clientX: number, clientY: number): { r: number; c: number } | null => {
    const el = body.current; if (!el) return null;
    const b = el.getBoundingClientRect();
    const x = clientX - b.left, y = clientY - b.top;
    if (x < 0 || y < 0) return null;
    const yy = y < frozenH ? y : y + el.scrollTop, xx = x < fcW ? x : x + el.scrollLeft;
    let c = 0; while (c < ncols - 1 && lefts[c + 1] <= xx) c++;
    return { r: rowAt(idxAtY(yy)), c };
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setCtx(null); setDd(null);
    if (edit) commitEdit('stay');
    let p = cellAt(e.clientX, e.clientY); if (!p) return;
    const mg0 = mergeOf.get(cellKey(p.r, p.c));
    if (mg0 && !e.shiftKey) { p = { r: mg0.a.r1, c: mg0.a.c1 }; setSel({ r: mg0.a.r1, c: mg0.a.c1, r2: mg0.a.r2, c2: mg0.a.c2 }); dragging.current = false; wrap.current?.focus(); const pt0 = painterRef.current; if (pt0) setTimeout(() => { applyPainter(pt0); setPainter(null); }, 0); return; }
    const v = getValid(ydoc, tabId, p.r, p.c);
    if (filtersOn && p.r === 0) {   // the little ▾ at the right of a header cell opens its filter
      const rect = body.current!.getBoundingClientRect(); const cx = (p.c < fc ? lefts[p.c + 1] : lefts[p.c + 1] - scroll.left) + rect.left;
      if (e.clientX > cx - 22) { setFilterMenu({ c: p.c, q: '' }); setSel({ r: p.r, c: p.c, r2: p.r, c2: p.c }); wrap.current?.focus(); return; }
    }
    if (v?.t === 'check' && !e.shiftKey) { toggleCheck(p.r, p.c); setSel({ r: p.r, c: p.c, r2: p.r, c2: p.c }); wrap.current?.focus(); return; }
    if (v?.t === 'list' && !e.shiftKey && sel.r === p.r && sel.c === p.c && sel.r2 === p.r && sel.c2 === p.c) { setDd({ r: p.r, c: p.c }); return; }
    if ((e.metaKey || e.ctrlKey) && LINK.test(shown(p.r, p.c))) { const t = shown(p.r, p.c); window.open(t.includes('@') && !/^https?:/.test(t) ? `mailto:${t}` : t, '_blank', 'noopener'); return; }
    if (e.shiftKey) setSel(s => ({ ...s, r2: p.r, c2: p.c })); else setSel({ r: p.r, c: p.c, r2: p.r, c2: p.c });
    dragging.current = true; wrap.current?.focus();
    const up = () => { dragging.current = false; window.removeEventListener('mouseup', up); const pt = painterRef.current; if (pt) setTimeout(() => { applyPainter(pt); setPainter(null); }, 0); };
    window.addEventListener('mouseup', up);
  };
  const onMouseMove = (e: React.MouseEvent) => { if (!dragging.current) return; const p = cellAt(e.clientX, e.clientY); if (p) setSel(s => (s.r2 === p.r && s.c2 === p.c ? s : { ...s, r2: p.r, c2: p.c })); };
  const onDouble = (e: React.MouseEvent) => { const p = cellAt(e.clientX, e.clientY); if (p && getValid(ydoc, tabId, p.r, p.c)?.t !== 'check') startEdit(p.r, p.c); };
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = cellAt(e.clientX, e.clientY); if (!p) return;
    const inside = p.r >= R.r1 && p.r <= R.r2 && p.c >= R.c1 && p.c <= R.c2;
    if (!inside) setSel({ r: p.r, c: p.c, r2: p.r, c2: p.c });
    setCtx({ x: e.clientX, y: e.clientY, r: p.r, c: p.c });
  };

  const beginFill = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const src = { ...R };
    const move = (ev: MouseEvent) => { const p = cellAt(ev.clientX, ev.clientY); if (p) setFill(p); };
    const up = (ev: MouseEvent) => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); const p = cellAt(ev.clientX, ev.clientY); setFill(null); if (p && (p.r > src.r2 || p.r < src.r1 || p.c > src.c2 || p.c < src.c1)) autofill(src, p); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const open = editRef.current;
    if (open) {
      // The edit box is mounted but not focused yet (very fast typing): keep the keys instead of dropping them.
      if (e.key === 'Enter') { e.preventDefault(); commitEdit('down'); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit('right'); }
      else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); }
      else if (e.key === 'Backspace') { e.preventDefault(); setEdit({ ...open, text: open.text.slice(0, -1) }); }
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setEdit({ ...open, text: open.text + e.key }); }
      return;
    }
    const S = selRef.current;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) undo.redo(); else undo.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); undo.redo(); return; }
    if (mod && k === 'b') { e.preventDefault(); toggleBold(); return; }
    if (mod && k === 'i') { e.preventDefault(); toggleFmt('i'); return; }
    if (mod && k === 'u') { e.preventDefault(); toggleFmt('u'); return; }
    if (mod && e.shiftKey && k === 'x') { e.preventDefault(); toggleFmt('s'); return; }
    if (mod && k === 'a') { e.preventDefault(); setSel({ r: 0, c: 0, r2: rows - 1, c2: ncols - 1 }); return; }
    if (mod && k === 'f') { e.preventDefault(); setFind(f => f ?? { q: '', rep: '', idx: 0, replace: false }); return; }
    if (mod && k === 'h') { e.preventDefault(); setFind(f => ({ q: f?.q ?? '', rep: f?.rep ?? '', idx: 0, replace: true })); return; }
    if (mod && k === 'd') { e.preventDefault(); fillDir('down'); return; }
    if (mod && k === 'r') { e.preventDefault(); fillDir('right'); return; }
    if (mod) return; // copy / cut / paste are handled by their own events
    const ext = e.shiftKey;
    const cr = ext ? S.r2 : S.r, cc = ext ? S.c2 : S.c;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveTo(step(cr, 1), cc, ext); return;
      case 'ArrowUp': e.preventDefault(); moveTo(step(cr, -1), cc, ext); return;
      case 'ArrowLeft': e.preventDefault(); moveTo(cr, stepCol(cc, -1), ext); return;
      case 'ArrowRight': e.preventDefault(); moveTo(cr, stepCol(cc, 1), ext); return;
      case 'Tab': e.preventDefault(); moveTo(S.r, stepCol(S.c, e.shiftKey ? -1 : 1)); return;
      case 'Enter': e.preventDefault(); startEdit(S.r, S.c); return;
      case 'F2': e.preventDefault(); startEdit(S.r, S.c); return;
      case ' ': if (getValid(ydoc, tabId, S.r, S.c)?.t === 'check') { e.preventDefault(); toggleCheck(S.r, S.c); return; } break;
      case 'Delete': case 'Backspace': e.preventDefault(); clearRange(); return;
      case 'Home': e.preventDefault(); moveTo(S.r, 0); return;
      case 'PageDown': e.preventDefault(); moveTo(step(S.r, 20), S.c); return;
      case 'PageUp': e.preventDefault(); moveTo(step(S.r, -20), S.c); return;
      case 'Escape': setSel(s => ({ ...s, r2: s.r, c2: s.c })); setFind(null); setCtx(null); return;
    }
    if (e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(S.r, S.c, e.key); }
  };

  // ── drawing ──
  const bold = tab ? tBold(tab.map) : null;
  const firstI = Math.max(Math.min(frozen, nRows), idxAtY(scroll.top) - 2);
  const lastI = Math.min(nRows - 1, idxAtY(scroll.top + box.h) + 2);
  const visI = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  let c0 = 0; while (c0 < ncols - 1 && lefts[c0 + 1] < scroll.left) c0++;
  let c1 = c0; while (c1 < ncols - 1 && lefts[c1] < scroll.left + box.w) c1++;
  const bodyCols = visI(Math.max(c0, fc), c1).filter(c => widths[c] > 0);
  const frozenCols = visI(0, fc - 1).filter(c => widths[c] > 0);
  const curMatch = find && matches.length ? matches[find.idx % matches.length] : null;

  const BD = '1px solid #374151';
  const paint = (i: number, c: number) => {
    const r = rowAt(i);
    const key = cellKey(r, c);
    const mg = mergeOf.get(key);
    if (mg && !mg.anchor) return null;                          // covered by a merged cell
    const f = fmtOf(r, c), v = evaluator.value(null, r, c);
    const valid = getValid(ydoc, tabId, r, c) as ValidRule | undefined;
    const note = notesMap(ydoc).get(mkey(tabId, r, c));
    const isCheck = valid?.t === 'check';
    const text = isCheck ? (v === true ? '☑' : '☐') : formatVal(v, f);
    let cbg: string | undefined, cfg: string | undefined, cb = false;
    for (const rule of rules) if (r >= rule.r1 && r <= rule.r2 && c >= rule.c1 && c <= rule.c2 && condMatch(v, rule.op as CondOp, rule.val)) { cbg = rule.bg ?? cbg; cfg = rule.fg ?? cfg; cb = cb || !!rule.b; }
    const inSel = r >= R.r1 && r <= R.r2 && c >= R.c1 && c <= R.c2 && !(r === sel.r && c === sel.c);
    const isNum = typeof v === 'number' && f.nf !== 'text';
    const al = f.al ?? (isCheck ? 'c' : isNum || (f.nf === 'date' && typeof v === 'number') ? 'r' : 'l');
    const link = !isCheck && typeof v === 'string' && LINK.test(v);
    const hit = matchSet.has(key);
    const isHdr = filtersOn && r === 0;
    const bgc = hit ? (curMatch && curMatch.r === r && curMatch.c === c ? '#ffd966' : '#fff2a8') : cbg ?? f.bg ?? (r < frozen ? 'var(--k-f9fafb)' : bandOn && r >= hdrRows && i % 2 === 0 ? 'var(--k-f9fafb)' : 'var(--k-fff)');
    const width = mg ? lefts[mg.a.c2 + 1] - lefts[mg.a.c1] : widths[c];
    const height = mg ? Math.max(heights[i], tops[Math.min(nRows, Math.max(i, idxOf(mg.a.r2) < 0 ? i : idxOf(mg.a.r2)) + 1)] - tops[i]) : heights[i];
    const bd = f.bd ?? '';
    const wrap_ = !!f.wr;
    return (
      <div key={key} title={note ? (JSON.parse(note) as NoteInfo).t : undefined} style={{
        position: 'absolute', top: tops[i], left: lefts[c], width, height, boxSizing: 'border-box', padding: wrap_ ? '4px 6px' : '0 6px', lineHeight: wrap_ ? '17px' : `${ROW_H - 1}px`, fontSize: 13,
        overflow: 'hidden', whiteSpace: wrap_ ? 'pre-wrap' : 'nowrap', wordBreak: wrap_ ? 'break-word' : undefined, textOverflow: wrap_ ? 'clip' : 'ellipsis', textAlign: al === 'r' ? 'right' : al === 'c' ? 'center' : 'left',
        fontWeight: bold?.get(key) || cb || r < frozen ? 700 : 400, fontStyle: f.i ? 'italic' : undefined, textDecoration: [f.u || link ? 'underline' : '', f.s ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
        color: v instanceof SheetError ? 'var(--k-dc2626)' : link ? '#1a56db' : cfg ?? f.fg ?? 'var(--k-1a1a1a)', cursor: link ? 'pointer' : undefined,
        borderRight: bd.includes('r') ? BD : '1px solid var(--k-e5e7eb)', borderBottom: bd.includes('b') ? BD : '1px solid var(--k-e5e7eb)', borderTop: bd.includes('t') ? BD : undefined, borderLeft: bd.includes('l') ? BD : undefined, background: bgc,
        backgroundImage: inSel ? 'linear-gradient(rgba(201,146,44,.16),rgba(201,146,44,.16))' : undefined, paddingRight: isHdr ? 22 : 6,
      }}>
        {text}
        {note && <span style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderLeft: '7px solid transparent', borderTop: '7px solid #dc2626' }} />}
        {isHdr && <span style={{ position: 'absolute', right: 4, top: 0, fontSize: 10, color: (filters[c]?.length ?? 0) ? '#a06a12' : 'var(--k-9ca3af)', fontWeight: 400 }}>{(filters[c]?.length ?? 0) ? '◆' : '▾'}</span>}
      </div>
    );
  };

  const sx = (c: number) => (c < fc ? lefts[c] : lefts[c] - scroll.left);
  const sy = (i: number) => (i < frozen ? tops[i] : tops[i] - scroll.top);
  const iA = Math.max(0, idxOf(R.r1)), iB = Math.max(0, idxOf(R.r2));
  const selBox = { top: sy(Math.min(iA, iB)), left: sx(R.c1), width: lefts[R.c2 + 1] - lefts[R.c1], height: tops[Math.max(iA, iB) + 1] - tops[Math.min(iA, iB)] };
  const act = { top: sy(Math.max(0, idxOf(sel.r))), left: sx(sel.c), w: widths[sel.c] ?? DEF_W };
  const peerBoxes = peers.filter(p => p.cell && p.cell.tab === tabId).map((p, i) => {
    const { r, c } = p.cell!; if (r >= rows || c >= ncols || idxOf(r) < 0) return null;
    return <div key={i} style={{ position: 'absolute', top: sy(idxOf(r)), left: sx(c), width: widths[c], height: heights[idxOf(r)], border: `2px solid ${p.color}`, boxSizing: 'border-box', pointerEvents: 'none', zIndex: 3 }}>
      <span style={{ position: 'absolute', top: -15, left: -2, background: p.color, color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3, whiteSpace: 'nowrap' }}>{p.name}</span>
    </div>;
  });

  const beginResize = (c: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = widths[c]; if (!tab) return;
    const move = (ev: MouseEvent) => { const w = Math.max(MIN_W, Math.round(startW + ev.clientX - startX)); tx(() => tCols(tab.map).set(String(c), w)); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const beginRowResize = (r: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startY = e.clientY, startH = heights[Math.max(0, idxOf(r))];
    const move = (ev: MouseEvent) => { const h = Math.max(18, Math.min(400, Math.round(startH + ev.clientY - startY))); tx(() => extMap(ydoc).set(`${tabId}|rh|${r}`, String(h))); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const autoFit = (c: number) => { if (!tab) return; let m = colName(c).length; for (let r = 0; r < Math.min(rows, 400); r++) m = Math.max(m, shown(r, c).length); tx(() => tCols(tab.map).set(String(c), Math.max(MIN_W, Math.min(520, Math.round(m * 7.4 + 22))))); };

  const activeRaw = edit ? edit.text : bar ?? raw(sel.r, sel.c);
  const hasFeed = tab ? !!tab.map.get('feed') : false;
  const tb: React.CSSProperties = { ...btnStyle(isMobile), height: isMobile ? 36 : 28, padding: '0 9px', fontSize: 13, minWidth: 30 };
  const on = (b: boolean): React.CSSProperties => ({ ...tb, background: b ? 'var(--k-fdf6e9)' : tb.background, color: b ? '#a06a12' : tb.color });
  const sep = <span style={{ width: 1, height: 20, background: 'var(--k-e5e7eb)', margin: '0 3px', flexShrink: 0 }} />;
  const selValid = getValid(ydoc, tabId, sel.r, sel.c);
  const selNote = getNote(ydoc, tabId, sel.r, sel.c);

  const stats = (() => {
    if (R.r1 === R.r2 && R.c1 === R.c2) return null;
    let n = 0, sum = 0, count = 0; let seen = 0;
    for (let r = R.r1; r <= Math.min(R.r2, rows - 1) && seen < 20000; r++) for (let c = R.c1; c <= R.c2 && seen < 20000; c++) { seen++; const v = evaluator.value(null, r, c); if (v !== null && v !== '') { count++; if (typeof v === 'number') { n++; sum += v; } } }
    return { n, sum, count };
  })();
  if (!tab) return <div style={{ padding: 28, color: 'var(--k-9ca3af)' }}>Opening…</div>;
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--k-fff)' }}>
      {/* toolbar */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '5px 10px', borderBottom: '1px solid var(--k-e5e7eb)', overflowX: 'auto', flexWrap: 'nowrap' }}>
        <button type="button" style={tb} onClick={() => undo.undo()} title="Undo (Ctrl+Z)">↶</button>
        <button type="button" style={tb} onClick={() => undo.redo()} title="Redo (Ctrl+Y)">↷</button>
        {sep}
        <Pop title="Number format" style={tb} label={<>{cur.nf === 'cur' ? '$' : cur.nf === 'pct' ? '%' : cur.nf === 'date' ? '📅' : cur.nf === 'num' ? '123' : cur.nf === 'text' ? 'Aa' : '123'} ▾</>}>
          {close => (<>
            {([[undefined, 'Automatic'], ['num', 'Number  1,234.56'], ['cur', 'Currency  $1,234.56'], ['pct', 'Percent  12%'], ['date', 'Date  10/14/2026'], ['text', 'Plain text']] as Array<[CellFmt['nf'], string]>).map(([nf, label]) => (
              <Item key={label} checked={(cur.nf ?? undefined) === nf} onClick={() => { applyFmt({ nf: nf ?? null, dp: null }); close(); }}>{label}</Item>
            ))}
          </>)}
        </Pop>
        <button type="button" style={tb} onClick={() => setDecimals(-1)} title="Fewer decimal places">.0←</button>
        <button type="button" style={tb} onClick={() => setDecimals(1)} title="More decimal places">.00→</button>
        {sep}
        <button type="button" style={{ ...on(boldOn), fontWeight: 800 }} onClick={toggleBold} title="Bold (Ctrl+B)">B</button>
        <button type="button" style={{ ...on(!!cur.i), fontStyle: 'italic' }} onClick={() => toggleFmt('i')} title="Italic (Ctrl+I)">I</button>
        <button type="button" style={{ ...on(!!cur.u), textDecoration: 'underline' }} onClick={() => toggleFmt('u')} title="Underline (Ctrl+U)">U</button>
        <button type="button" style={{ ...on(!!cur.s), textDecoration: 'line-through' }} onClick={() => toggleFmt('s')} title="Strikethrough (Ctrl+Shift+X)">S</button>
        <Pop title="Text color" style={tb} label={<span style={{ borderBottom: `3px solid ${cur.fg ?? '#000'}`, lineHeight: 1 }}>A</span>}>{close => <Palette onPick={c => { applyFmt({ fg: c }); close(); }} onClear={() => { applyFmt({ fg: null }); close(); }} clearLabel="Default text color" />}</Pop>
        <Pop title="Fill color" style={tb} label={<span style={{ display: 'inline-block', width: 14, height: 14, background: cur.bg ?? 'transparent', border: '1px solid #9ca3af', borderRadius: 3, verticalAlign: 'middle' }} />}>{close => <Palette onPick={c => { applyFmt({ bg: c }); close(); }} onClear={() => { applyFmt({ bg: null }); close(); }} clearLabel="No fill" />}</Pop>
        <Pop title="Align" style={tb} label={<>{cur.al === 'c' ? '≡' : cur.al === 'r' ? '☰' : '☷'} ▾</>}>
          {close => (<>{([['l', 'Left'], ['c', 'Center'], ['r', 'Right']] as Array<['l' | 'c' | 'r', string]>).map(([a, l]) => <Item key={a} checked={cur.al === a} onClick={() => { applyFmt({ al: a }); close(); }}>{l}</Item>)}<Item onClick={() => { applyFmt({ al: null }); close(); }}>Automatic</Item></>)}
        </Pop>
        <button type="button" style={on(!!cur.wr)} onClick={toggleWrap} title="Wrap text: show long text on several lines">↵ Wrap</button>
        <Pop title="Borders" style={tb} label={<>▦ ▾</>}>
          {close => (<>
            <Item onClick={() => { setBorders('all'); close(); }}>All borders</Item>
            <Item onClick={() => { setBorders('outer'); close(); }}>Outer border</Item>
            <Item onClick={() => { setBorders('top'); close(); }}>Top</Item>
            <Item onClick={() => { setBorders('bottom'); close(); }}>Bottom</Item>
            <Item onClick={() => { setBorders('left'); close(); }}>Left</Item>
            <Item onClick={() => { setBorders('right'); close(); }}>Right</Item>
            <Divider />
            <Item onClick={() => { setBorders('none'); close(); }}>No borders</Item>
          </>)}
        </Pop>
        <button type="button" style={on(merges.some(m => !(m.r2 < R.r1 || m.r1 > R.r2 || m.c2 < R.c1 || m.c1 > R.c2)))} onClick={toggleMerge} title="Merge the selected cells into one (click again to unmerge)">⊟ Merge</button>
        <button type="button" style={on(!!painter)} onClick={() => (painter ? setPainter(null) : startPainter())} title="Paint format: copy this cell's look, then select the cells to give it to">🖌</button>
        <button type="button" style={tb} onClick={clearFormat} title="Clear formatting on the selected cells">Tx✕</button>
        {sep}
        <Pop title="Freeze rows and columns" style={tb} label={<>❄ ▾</>} active={frozen > 0 || fc > 0}>
          {close => (<>
            <Item checked={frozen === 0} onClick={() => { tx(() => tab.map.set('frozen', 0)); close(); }}>No frozen rows</Item>
            <Item checked={frozen === 1} onClick={() => { tx(() => tab.map.set('frozen', 1)); close(); }}>1 row</Item>
            <Item checked={frozen === 2} onClick={() => { tx(() => tab.map.set('frozen', 2)); close(); }}>2 rows</Item>
            <Item onClick={() => { tx(() => tab.map.set('frozen', sel.r + 1)); close(); }}>Up to row {sel.r + 1}</Item>
            <Divider />
            <Item checked={fc === 0} onClick={() => { tx(() => tab.map.set('frozenCols', 0)); close(); }}>No frozen columns</Item>
            <Item checked={fc === 1} onClick={() => { tx(() => tab.map.set('frozenCols', 1)); close(); }}>1 column</Item>
            <Item checked={fc === 2} onClick={() => { tx(() => tab.map.set('frozenCols', 2)); close(); }}>2 columns</Item>
            <Item onClick={() => { tx(() => tab.map.set('frozenCols', sel.c + 1)); close(); }}>Up to column {colName(sel.c)}</Item>
          </>)}
        </Pop>
        <button type="button" style={on(filtersOn)} onClick={() => { setFiltersOn(o => !o); setFilters({}); }} title="Filter: add a ▾ to the header row and hide rows by value">⏷ Filter</button>
        <Pop title="Sort" style={tb} label={<>A↓Z ▾</>}>
          {close => (<><Item onClick={() => { sortBy(sel.c, 1); close(); }}>Sort sheet by {colName(sel.c)}, A → Z</Item><Item onClick={() => { sortBy(sel.c, -1); close(); }}>Sort sheet by {colName(sel.c)}, Z → A</Item></>)}
        </Pop>
        {sep}
        <Pop title="Insert or delete rows and columns" style={tb} label={<>＋ ▾</>}>
          {close => (<>
            <Item onClick={() => { insertMany('row', R.r1, R.r2 - R.r1 + 1); close(); }}>Insert row above</Item>
            <Item onClick={() => { insertMany('row', R.r2 + 1, R.r2 - R.r1 + 1); close(); }}>Insert row below</Item>
            <Item onClick={() => { insertMany('col', R.c1, R.c2 - R.c1 + 1); close(); }}>Insert column left</Item>
            <Item onClick={() => { insertMany('col', R.c2 + 1, R.c2 - R.c1 + 1); close(); }}>Insert column right</Item>
            <Divider />
            <Item danger onClick={() => { deleteMany('row', R.r1, R.r2); close(); }}>Delete row{R.r2 > R.r1 ? 's' : ''}</Item>
            <Item danger onClick={() => { deleteMany('col', R.c1, R.c2); close(); }}>Delete column{R.c2 > R.c1 ? 's' : ''}</Item>
          </>)}
        </Pop>
        <button type="button" style={on(!!find)} onClick={() => setFind(f => (f ? null : { q: '', rep: '', idx: 0, replace: false }))} title="Find and replace (Ctrl+F)">🔍</button>
        <button type="button" style={tb} onClick={() => { setChartEdit(null); setDlg('chart'); }} title="Insert a chart from the selected cells">📊</button>
        <Pop title="Dropdowns, checkboxes, notes and rules" style={tb} label={<>Data ▾</>}>
          {close => (<>
            <Item checked={bandOn} onClick={() => { toggleBand(); close(); }}>Alternating row colors</Item>
            <Item onClick={() => { hide('row'); close(); }}>Hide row{R.r2 > R.r1 ? 's' : ''} {R.r1 + 1}{R.r2 > R.r1 ? `–${R.r2 + 1}` : ''}</Item>
            <Item onClick={() => { hide('col'); close(); }}>Hide column{R.c2 > R.c1 ? 's' : ''} {colName(R.c1)}{R.c2 > R.c1 ? `–${colName(R.c2)}` : ''}</Item>
            <Item disabled={!hiddenCount} onClick={() => { unhideAll(); close(); }}>Show hidden rows and columns{hiddenCount ? ` (${hiddenCount})` : ''}</Item>
            <Divider />
            <Item onClick={() => { setDlg('valid'); close(); }}>Dropdown / checkbox…</Item>
            <Item onClick={() => { setDlg('cond'); close(); }}>Conditional formatting…</Item>
            <Item onClick={() => { setDlg('note'); close(); }}>{selNote ? 'Edit note…' : 'Add a note…'}</Item>
          </>)}
        </Pop>
        <span style={{ flex: 1 }} />
        {hasFeed && <button type="button" style={{ ...tb, color: '#a06a12', background: 'var(--k-fdf6e9)', whiteSpace: 'nowrap' }} disabled={refreshing} onClick={() => void refreshFeed(false)} title="Pull the latest from the CRM into the live columns">{refreshing ? 'Refreshing…' : '↻ Refresh from CRM'}</button>}
        <Pop title="Download" style={{ ...tb, whiteSpace: 'nowrap' }} label={<>⬇ ▾</>} align="right">
          {close => (<><Item onClick={() => { void download('csv'); close(); }}>This tab as CSV</Item><Item onClick={() => { void download('xlsx'); close(); }}>Whole spreadsheet as Excel (.xlsx)</Item></>)}
        </Pop>
      </div>
      {/* formula bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderBottom: '1px solid var(--k-e5e7eb)' }}>
        <div style={{ minWidth: 64, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: 'var(--k-6b7280)', border: '1px solid var(--k-e5e7eb)', borderRadius: 6, padding: '4px 6px', whiteSpace: 'nowrap' }}>{rangeLabel({ r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c2 })}</div>
        <span style={{ color: 'var(--k-9ca3af)', fontStyle: 'italic', fontSize: 13 }}>fx</span>
        <input value={activeRaw} aria-label="Cell contents"
          onFocus={() => setBar(raw(sel.r, sel.c))}
          onChange={e => { if (edit) setEdit({ ...edit, text: e.target.value }); else setBar(e.target.value); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const t = edit ? edit.text : bar ?? ''; if (edit) setEdit(null); setBar(null); setCell(sel.r, sel.c, t); wrap.current?.focus(); } else if (e.key === 'Escape') { setBar(null); setEdit(null); wrap.current?.focus(); } }}
          onBlur={() => { if (bar !== null && bar !== raw(sel.r, sel.c)) setCell(sel.r, sel.c, bar); setBar(null); }}
          style={{ flex: 1, minWidth: 0, border: '1px solid var(--k-e5e7eb)', borderRadius: 6, padding: '4px 8px', fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)' }} />
      </div>
      {find && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderBottom: '1px solid var(--k-e5e7eb)', background: 'var(--k-f9fafb)', flexWrap: 'wrap' }}>
          <input autoFocus value={find.q} placeholder="Find" onChange={e => setFind({ ...find, q: e.target.value, idx: 0 })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goMatch(find.idx + (e.shiftKey ? -1 : 1)); } else if (e.key === 'Escape') setFind(null); }} style={{ height: 28, border: '1px solid var(--k-d1d5db)', borderRadius: 6, padding: '0 8px', fontSize: 13, width: 160 }} />
          <span style={{ fontSize: 12, color: 'var(--k-6b7280)', minWidth: 54 }}>{find.q ? (matches.length ? `${(find.idx % matches.length) + 1} of ${matches.length}` : 'No match') : ''}</span>
          <button type="button" style={tb} onClick={() => goMatch(find.idx - 1)} aria-label="Previous match">↑</button>
          <button type="button" style={tb} onClick={() => goMatch(find.idx + 1)} aria-label="Next match">↓</button>
          {find.replace ? (<>
            <input value={find.rep} placeholder="Replace with" onChange={e => setFind({ ...find, rep: e.target.value })} style={{ height: 28, border: '1px solid var(--k-d1d5db)', borderRadius: 6, padding: '0 8px', fontSize: 13, width: 160 }} />
            <button type="button" style={tb} onClick={replaceOne}>Replace</button>
            <button type="button" style={tb} onClick={replaceAll}>Replace all</button>
          </>) : <button type="button" style={tb} onClick={() => setFind({ ...find, replace: true })}>Replace…</button>}
          <button type="button" style={tb} onClick={() => setFind(null)} aria-label="Close find">✕</button>
        </div>
      )}
      {/* grid */}
      <div ref={wrap} tabIndex={0} onKeyDown={onKeyDown} onContextMenu={onContext} style={{ flex: 1, minHeight: 0, position: 'relative', outline: 'none', userSelect: 'none', overflow: 'hidden' }}
        onCopy={e => { if (edit || bar !== null) return; e.preventDefault(); e.clipboardData.setData('text/plain', doCopy(false)); }}
        onCut={e => { if (edit || bar !== null) return; e.preventDefault(); e.clipboardData.setData('text/plain', doCopy(true)); }}
        onPaste={e => { if (edit || bar !== null) return; e.preventDefault(); paste(e.clipboardData.getData('text/plain')); }}>
        {/* corner + column letters */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: NUM_W, height: HEAD_H, background: 'var(--k-f3f4f6)', borderRight: '1px solid var(--k-d1d5db)', borderBottom: '1px solid var(--k-d1d5db)', zIndex: 6, boxSizing: 'border-box' }} onClick={() => setSel({ r: 0, c: 0, r2: rows - 1, c2: ncols - 1 })} />
        {(() => {
          const head = (c: number) => (
            <div key={c} onClick={e => { setSel(e.shiftKey ? { ...sel, c2: c } : { r: 0, c, r2: rows - 1, c2: c }); wrap.current?.focus(); }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (!(c >= R.c1 && c <= R.c2)) setSel({ r: 0, c, r2: rows - 1, c2: c }); setCtx({ x: e.clientX, y: e.clientY, r: 0, c, head: 'col' }); }}
              style={{ position: 'absolute', left: lefts[c], width: widths[c], height: HEAD_H, lineHeight: `${HEAD_H}px`, textAlign: 'center', fontSize: 12, fontWeight: 600, color: c >= R.c1 && c <= R.c2 ? '#a06a12' : 'var(--k-6b7280)', background: c >= R.c1 && c <= R.c2 ? 'var(--k-fdf6e9)' : 'var(--k-f3f4f6)', borderRight: '1px solid var(--k-d1d5db)', boxSizing: 'border-box', cursor: 'pointer' }}>
              {colName(c)}
              <span onMouseDown={e => beginResize(c, e)} onDoubleClick={e => { e.stopPropagation(); autoFit(c); }} title="Drag to resize, double-click to fit" style={{ position: 'absolute', right: -3, top: 0, width: 7, height: HEAD_H, cursor: 'col-resize', zIndex: 2 }} />
            </div>
          );
          return (<>
            <div style={{ position: 'absolute', top: 0, left: NUM_W, right: 0, height: HEAD_H, overflow: 'hidden', zIndex: 4, background: 'var(--k-f3f4f6)', borderBottom: '1px solid var(--k-d1d5db)', boxSizing: 'border-box' }}>
              <div style={{ position: 'relative', width: totalW, height: HEAD_H, transform: `translateX(${-scroll.left}px)` }}>{bodyCols.map(head)}</div>
            </div>
            {fc > 0 && <div style={{ position: 'absolute', top: 0, left: NUM_W, width: fcW, height: HEAD_H, overflow: 'hidden', zIndex: 5, background: 'var(--k-f3f4f6)', borderBottom: '1px solid var(--k-d1d5db)', borderRight: '2px solid var(--k-d1d5db)', boxSizing: 'content-box' }}><div style={{ position: 'relative', width: fcW, height: HEAD_H }}>{frozenCols.map(head)}</div></div>}
          </>);
        })()}
        {/* row numbers */}
        <div style={{ position: 'absolute', top: HEAD_H, left: 0, width: NUM_W, bottom: 0, overflow: 'hidden', zIndex: 4, background: 'var(--k-f3f4f6)', borderRight: '1px solid var(--k-d1d5db)', boxSizing: 'border-box' }}>
          <div style={{ position: 'relative', height: tops[nRows], transform: `translateY(${-scroll.top}px)` }}>
            {visI(firstI, lastI).map(i => { const r = rowAt(i); const inS = r >= R.r1 && r <= R.r2; return (
              <div key={r} onClick={e => { setSel(e.shiftKey ? { ...sel, r2: r } : { r, c: 0, r2: r, c2: ncols - 1 }); wrap.current?.focus(); }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (!inS) setSel({ r, c: 0, r2: r, c2: ncols - 1 }); setCtx({ x: e.clientX, y: e.clientY, r, c: 0, head: 'row' }); }}
                style={{ position: 'absolute', top: tops[i], height: heights[i], width: NUM_W, lineHeight: `${Math.min(heights[i], ROW_H)}px`, textAlign: 'center', fontSize: 11.5, color: inS ? '#a06a12' : 'var(--k-9ca3af)', background: inS ? 'var(--k-fdf6e9)' : undefined, borderBottom: '1px solid var(--k-d1d5db)', boxSizing: 'border-box', cursor: 'pointer' }}>{r + 1}
                <span onMouseDown={e => beginRowResize(r, e)} onDoubleClick={e => { e.stopPropagation(); tx(() => extMap(ydoc).delete(`${tabId}|rh|${r}`)); }} title="Drag to change the row height, double-click to reset" style={{ position: 'absolute', left: 0, right: 0, bottom: -3, height: 7, cursor: 'row-resize', zIndex: 2 }} />
              </div>); })}
          </div>
          {frozen > 0 && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: NUM_W, height: frozenH, background: 'var(--k-f3f4f6)', zIndex: 2 }}>
              {visI(0, Math.min(frozen, nRows) - 1).map(i => <div key={i} style={{ position: 'absolute', top: tops[i], height: heights[i], width: NUM_W, lineHeight: `${Math.min(heights[i], ROW_H)}px`, textAlign: 'center', fontSize: 11.5, color: 'var(--k-9ca3af)', borderBottom: i === frozen - 1 ? '2px solid var(--k-d1d5db)' : '1px solid var(--k-d1d5db)', boxSizing: 'border-box' }}>{rowAt(i) + 1}</div>)}
            </div>
          )}
        </div>
        {/* cells */}
        <div ref={body} onScroll={e => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onDoubleClick={onDouble}
          style={{ position: 'absolute', top: HEAD_H, left: NUM_W, right: 0, bottom: 0, overflow: 'auto' }}>
          <div style={{ position: 'relative', width: totalW, height: tops[nRows] }}>
            {visI(firstI, lastI).flatMap(i => visI(c0, c1).filter(c => widths[c] > 0).map(c => paint(i, c)))}
            {charts.map(d => {
              const g = chartTmp[d.id] ?? { x: d.x, y: d.y, w: d.w, h: d.h };
              return (
                <div key={d.id} onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}
                  style={{ position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h, background: 'var(--k-fff)', border: '1px solid var(--k-d1d5db)', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.16)', zIndex: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
                  <div onMouseDown={e => dragChart(d, 'move', e)} style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', background: 'var(--k-f9fafb)', borderBottom: '1px solid var(--k-e5e7eb)', cursor: 'move', gap: 6 }}>
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: 'var(--k-374151)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || 'Chart'}</span>
                    <button type="button" onMouseDown={e => e.stopPropagation()} onClick={() => { setChartEdit(d); setDlg('chart'); }} aria-label="Edit chart" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13 }}>✎</button>
                    <button type="button" onMouseDown={e => e.stopPropagation()} onClick={() => deleteChart(d.id)} aria-label="Delete chart" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--k-dc2626)' }}>✕</button>
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}><ChartSvg type={d.type} data={chartData(d)} w={g.w - 2} h={g.h - 32} /></div>
                  <span onMouseDown={e => dragChart(d, 'size', e)} style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, #9ca3af 50%)' }} />
                </div>
              );
            })}
          </div>
        </div>
        {frozen > 0 && (
          <div style={{ position: 'absolute', top: HEAD_H, left: NUM_W, right: 0, height: frozenH, overflow: 'hidden', zIndex: 2, pointerEvents: 'none', borderBottom: '2px solid var(--k-d1d5db)', boxSizing: 'content-box', background: 'var(--k-fff)' }}>
            <div style={{ position: 'relative', width: totalW, height: frozenH, transform: `translateX(${-scroll.left}px)` }}>
              {visI(0, Math.min(frozen, nRows) - 1).flatMap(i => bodyCols.map(c => paint(i, c)))}
            </div>
          </div>
        )}
        {fc > 0 && (
          <div style={{ position: 'absolute', top: HEAD_H + frozenH, left: NUM_W, width: fcW, bottom: 0, overflow: 'hidden', zIndex: 3, pointerEvents: 'none', borderRight: '2px solid var(--k-d1d5db)', boxSizing: 'content-box', background: 'var(--k-fff)' }}>
            <div style={{ position: 'relative', width: fcW, height: tops[nRows], transform: `translateY(${-scroll.top - frozenH}px)` }}>
              {visI(firstI, lastI).flatMap(i => frozenCols.map(c => paint(i, c)))}
            </div>
          </div>
        )}
        {fc > 0 && frozen > 0 && (
          <div style={{ position: 'absolute', top: HEAD_H, left: NUM_W, width: fcW, height: frozenH, overflow: 'hidden', zIndex: 4, pointerEvents: 'none', borderRight: '2px solid var(--k-d1d5db)', borderBottom: '2px solid var(--k-d1d5db)', boxSizing: 'content-box', background: 'var(--k-fff)' }}>
            <div style={{ position: 'relative', width: fcW, height: frozenH }}>{visI(0, Math.min(frozen, nRows) - 1).flatMap(i => frozenCols.map(c => paint(i, c)))}</div>
          </div>
        )}
        {/* selection frame, peers, editor, dropdowns */}
        <div style={{ position: 'absolute', top: HEAD_H, left: NUM_W, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }}>
          <div style={{ position: 'absolute', ...selBox, border: '2px solid #c9922c', boxSizing: 'border-box', pointerEvents: 'none' }}>
            {!edit && <span onMouseDown={beginFill} title="Drag to fill" style={{ position: 'absolute', right: -5, bottom: -5, width: 9, height: 9, background: '#c9922c', border: '1px solid #fff', pointerEvents: 'auto', cursor: 'crosshair' }} />}
          </div>
          {fill && <div style={{ position: 'absolute', top: sy(Math.max(0, idxOf(Math.min(R.r1, fill.r)))), left: sx(Math.min(R.c1, fill.c)), width: lefts[Math.max(R.c2, fill.c) + 1] - lefts[Math.min(R.c1, fill.c)], height: tops[Math.max(0, idxOf(Math.max(R.r2, fill.r))) + 1] - tops[Math.max(0, idxOf(Math.min(R.r1, fill.r)))], border: '2px dashed #c9922c', boxSizing: 'border-box' }} />}
          {peerBoxes}
          {selValid?.t === 'list' && !edit && <button type="button" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDd({ r: sel.r, c: sel.c }); }} aria-label="Choose from the list" style={{ position: 'absolute', top: act.top + 3, left: act.left + act.w - 24, width: 20, height: 20, border: 'none', borderRadius: 4, background: 'rgba(201,146,44,.18)', color: '#a06a12', fontSize: 11, cursor: 'pointer', pointerEvents: 'auto', padding: 0 }}>▾</button>}
          {dd && (() => { const v = getValid(ydoc, tabId, dd.r, dd.c); const i = Math.max(0, idxOf(dd.r)); return v?.t === 'list' ? (
            <>
              <div onMouseDown={() => setDd(null)} style={{ position: 'fixed', inset: 0, pointerEvents: 'auto', zIndex: 8 }} />
              <div role="listbox" style={{ position: 'absolute', top: sy(i) + heights[i], left: sx(dd.c), minWidth: Math.max(widths[dd.c], 160), maxHeight: 240, overflowY: 'auto', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 8, boxShadow: '0 12px 36px rgba(0,0,0,.2)', padding: 4, pointerEvents: 'auto', zIndex: 9 }}>
                {(v.o ?? []).map(o => <button key={o} type="button" role="option" aria-selected={raw(dd.r, dd.c) === o} onMouseDown={e => { e.preventDefault(); setCell(dd.r, dd.c, o); setDd(null); wrap.current?.focus(); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: raw(dd.r, dd.c) === o ? 'var(--k-fdf6e9)' : 'none', borderRadius: 5, cursor: 'pointer', fontSize: 13.5, fontFamily: "'DM Sans',sans-serif", color: 'var(--k-1a1a1a)' }}>{o}</button>)}
                <button type="button" onMouseDown={e => { e.preventDefault(); setCell(dd.r, dd.c, ''); setDd(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12.5, color: 'var(--k-9ca3af)', fontFamily: "'DM Sans',sans-serif" }}>Clear</button>
              </div>
            </>) : null; })()}
          {edit && (
            <input ref={el => { editor.current = el; if (el && document.activeElement !== el) { el.focus(); const n = el.value.length; el.setSelectionRange(n, n); } }} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} aria-label="Edit cell"
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit('down'); }
                else if (e.key === 'Tab') { e.preventDefault(); commitEdit('right'); }
                else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); wrap.current?.focus(); }
                e.stopPropagation();
              }}
              onBlur={() => { if (editor.current && document.activeElement?.getAttribute('aria-label') === 'Cell contents') return; commitEdit('stay'); }}
              style={{ position: 'absolute', pointerEvents: 'auto', top: sy(Math.max(0, idxOf(edit.r))), left: sx(edit.c), width: Math.max(widths[edit.c], 140), height: Math.max(ROW_H, heights[Math.max(0, idxOf(edit.r))]), boxSizing: 'border-box', border: '2px solid #c9922c', outline: 'none', padding: '0 5px', fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)', zIndex: 6, userSelect: 'text' }} />
          )}
        </div>
      </div>
      {/* filter menu */}
      {filterMenu && (() => {
        const c = filterMenu.c; const vals = new Map<string, number>();
        for (let r = hdrRows; r < rows; r++) { const t = formatVal(evaluator.value(null, r, c), fmtOf(r, c)); vals.set(t, (vals.get(t) ?? 0) + 1); }
        const list = [...vals.entries()].filter(([t]) => t.toLowerCase().includes(filterMenu.q.toLowerCase())).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).slice(0, 300);
        const hidden = new Set(filters[c] ?? []);
        const setHidden = (s: Set<string>) => setFilters(f => { const n = { ...f }; if (s.size) n[c] = [...s]; else delete n[c]; return n; });
        return (
          <>
            <div onMouseDown={() => setFilterMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 1300 }} />
            <div role="dialog" aria-label="Filter" style={{ position: 'fixed', top: 150, left: Math.max(12, Math.min(window.innerWidth - 270, (body.current?.getBoundingClientRect().left ?? 0) + sx(c))), zIndex: 1301, width: 260, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.22)', padding: 10 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button type="button" style={tb} onClick={() => { sortBy(c, 1); setFilterMenu(null); }}>Sort A→Z</button>
                <button type="button" style={tb} onClick={() => { sortBy(c, -1); setFilterMenu(null); }}>Z→A</button>
              </div>
              <input autoFocus value={filterMenu.q} onChange={e => setFilterMenu({ c, q: e.target.value })} placeholder="Search values" style={{ width: '100%', height: 30, border: '1px solid var(--k-d1d5db)', borderRadius: 6, padding: '0 8px', fontSize: 13, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 10, margin: '6px 0', fontSize: 12.5 }}>
                <button type="button" onClick={() => setHidden(new Set())} style={{ border: 'none', background: 'none', color: '#a06a12', cursor: 'pointer', padding: 0 }}>Select all</button>
                <button type="button" onClick={() => setHidden(new Set([...hidden, ...list.map(x => x[0])]))} style={{ border: 'none', background: 'none', color: '#a06a12', cursor: 'pointer', padding: 0 }}>Clear</button>
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {list.map(([t, n]) => (
                  <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!hidden.has(t)} onChange={e => { const s = new Set(hidden); if (e.target.checked) s.delete(t); else s.add(t); setHidden(s); }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t === '' ? '(blank)' : t}</span><span style={{ color: 'var(--k-9ca3af)', fontSize: 11.5 }}>{n}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...tb, background: '#c9922c', color: '#fff', border: 'none' }} onClick={() => setFilterMenu(null)}>Done</button></div>
            </div>
          </>
        );
      })()}
      {/* right-click menu */}
      {ctx && (
        <>
          <div onMouseDown={() => setCtx(null)} onContextMenu={e => { e.preventDefault(); setCtx(null); }} style={{ position: 'fixed', inset: 0, zIndex: 1300 }} />
          <div role="menu" style={{ position: 'fixed', top: Math.max(8, Math.min(ctx.y, window.innerHeight - 500)), left: Math.min(ctx.x, window.innerWidth - 230), maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', zIndex: 1301, minWidth: 210, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.22)', padding: 6 }}>
            <Item onClick={() => { const t = doCopy(false); void navigator.clipboard?.writeText(t).catch(() => {}); setCtx(null); }}>Copy</Item>
            <Item onClick={() => { const t = doCopy(true); void navigator.clipboard?.writeText(t).catch(() => {}); setCtx(null); }}>Cut</Item>
            <Item onClick={() => { setCtx(null); void navigator.clipboard?.readText().then(paste).catch(() => onToast('Use Ctrl+V to paste — the browser blocked reading the clipboard')); }}>Paste</Item>
            <Divider />
            {ctx.head !== 'col' && <><Item onClick={() => { insertMany('row', R.r1, R.r2 - R.r1 + 1); setCtx(null); }}>Insert row above</Item><Item onClick={() => { insertMany('row', R.r2 + 1, R.r2 - R.r1 + 1); setCtx(null); }}>Insert row below</Item></>}
            {ctx.head !== 'row' && <><Item onClick={() => { insertMany('col', R.c1, R.c2 - R.c1 + 1); setCtx(null); }}>Insert column left</Item><Item onClick={() => { insertMany('col', R.c2 + 1, R.c2 - R.c1 + 1); setCtx(null); }}>Insert column right</Item></>}
            {ctx.head !== 'col' && <Item danger onClick={() => { deleteMany('row', R.r1, R.r2); setCtx(null); }}>Delete row{R.r2 > R.r1 ? 's' : ''}</Item>}
            {ctx.head !== 'row' && <Item danger onClick={() => { deleteMany('col', R.c1, R.c2); setCtx(null); }}>Delete column{R.c2 > R.c1 ? 's' : ''}</Item>}
            <Item onClick={() => { clearRange(); setCtx(null); }}>Clear contents</Item>
            {ctx.head !== 'col' && <Item onClick={() => { hide('row'); setCtx(null); }}>Hide row{R.r2 > R.r1 ? 's' : ''}</Item>}
            {ctx.head !== 'row' && <Item onClick={() => { hide('col'); setCtx(null); }}>Hide column{R.c2 > R.c1 ? 's' : ''}</Item>}
            {hiddenCount > 0 && <Item onClick={() => { unhideAll(); setCtx(null); }}>Show hidden rows and columns</Item>}
            <Divider />
            <Item onClick={() => { sortBy(ctx.c, 1); setCtx(null); }}>Sort sheet by {colName(ctx.c)}, A → Z</Item>
            <Item onClick={() => { sortBy(ctx.c, -1); setCtx(null); }}>Sort sheet by {colName(ctx.c)}, Z → A</Item>
            <Divider />
            <Item onClick={() => { setDlg('note'); setCtx(null); }}>{selNote ? 'Edit note…' : 'Add a note…'}</Item>
            <Item onClick={() => { setDlg('valid'); setCtx(null); }}>Dropdown / checkbox…</Item>
            <Item onClick={() => { setDlg('cond'); setCtx(null); }}>Conditional formatting…</Item>
          </div>
        </>
      )}
      {dlg === 'cond' && (
        <CondDialog rangeText={rangeLabel({ r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c2 })} rules={rules} onClose={() => setDlg(null)}
          onDelete={id => tx(() => { const l = condList(ydoc); const i = l.toArray().findIndex(s => { try { return (JSON.parse(s) as CondRule).id === id; } catch { return false; } }); if (i >= 0) l.delete(i, 1); })}
          onAdd={x => { const rg = parseRange(x.range); if (!rg) return 'Type a range like A2:D50'; if ((x.op !== 'empty' && x.op !== 'notempty') && x.val === '') return 'Enter a value to compare with'; tx(() => condList(ydoc).push([JSON.stringify({ id: newId(), tab: tabId, ...rg, op: x.op, val: x.val, bg: x.bg, fg: x.fg, ...(x.b ? { b: 1 } : {}) } satisfies CondRule)])); return null; }} />
      )}
      {dlg === 'valid' && (
        <ValidDialog rangeText={rangeLabel({ r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c2 })} current={selValid} onClose={() => setDlg(null)}
          onApply={rule => tx(() => forEachSel((r, c) => { const k = mkey(tabId, r, c); if (!rule) validMap(ydoc).delete(k); else validMap(ydoc).set(k, JSON.stringify(rule)); if (rule?.t === 'check' && !/^(true|false)$/i.test(raw(r, c))) tCells(tab.map).set(cellKey(r, c), 'FALSE'); }))} />
      )}
      {dlg === 'chart' && (
        <ChartDialog initial={chartEdit ?? undefined} rangeText={chartEdit ? rangeLabel(chartEdit) : rangeLabel({ r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c2 })} onClose={() => { setDlg(null); setChartEdit(null); }} onSave={v => saveChart(v, chartEdit)} />
      )}
      {dlg === 'note' && (
        <NoteDialog addr={addr(sel.r, sel.c)} initial={selNote?.t ?? ''} onClose={() => setDlg(null)}
          onSave={t => tx(() => { const k = mkey(tabId, sel.r, sel.c); if (!t) notesMap(ydoc).delete(k); else notesMap(ydoc).set(k, JSON.stringify({ t, by: me.name, at: Date.now() } satisfies NoteInfo)); })} />
      )}
      {/* tabs along the bottom */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid var(--k-d1d5db)', background: 'var(--k-f3f4f6)', flexShrink: 0, overflowX: 'auto', minHeight: isMobile ? 44 : 36 }}>
        <button type="button" onClick={addTab} title="Add a tab" aria-label="Add a tab" style={{ width: 40, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--k-6b7280)' }}>＋</button>
        {tabs.map(t => {
          const onT = t.id === tab.id;
          return (
            <div key={t.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', background: onT ? 'var(--k-fff)' : 'transparent', borderRight: '1px solid var(--k-e5e7eb)', borderTop: onT ? '2px solid #c9922c' : '2px solid transparent', flexShrink: 0 }}>
              {renaming?.id === t.id ? (
                <input autoFocus value={renaming.text} onChange={e => setRenaming({ id: t.id, text: e.target.value })} onBlur={() => { renameTab(t.id, renaming.text); setRenaming(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') { renameTab(t.id, renaming.text); setRenaming(null); } else if (e.key === 'Escape') setRenaming(null); }}
                  style={{ width: 120, margin: '0 8px', fontSize: 13, border: '1px solid #c9922c', borderRadius: 4, padding: '2px 4px' }} />
              ) : (
                <button type="button" onClick={() => { setActiveId(t.id); setSel({ r: 0, c: 0, r2: 0, c2: 0 }); setEdit(null); }} onDoubleClick={() => setRenaming({ id: t.id, text: t.name })}
                  style={{ border: 'none', background: 'transparent', padding: '0 4px 0 14px', height: '100%', fontSize: 13, fontWeight: onT ? 700 : 500, color: onT ? 'var(--k-1a1a1a)' : 'var(--k-6b7280)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
                  {t.map.get('feed') ? '● ' : ''}{t.name}
                </button>
              )}
              <button type="button" aria-label={`${t.name} options`} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setTabMenu(m => (m?.id === t.id ? null : { id: t.id, left: Math.max(8, Math.min(r.left, window.innerWidth - 180)), bottom: window.innerHeight - r.top + 4 })); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 8px', color: 'var(--k-9ca3af)', height: '100%' }}>▾</button>
              {tabMenu?.id === t.id && (
                <>
                  <div onClick={() => setTabMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 1300 }} />
                  <div role="menu" style={{ position: 'fixed', bottom: tabMenu.bottom, left: tabMenu.left, zIndex: 1301, minWidth: 160, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 12px 36px rgba(0,0,0,.18)', padding: 4 }}>
                    {([['Rename', () => setRenaming({ id: t.id, text: t.name })], ['Duplicate', () => dupTab(t.id)], ['Move left', () => moveTab(t.id, -1)], ['Move right', () => moveTab(t.id, 1)], ['Delete', () => deleteTab(t.id)]] as Array<[string, () => void]>).map(([label, fn]) => (
                      <button key={label} type="button" role="menuitem" onClick={() => { setTabMenu(null); fn(); }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13.5, borderRadius: 6, color: label === 'Delete' ? 'var(--k-dc2626)' : 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }}>{label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
        <span style={{ flex: 1 }} />
        {stats && <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', fontSize: 12.5, color: 'var(--k-374151)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {stats.n > 0 && <><span>Sum: <b>{stats.sum.toLocaleString('en-US', { maximumFractionDigits: 4 })}</b></span><span>Avg: <b>{(stats.sum / stats.n).toLocaleString('en-US', { maximumFractionDigits: 4 })}</b></span></>}
          <span>Count: <b>{stats.count}</b></span>
        </div>}
      </div>
    </div>
  );
}
