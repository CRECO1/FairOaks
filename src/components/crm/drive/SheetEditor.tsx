'use client';

/**
 * SheetEditor — a Google-Sheets-style spreadsheet in My Drive that teammates edit together in real time.
 *
 * Same plumbing as LiveDocEditor: a Yjs document owned by the module-level registry, live traffic over the private Realtime
 * channel `drive-doc:<id>`, durable saves merged by /api/crm/drive/doc-state/<id>. The cells live in the `tabs` map of that
 * document (see lib/drive-sheet.ts): every tab has its own cells, bold marks, column widths and frozen rows. The grid itself
 * is drawn here (only the visible rows are rendered) with a formula bar, tabs along the bottom, and CSV / Excel download.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';
import { createClient } from '@/lib/supabase/client';
import { acquireDoc, releaseDoc, type CollabHandle } from '@/lib/collab/doc-registry';
import type { CollabStatus } from '@/lib/collab/supabase-yjs-provider';
import type { DriveDoc } from '@/lib/drive-types';
import {
  Evaluator, applyFeed, MAX_COLS, MAX_ROWS, SheetError, addr, cellKey, colName, csvEscape, displayVal, listTabs, newId, newTabMap, parseKey,
  tBold, tCells, tCols, tabGrid, tabsMap, type FeedData, type TabInfo,
} from '@/lib/drive-sheet';
import { Frame, btnStyle, colorFor, iconBtn } from './DocChrome';
import { ActivityPanel } from './DocPanel';
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

const ROW_H = 26, HEAD_H = 26, NUM_W = 48, DEF_W = 120, MIN_W = 36;
const LOCAL = 'sheet-local';

export default function SheetWorkspace({ doc, initialState, authToken, user, isMobile, onClose, onShare, onToast, onTitle, people = [] }: Props) {
  const [handle, setHandle] = useState<CollabHandle | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [save, setSave] = useState<SaveState>('saved');
  const [title, setTitle] = useState(doc.title);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [panel, setPanel] = useState<null | 'activity'>(null);
  const me = useMemo<Peer>(() => ({ name: user.name || 'Teammate', color: colorFor(user.id) }), [user.id, user.name]);
  const authRef = useRef(authToken); authRef.current = authToken;
  const toastRef = useRef(onToast); toastRef.current = onToast;

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

    // Saving: identical to the live documents — collect updates, merge, send after typing pauses (or every 8 s while typing).
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
    </Frame>
  );
}

// ── the grid ─────────────────────────────────────────────────────────────────────────────

function Grid({ handle, me, peers, isMobile, docId, authToken, title, onToast }: { handle: CollabHandle; me: Peer; peers: Peer[]; isMobile: boolean; docId: string; authToken?: string; title: string; onToast: (m: string) => void }) {
  const ydoc = handle.ydoc;
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>({ r: 0, c: 0, r2: 0, c2: 0 });
  const [edit, setEdit] = useState<{ r: number; c: number; text: string } | null>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [box, setBox] = useState({ w: 800, h: 500 });
  const [bar, setBar] = useState<string | null>(null);       // formula bar text while it is focused
  const [tabMenu, setTabMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const undo = useMemo(() => new Y.UndoManager(tabsMap(ydoc), { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 }), [ydoc]);
  useEffect(() => () => undo.destroy(), [undo]);

  // Re-render whenever anything in the tabs changes (mine or a teammate's).
  useEffect(() => {
    const m = tabsMap(ydoc);
    const on = () => bump();
    m.observeDeep(on);
    return () => m.unobserveDeep(on);
  }, [ydoc]);

  const tabs = useMemo(() => listTabs(ydoc), [ydoc, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tab: TabInfo | undefined = tabs.find(t => t.id === activeId) ?? tabs[0];
  const tabId = tab?.id ?? '';
  const rows = Math.min(MAX_ROWS, Number(tab?.map.get('rows') ?? 100));
  const ncols = Math.min(MAX_COLS, Number(tab?.map.get('ncols') ?? 12));
  const frozen = Math.min(rows, Number(tab?.map.get('frozen') ?? 0));
  const widths = useMemo(() => {
    const w: number[] = [];
    for (let c = 0; c < ncols; c++) w.push(Math.max(MIN_W, Number(tab ? tCols(tab.map).get(String(c)) : 0) || DEF_W));
    return w;
  }, [tab, ncols, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const lefts = useMemo(() => { const l = [0]; widths.forEach((w, i) => l.push(l[i] + w)); return l; }, [widths]);
  const totalW = lefts[lefts.length - 1];

  const evaluator = useMemo(() => {
    const byName = new Map(tabs.map(t => [t.name, t.map]));
    return new Evaluator((tn, r, c) => (byName.get(tn ?? '')?.get('cells') as Y.Map<string> | undefined)?.get(cellKey(r, c)) ?? '', tab?.name ?? '');
  }, [tabs, tab?.name, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const raw = useCallback((r: number, c: number) => (tab ? tCells(tab.map).get(cellKey(r, c)) ?? '' : ''), [tab, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size of the scrolling area.
  useEffect(() => {
    const el = body.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [tabId]);

  // A different tab starts at its top-left corner.
  useEffect(() => { const el = body.current; if (el) { el.scrollTop = 0; el.scrollLeft = 0; } setScroll({ top: 0, left: 0 }); }, [tabId]);

  // Tell teammates which cell I'm on.
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

  const clearRange = () => { if (!tab) return; tx(() => { for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) tCells(tab.map).delete(cellKey(r, c)); }); };
  const toggleBold = () => {
    if (!tab) return;
    const b = tBold(tab.map); const on = !b.get(cellKey(R.r1, R.c1));
    tx(() => { for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) { if (on) b.set(cellKey(r, c), true); else b.delete(cellKey(r, c)); } });
  };
  const moveTo = (r: number, c: number, extend = false) => {
    const rr = Math.max(0, Math.min(MAX_ROWS - 1, r)), cc = Math.max(0, Math.min(MAX_COLS - 1, c));
    setSel(s => (extend ? { ...s, r2: rr, c2: cc } : { r: rr, c: cc, r2: rr, c2: cc }));
    // keep the cell in view
    const el = body.current; if (!el) return;
    const top = rr * ROW_H, bottom = top + ROW_H, left = lefts[cc] ?? cc * DEF_W, right = left + (widths[cc] ?? DEF_W);
    const frozenH = frozen * ROW_H;
    if (rr >= frozen && top < el.scrollTop + frozenH) el.scrollTop = top - frozenH;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    if (left < el.scrollLeft) el.scrollLeft = left; else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  };
  const startEdit = (r: number, c: number, text?: string) => { setEdit({ r, c, text: text ?? raw(r, c) }); };
  const commitEdit = (then?: 'down' | 'right' | 'stay') => {
    if (!edit) return;
    const { r, c, text } = edit;
    setEdit(null);
    if (text !== raw(r, c)) setCell(r, c, text);
    if (then === 'down') moveTo(r + 1, c); else if (then === 'right') moveTo(r, c + 1);
    setTimeout(() => wrap.current?.focus(), 0);
  };

  const gridText = (s: Sel) => { const x = range(s); const lines: string[] = []; for (let r = x.r1; r <= x.r2; r++) { const row: string[] = []; for (let c = x.c1; c <= x.c2; c++) row.push(raw(r, c)); lines.push(row.join('\t')); } return lines.join('\n'); };
  const paste = (text: string) => {
    if (!tab) return;
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
    tx(() => {
      lines.forEach((cols, i) => cols.forEach((v, j) => { const r = R.r1 + i, c = R.c1 + j; if (r < MAX_ROWS && c < MAX_COLS) { const cells = tCells(tab.map), k = cellKey(r, c); if (v === '') cells.delete(k); else cells.set(k, v); } }));
      const lastR = R.r1 + lines.length - 1, lastC = R.c1 + Math.max(...lines.map(l => l.length)) - 1;
      if (lastR >= Number(tab.map.get('rows') ?? 100) - 1) tab.map.set('rows', Math.min(MAX_ROWS, lastR + 21));
      if (lastC >= Number(tab.map.get('ncols') ?? 12) - 1) tab.map.set('ncols', Math.min(MAX_COLS, lastC + 3));
    });
    setSel({ r: R.r1, c: R.c1, r2: Math.min(MAX_ROWS - 1, R.r1 + lines.length - 1), c2: Math.min(MAX_COLS - 1, R.c1 + Math.max(...lines.map(l => l.length)) - 1) });
  };

  const shift = (axis: 'row' | 'col', at: number, delta: 1 | -1) => {
    if (!tab) return;
    tx(() => {
      for (const m of [tCells(tab.map) as Y.Map<unknown>, tBold(tab.map) as Y.Map<unknown>]) {
        const moves: Array<[string, string | null, unknown]> = [];
        m.forEach((v, k) => {
          const [r, c] = parseKey(k); const i = axis === 'row' ? r : c;
          if (delta === 1 && i >= at) moves.push([k, axis === 'row' ? cellKey(r + 1, c) : cellKey(r, c + 1), v]);
          if (delta === -1) { if (i === at) moves.push([k, null, v]); else if (i > at) moves.push([k, axis === 'row' ? cellKey(r - 1, c) : cellKey(r, c - 1), v]); }
        });
        moves.sort((a, b) => 0 + (delta === 1 ? (parseKey(b[0])[axis === 'row' ? 0 : 1] - parseKey(a[0])[axis === 'row' ? 0 : 1]) : (parseKey(a[0])[axis === 'row' ? 0 : 1] - parseKey(b[0])[axis === 'row' ? 0 : 1])));
        for (const [k] of moves) m.delete(k);
        for (const [, to, v] of moves) if (to) m.set(to, v);
      }
      if (axis === 'row') tab.map.set('rows', Math.min(MAX_ROWS, Math.max(30, rows + delta)));
      else tab.map.set('ncols', Math.min(MAX_COLS, Math.max(6, ncols + delta)));
    });
  };

  const sortBy = (c: number, dir: 1 | -1) => {
    if (!tab) return;
    let last = -1; tCells(tab.map).forEach((v, k) => { if (v !== '') last = Math.max(last, parseKey(k)[0]); });
    const body_: Array<{ r: number; key: string | number }> = [];
    for (let r = frozen; r <= last; r++) { const v = evaluator.value(null, r, c); body_.push({ r, key: v instanceof SheetError ? String(v) : typeof v === 'number' ? v : (v ?? '') === '' ? '￿' : String(v).toLowerCase() }); }
    const blank = (x: { key: string | number }) => x.key === '￿';
    body_.sort((a, b) => (blank(a) ? 1 : blank(b) ? -1 : (typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : String(a.key).localeCompare(String(b.key), undefined, { numeric: true })) * dir));
    tx(() => {
      const cells = tCells(tab.map), bold = tBold(tab.map);
      const snap = new Map<string, { v: string; b: boolean }>();
      for (const { r } of body_) for (let cc = 0; cc < ncols; cc++) { const k = cellKey(r, cc); snap.set(k, { v: cells.get(k) ?? '', b: !!bold.get(k) }); }
      body_.forEach(({ r: from }, i) => {
        const to = frozen + i;
        for (let cc = 0; cc < ncols; cc++) {
          const s = snap.get(cellKey(from, cc))!, k = cellKey(to, cc);
          if (s.v === '') cells.delete(k); else cells.set(k, s.v);
          if (s.b) bold.set(k, true); else bold.delete(k);
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
  const renameTab = (id: string, name: string) => { const t = tabs.find(x => x.id === id); const n = name.trim().slice(0, 60); if (!t || !n || n === t.name) return; if (tabs.some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) { onToast('Another tab already has that name'); return; } tx(() => t.map.set('name', n)); };
  const deleteTab = (id: string) => { if (tabs.length < 2) { onToast('A spreadsheet needs at least one tab'); return; } tx(() => tabsMap(ydoc).delete(id)); if (activeId === id) setActiveId(null); };
  const moveTab = (id: string, dir: -1 | 1) => {
    const i = tabs.findIndex(t => t.id === id), j = i + dir; if (i < 0 || j < 0 || j >= tabs.length) return;
    tx(() => { tabs.forEach((t, k) => t.map.set('order', k === i ? j : k === j ? i : k)); });
  };
  const dupTab = (id: string) => {
    const t = tabs.find(x => x.id === id); if (!t) return;
    const nid = newId(), m = newTabMap(`${t.name} copy`.slice(0, 60), (tabs[tabs.length - 1]?.order ?? 0) + 1, Number(t.map.get('rows') ?? 100), Number(t.map.get('ncols') ?? 12), Number(t.map.get('frozen') ?? 0));
    tx(() => { tabsMap(ydoc).set(nid, m); tCells(t.map).forEach((v, k) => tCells(m).set(k, v)); tBold(t.map).forEach((v, k) => tBold(m).set(k, v)); tCols(t.map).forEach((v, k) => tCols(m).set(k, v)); });
    setActiveId(nid);
  };

  // ── export ──
  const shown = (t: TabInfo) => { const ev = new Evaluator((tn, r, c) => (tabs.find(x => x.name === tn)?.map.get('cells') as Y.Map<string> | undefined)?.get(cellKey(r, c)) ?? '', t.name); return (r: number, c: number) => displayVal(ev.value(null, r, c)); };
  const download = async (kind: 'csv' | 'xlsx') => {
    if (!tab) return;
    const base = (title || 'spreadsheet').replace(/[^\w\- ]+/g, '').trim() || 'spreadsheet';
    try {
      if (kind === 'csv') {
        const csv = tabGrid(tab.map, shown(tab)).map(r => r.map(csvEscape).join(',')).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `${base} - ${tab.name}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } else {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        for (const t of tabs) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tabGrid(t.map, shown(t)).map(r => r.map(v => (v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v)))), t.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
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
  // Opening the sheet (and every 5 minutes while it stays open) pulls fresh CRM rows into its feed tabs.
  const feedTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => {
      const stale = listTabs(ydoc).some(x => x.map.get('feed') && Date.now() - Number(x.map.get('feedAt') ?? 0) > 60_000);
      if (stale) void refreshFeed(true);
    }, 1500);
    feedTimer.current = setInterval(() => { if (document.visibilityState === 'visible') void refreshFeed(true); }, 5 * 60_000);
    return () => { clearTimeout(t); clearInterval(feedTimer.current); };
  }, [ydoc, refreshFeed]);

  // ── pointer + keyboard ──
  const cellAt = (clientX: number, clientY: number): { r: number; c: number } | null => {
    const el = body.current; if (!el) return null;
    const b = el.getBoundingClientRect();
    const x = clientX - b.left, y = clientY - b.top;
    if (x < 0 || y < 0) return null;
    const yy = y < frozen * ROW_H ? y : y + el.scrollTop, xx = x + el.scrollLeft;
    let c = 0; while (c < ncols - 1 && lefts[c + 1] <= xx) c++;
    return { r: Math.min(rows - 1, Math.max(0, Math.floor(yy / ROW_H))), c };
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (edit) commitEdit('stay');
    const p = cellAt(e.clientX, e.clientY); if (!p) return;
    if (e.shiftKey) setSel(s => ({ ...s, r2: p.r, c2: p.c })); else setSel({ r: p.r, c: p.c, r2: p.r, c2: p.c });
    dragging.current = true; wrap.current?.focus();
    const up = () => { dragging.current = false; window.removeEventListener('mouseup', up); };
    window.addEventListener('mouseup', up);
  };
  const onMouseMove = (e: React.MouseEvent) => { if (!dragging.current) return; const p = cellAt(e.clientX, e.clientY); if (p) setSel(s => (s.r2 === p.r && s.c2 === p.c ? s : { ...s, r2: p.r, c2: p.c })); };
  const onDouble = (e: React.MouseEvent) => { const p = cellAt(e.clientX, e.clientY); if (p) startEdit(p.r, p.c); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) undo.redo(); else undo.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); undo.redo(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleBold(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel({ r: 0, c: 0, r2: rows - 1, c2: ncols - 1 }); return; }
    if (mod) return; // copy / cut / paste are handled by their own events
    const ext = e.shiftKey;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveTo((ext ? sel.r2 : sel.r) + 1, ext ? sel.c2 : sel.c, ext); return;
      case 'ArrowUp': e.preventDefault(); moveTo((ext ? sel.r2 : sel.r) - 1, ext ? sel.c2 : sel.c, ext); return;
      case 'ArrowLeft': e.preventDefault(); moveTo(ext ? sel.r2 : sel.r, (ext ? sel.c2 : sel.c) - 1, ext); return;
      case 'ArrowRight': e.preventDefault(); moveTo(ext ? sel.r2 : sel.r, (ext ? sel.c2 : sel.c) + 1, ext); return;
      case 'Tab': e.preventDefault(); moveTo(sel.r, sel.c + (e.shiftKey ? -1 : 1)); return;
      case 'Enter': e.preventDefault(); startEdit(sel.r, sel.c); return;
      case 'F2': e.preventDefault(); startEdit(sel.r, sel.c); return;
      case 'Delete': case 'Backspace': e.preventDefault(); clearRange(); return;
      case 'Home': e.preventDefault(); moveTo(sel.r, 0); return;
      case 'PageDown': e.preventDefault(); moveTo(sel.r + 20, sel.c); return;
      case 'PageUp': e.preventDefault(); moveTo(sel.r - 20, sel.c); return;
      case 'Escape': setSel(s => ({ ...s, r2: s.r, c2: s.c })); return;
    }
    if (e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(sel.r, sel.c, e.key); }
  };

  // ── drawing ──
  const bold = tab ? tBold(tab.map) : null;
  const firstRow = Math.max(frozen, Math.floor(scroll.top / ROW_H) - 3);
  const lastRow = Math.min(rows - 1, Math.floor((scroll.top + box.h) / ROW_H) + 3);
  let c0 = 0; while (c0 < ncols - 1 && lefts[c0 + 1] < scroll.left) c0++;
  let c1 = c0; while (c1 < ncols - 1 && lefts[c1] < scroll.left + box.w) c1++;

  const cell = (r: number, c: number, top: number) => {
    const v = evaluator.value(null, r, c);
    const isNum = typeof v === 'number', isErr = v instanceof SheetError;
    const inSel = r >= R.r1 && r <= R.r2 && c >= R.c1 && c <= R.c2;
    const text = displayVal(v);
    const isActive = r === sel.r && c === sel.c;
    if (!text && !inSel && !bold?.get(cellKey(r, c))) return <div key={`${r}:${c}`} style={{ position: 'absolute', top, left: lefts[c], width: widths[c], height: ROW_H, borderRight: '1px solid var(--k-e5e7eb)', borderBottom: '1px solid var(--k-e5e7eb)', boxSizing: 'border-box' }} />;
    return (
      <div key={`${r}:${c}`} style={{
        position: 'absolute', top, left: lefts[c], width: widths[c], height: ROW_H, boxSizing: 'border-box', padding: '0 6px', lineHeight: `${ROW_H - 1}px`, fontSize: 13,
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: isNum ? 'right' : 'left', fontWeight: bold?.get(cellKey(r, c)) || (frozen > 0 && r < frozen) ? 700 : 400,
        color: isErr ? 'var(--k-dc2626)' : 'var(--k-1a1a1a)', borderRight: '1px solid var(--k-e5e7eb)', borderBottom: '1px solid var(--k-e5e7eb)',
        background: inSel && !isActive ? 'rgba(201,146,44,.14)' : frozen > 0 && r < frozen ? 'var(--k-f9fafb)' : 'var(--k-fff)',
      }}>{text}</div>
    );
  };

  const peerBoxes = peers.filter(p => p.cell && p.cell.tab === tabId).map((p, i) => {
    const { r, c } = p.cell!; if (r >= rows || c >= ncols) return null;
    const top = (r < frozen ? r * ROW_H : r * ROW_H - scroll.top), left = lefts[c] - scroll.left;
    return <div key={i} style={{ position: 'absolute', top, left, width: widths[c], height: ROW_H, border: `2px solid ${p.color}`, boxSizing: 'border-box', pointerEvents: 'none', zIndex: 3 }}>
      <span style={{ position: 'absolute', top: -15, left: -2, background: p.color, color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3, whiteSpace: 'nowrap' }}>{p.name}</span>
    </div>;
  });

  const selTop = sel.r < frozen ? sel.r * ROW_H : sel.r * ROW_H - scroll.top;
  const selBox = { top: Math.min(selTop, (R.r1 < frozen ? R.r1 * ROW_H : R.r1 * ROW_H - scroll.top)), left: lefts[R.c1] - scroll.left, width: lefts[R.c2 + 1] - lefts[R.c1], height: (R.r2 - R.r1 + 1) * ROW_H };

  const beginResize = (c: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = widths[c]; if (!tab) return;
    const move = (ev: MouseEvent) => { const w = Math.max(MIN_W, Math.round(startW + ev.clientX - startX)); tx(() => tCols(tab.map).set(String(c), w)); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const activeRaw = edit ? edit.text : bar ?? raw(sel.r, sel.c);
  const hasFeed = tab ? !!tab.map.get('feed') : false;
  const tb: React.CSSProperties = { ...btnStyle(isMobile), height: isMobile ? 36 : 28, padding: '0 10px', fontSize: 13 };

  if (!tab) return <div style={{ padding: 28, color: 'var(--k-9ca3af)' }}>Opening…</div>;
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--k-fff)' }}>
      {/* toolbar */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--k-e5e7eb)', flexWrap: 'wrap' }}>
        <button type="button" style={tb} onClick={() => undo.undo()} title="Undo (Ctrl+Z)">↶</button>
        <button type="button" style={tb} onClick={() => undo.redo()} title="Redo (Ctrl+Y)">↷</button>
        <button type="button" style={{ ...tb, fontWeight: 800 }} onClick={toggleBold} title="Bold (Ctrl+B)">B</button>
        <button type="button" style={tb} onClick={() => tx(() => tab.map.set('frozen', frozen ? 0 : 1))} title="Keep the first row visible while scrolling">{frozen ? '☑' : '☐'} Header row</button>
        <button type="button" style={tb} onClick={() => sortBy(sel.c, 1)} title="Sort rows by this column, A → Z">A→Z</button>
        <button type="button" style={tb} onClick={() => sortBy(sel.c, -1)} title="Sort rows by this column, Z → A">Z→A</button>
        <button type="button" style={tb} onClick={() => shift('row', R.r2 + 1, 1)} title="Insert a row below">＋ Row</button>
        <button type="button" style={tb} onClick={() => { if (R.r1 === R.r2) shift('row', R.r1, -1); else onToast('Select one row to delete'); }} title="Delete the selected row">－ Row</button>
        <button type="button" style={tb} onClick={() => shift('col', R.c2 + 1, 1)} title="Insert a column to the right">＋ Col</button>
        <button type="button" style={tb} onClick={() => { if (R.c1 === R.c2) shift('col', R.c1, -1); else onToast('Select one column to delete'); }} title="Delete the selected column">－ Col</button>
        <span style={{ flex: 1 }} />
        {hasFeed && <button type="button" style={{ ...tb, color: '#a06a12', background: 'var(--k-fdf6e9)' }} disabled={refreshing} onClick={() => void refreshFeed(false)} title="Pull the latest from the CRM into the live columns">{refreshing ? 'Refreshing…' : '↻ Refresh from CRM'}</button>}
        <button type="button" style={tb} onClick={() => void download('csv')} title="Download this tab as CSV">⬇ CSV</button>
        <button type="button" style={tb} onClick={() => void download('xlsx')} title="Download every tab as an Excel file">⬇ Excel</button>
      </div>
      {/* formula bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderBottom: '1px solid var(--k-e5e7eb)' }}>
        <div style={{ width: 64, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: 'var(--k-6b7280)', border: '1px solid var(--k-e5e7eb)', borderRadius: 6, padding: '4px 0' }}>
          {R.r1 === R.r2 && R.c1 === R.c2 ? addr(sel.r, sel.c) : `${addr(R.r1, R.c1)}:${addr(R.r2, R.c2)}`}
        </div>
        <span style={{ color: 'var(--k-9ca3af)', fontStyle: 'italic', fontSize: 13 }}>fx</span>
        <input value={activeRaw} aria-label="Cell contents"
          onFocus={() => setBar(raw(sel.r, sel.c))}
          onChange={e => { if (edit) setEdit({ ...edit, text: e.target.value }); else setBar(e.target.value); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const t = edit ? edit.text : bar ?? ''; if (edit) setEdit(null); setBar(null); setCell(sel.r, sel.c, t); wrap.current?.focus(); } else if (e.key === 'Escape') { setBar(null); setEdit(null); wrap.current?.focus(); } }}
          onBlur={() => { if (bar !== null && bar !== raw(sel.r, sel.c)) setCell(sel.r, sel.c, bar); setBar(null); }}
          style={{ flex: 1, minWidth: 0, border: '1px solid var(--k-e5e7eb)', borderRadius: 6, padding: '4px 8px', fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)' }} />
      </div>
      {/* grid */}
      <div ref={wrap} tabIndex={0} onKeyDown={onKeyDown} style={{ flex: 1, minHeight: 0, position: 'relative', outline: 'none', userSelect: 'none', overflow: 'hidden' }}
        onCopy={e => { if (edit) return; e.preventDefault(); e.clipboardData.setData('text/plain', gridText(sel)); }}
        onCut={e => { if (edit) return; e.preventDefault(); e.clipboardData.setData('text/plain', gridText(sel)); clearRange(); }}
        onPaste={e => { if (edit) return; e.preventDefault(); paste(e.clipboardData.getData('text/plain')); }}>
        {/* corner + column letters */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: NUM_W, height: HEAD_H, background: 'var(--k-f3f4f6)', borderRight: '1px solid var(--k-d1d5db)', borderBottom: '1px solid var(--k-d1d5db)', zIndex: 5, boxSizing: 'border-box' }} />
        <div style={{ position: 'absolute', top: 0, left: NUM_W, right: 0, height: HEAD_H, overflow: 'hidden', zIndex: 4, background: 'var(--k-f3f4f6)', borderBottom: '1px solid var(--k-d1d5db)', boxSizing: 'border-box' }}>
          <div style={{ position: 'relative', width: totalW, height: HEAD_H, transform: `translateX(${-scroll.left}px)` }}>
            {Array.from({ length: c1 - c0 + 1 }, (_, i) => c0 + i).map(c => (
              <div key={c} onClick={() => { setSel({ r: 0, c, r2: rows - 1, c2: c }); wrap.current?.focus(); }}
                style={{ position: 'absolute', left: lefts[c], width: widths[c], height: HEAD_H, lineHeight: `${HEAD_H}px`, textAlign: 'center', fontSize: 12, fontWeight: 600, color: c >= R.c1 && c <= R.c2 ? '#a06a12' : 'var(--k-6b7280)', background: c >= R.c1 && c <= R.c2 ? 'var(--k-fdf6e9)' : undefined, borderRight: '1px solid var(--k-d1d5db)', boxSizing: 'border-box', cursor: 'pointer' }}>
                {colName(c)}
                <span onMouseDown={e => beginResize(c, e)} style={{ position: 'absolute', right: -3, top: 0, width: 7, height: HEAD_H, cursor: 'col-resize', zIndex: 2 }} />
              </div>
            ))}
          </div>
        </div>
        {/* row numbers */}
        <div style={{ position: 'absolute', top: HEAD_H, left: 0, width: NUM_W, bottom: 0, overflow: 'hidden', zIndex: 4, background: 'var(--k-f3f4f6)', borderRight: '1px solid var(--k-d1d5db)', boxSizing: 'border-box' }}>
          <div style={{ position: 'relative', height: rows * ROW_H, transform: `translateY(${-scroll.top}px)` }}>
            {Array.from({ length: Math.max(0, lastRow - firstRow + 1) }, (_, i) => firstRow + i).map(r => (
              <div key={r} onClick={() => { setSel({ r, c: 0, r2: r, c2: ncols - 1 }); wrap.current?.focus(); }}
                style={{ position: 'absolute', top: r * ROW_H, height: ROW_H, width: NUM_W, lineHeight: `${ROW_H}px`, textAlign: 'center', fontSize: 11.5, color: r >= R.r1 && r <= R.r2 ? '#a06a12' : 'var(--k-9ca3af)', background: r >= R.r1 && r <= R.r2 ? 'var(--k-fdf6e9)' : undefined, borderBottom: '1px solid var(--k-d1d5db)', boxSizing: 'border-box', cursor: 'pointer' }}>{r + 1}</div>
            ))}
          </div>
          {frozen > 0 && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: NUM_W, height: frozen * ROW_H, background: 'var(--k-f3f4f6)', zIndex: 2 }}>
              {Array.from({ length: frozen }, (_, r) => <div key={r} style={{ position: 'absolute', top: r * ROW_H, height: ROW_H, width: NUM_W, lineHeight: `${ROW_H}px`, textAlign: 'center', fontSize: 11.5, color: 'var(--k-9ca3af)', borderBottom: '2px solid var(--k-d1d5db)', boxSizing: 'border-box' }}>{r + 1}</div>)}
            </div>
          )}
        </div>
        {/* cells */}
        <div ref={body} onScroll={e => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onDoubleClick={onDouble}
          style={{ position: 'absolute', top: HEAD_H, left: NUM_W, right: 0, bottom: 0, overflow: 'auto' }}>
          <div style={{ position: 'relative', width: totalW, height: rows * ROW_H }}>
            {Array.from({ length: Math.max(0, lastRow - firstRow + 1) }, (_, i) => firstRow + i).flatMap(r => Array.from({ length: c1 - c0 + 1 }, (_, j) => cell(r, c0 + j, r * ROW_H)))}
          </div>
        </div>
        {frozen > 0 && (
          <div style={{ position: 'absolute', top: HEAD_H, left: NUM_W, right: 0, height: frozen * ROW_H, overflow: 'hidden', zIndex: 2, pointerEvents: 'none', borderBottom: '2px solid var(--k-d1d5db)', boxSizing: 'content-box' }}>
            <div style={{ position: 'relative', width: totalW, height: frozen * ROW_H, transform: `translateX(${-scroll.left}px)` }}>
              {Array.from({ length: frozen }, (_, r) => r).flatMap(r => Array.from({ length: c1 - c0 + 1 }, (_, j) => cell(r, c0 + j, r * ROW_H)))}
            </div>
          </div>
        )}
        {/* selection frame, peers, editor */}
        <div style={{ position: 'absolute', top: HEAD_H, left: NUM_W, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 3 }}>
          <div style={{ position: 'absolute', ...selBox, border: '2px solid #c9922c', boxSizing: 'border-box', pointerEvents: 'none' }} />
          {peerBoxes}
          {edit && (
            <input ref={el => { editor.current = el; if (el && document.activeElement !== el) { el.focus(); const n = el.value.length; el.setSelectionRange(n, n); } }} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} aria-label="Edit cell"
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit('down'); }
                else if (e.key === 'Tab') { e.preventDefault(); commitEdit('right'); }
                else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); wrap.current?.focus(); }
                e.stopPropagation();
              }}
              onBlur={() => { if (editor.current && document.activeElement?.getAttribute('aria-label') === 'Cell contents') return; commitEdit('stay'); }}
              style={{ position: 'absolute', pointerEvents: 'auto', top: edit.r < frozen ? edit.r * ROW_H : edit.r * ROW_H - scroll.top, left: lefts[edit.c] - scroll.left, width: Math.max(widths[edit.c], 140), height: ROW_H, boxSizing: 'border-box', border: '2px solid #c9922c', outline: 'none', padding: '0 5px', fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)', zIndex: 6, userSelect: 'text' }} />
          )}
        </div>
      </div>
      {/* tabs along the bottom */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid var(--k-d1d5db)', background: 'var(--k-f3f4f6)', flexShrink: 0, overflowX: 'auto', minHeight: isMobile ? 44 : 36 }}>
        <button type="button" onClick={addTab} title="Add a tab" aria-label="Add a tab" style={{ width: 40, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--k-6b7280)' }}>＋</button>
        {tabs.map(t => {
          const on = t.id === tab.id;
          return (
            <div key={t.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', background: on ? 'var(--k-fff)' : 'transparent', borderRight: '1px solid var(--k-e5e7eb)', borderTop: on ? '2px solid #c9922c' : '2px solid transparent', flexShrink: 0 }}>
              {renaming?.id === t.id ? (
                <input autoFocus value={renaming.text} onChange={e => setRenaming({ id: t.id, text: e.target.value })} onBlur={() => { renameTab(t.id, renaming.text); setRenaming(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') { renameTab(t.id, renaming.text); setRenaming(null); } else if (e.key === 'Escape') setRenaming(null); }}
                  style={{ width: 120, margin: '0 8px', fontSize: 13, border: '1px solid #c9922c', borderRadius: 4, padding: '2px 4px' }} />
              ) : (
                <button type="button" onClick={() => { setActiveId(t.id); setSel({ r: 0, c: 0, r2: 0, c2: 0 }); setEdit(null); }} onDoubleClick={() => setRenaming({ id: t.id, text: t.name })}
                  style={{ border: 'none', background: 'transparent', padding: '0 4px 0 14px', height: '100%', fontSize: 13, fontWeight: on ? 700 : 500, color: on ? 'var(--k-1a1a1a)' : 'var(--k-6b7280)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
                  {t.map.get('feed') ? '● ' : ''}{t.name}
                </button>
              )}
              <button type="button" aria-label={`${t.name} options`} onClick={() => setTabMenu(m => (m === t.id ? null : t.id))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 8px', color: 'var(--k-9ca3af)', height: '100%' }}>▾</button>
              {tabMenu === t.id && (
                <>
                  <div onClick={() => setTabMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div role="menu" style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 41, minWidth: 160, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 10, boxShadow: '0 12px 36px rgba(0,0,0,.18)', padding: 4 }}>
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
      </div>
    </div>
  );
}
