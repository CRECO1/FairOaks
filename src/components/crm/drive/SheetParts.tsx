'use client';

/** Small building blocks for the spreadsheet editor: popover menus, colour palette, and its dialogs (rules, dropdowns, notes, history). */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Y from 'yjs';
import { fromBase64 } from 'lib0/buffer';
import type { CondOp, CondRule, PivotAgg, ValidRule } from '@/lib/drive-sheet';
import { replaceSheetContents } from '@/lib/drive-sheet';
import type { DriveVersion } from '@/lib/drive-types';
import type { DrivePerson } from './DocsDrive';

const GOLD = '#c9922c';
const field: CSSProperties = { height: 34, border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '0 10px', fontSize: 13.5, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)', boxSizing: 'border-box' };
const primary: CSSProperties = { height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: GOLD, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
const plain: CSSProperties = { height: 34, padding: '0 14px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };

/** A button that opens a small floating panel under it. */
export function Pop({ label, title, children, style, active, align = 'left', className }: { label: ReactNode; title: string; children: (close: () => void) => ReactNode; style?: CSSProperties; active?: boolean; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, right: 0 });
  // The toolbar scrolls sideways (which clips anything absolutely positioned inside it), so the menu is placed on the page itself.
  const toggle = () => { const r = btn.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 4, left: r.left, right: Math.max(8, window.innerWidth - r.right) }); setOpen(o => !o); };
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button ref={btn} type="button" title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} onMouseDown={e => e.preventDefault()} onClick={toggle} className={`${className ?? ''} ${active || open ? 'on' : ''}`} style={style ? { ...style, background: active || open ? 'var(--k-fdf6e9)' : style.background } : undefined}>{label}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1300 }} />
          <div role="menu" style={{ position: 'fixed', top: pos.top, ...(align === 'right' ? { right: pos.right } : { left: Math.max(8, Math.min(pos.left, window.innerWidth - 360)) }), zIndex: 1301, minWidth: 180, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.18)', padding: 6, maxHeight: '70vh', overflowY: 'auto' }}>{children(() => setOpen(false))}</div>
        </>
      )}
    </div>
  );
}

export function Item({ children, onClick, danger, disabled, checked, hint }: { children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; checked?: boolean; hint?: string }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick}
      style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 8, padding: '8px 12px', border: 'none', background: 'none', cursor: disabled ? 'default' : 'pointer', fontSize: 13.5, borderRadius: 6, color: disabled ? 'var(--k-9ca3af)' : danger ? 'var(--k-dc2626)' : 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
      <span style={{ width: 14, color: GOLD }}>{checked ? '✓' : ''}</span><span style={{ flex: 1 }}>{children}</span>{hint && <span style={{ marginLeft: 18, fontSize: 11.5, color: 'var(--k-9ca3af)' }}>{hint}</span>}
    </button>
  );
}
export const Divider = () => <div style={{ height: 1, background: 'var(--k-e5e7eb)', margin: '4px 2px' }} />;

const PALETTE = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#efefef', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#9900ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#d9d2e9'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#b4a7d6'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#8e7cc3'],
];
export function Palette({ onPick, onClear, clearLabel }: { onPick: (c: string) => void; onClear: () => void; clearLabel: string }) {
  return (
    <div style={{ padding: 4 }}>
      {PALETTE.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 3, marginBottom: 3 }}>
          {row.map(c => <button key={c} type="button" aria-label={c} onMouseDown={e => e.preventDefault()} onClick={() => onPick(c)} style={{ width: 22, height: 22, borderRadius: 4, background: c, border: '1px solid rgba(0,0,0,.18)', cursor: 'pointer', padding: 0 }} />)}
        </div>
      ))}
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClear} style={{ marginTop: 2, width: '100%', border: '1px solid var(--k-e5e7eb)', borderRadius: 6, background: 'var(--k-fff)', padding: '5px 0', fontSize: 12.5, cursor: 'pointer', color: 'var(--k-374151)', fontFamily: "'DM Sans',sans-serif" }}>{clearLabel}</button>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)', padding: 12 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: wide ? 560 : 440, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto', background: 'var(--k-fff)', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif" }}>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--k-6b7280)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const lab: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--k-6b7280)', margin: '10px 0 4px', fontFamily: "'DM Sans',sans-serif" };

// ── conditional formatting ──────────────────────────────────────────────────────────────

const OPS: Array<[CondOp, string]> = [['gt', 'Greater than'], ['lt', 'Less than'], ['ge', 'Greater than or equal'], ['le', 'Less than or equal'], ['eq', 'Is equal to'], ['ne', 'Is not equal to'], ['contains', 'Text contains'], ['empty', 'Is empty'], ['notempty', 'Is not empty']];
export const opLabel = (op: CondOp) => OPS.find(o => o[0] === op)?.[1] ?? op;

export function CondDialog({ rangeText, rules, onAdd, onDelete, onClose }: { rangeText: string; rules: CondRule[]; onAdd: (r: { range: string; op: CondOp; val: string; bg: string; fg: string; b: boolean }) => string | null; onDelete: (id: string) => void; onClose: () => void }) {
  const [range, setRange] = useState(rangeText);
  const [op, setOp] = useState<CondOp>('gt');
  const [val, setVal] = useState('');
  const [bg, setBg] = useState('#fce5cd');
  const [fg, setFg] = useState('#cc0000');
  const [b, setB] = useState(false);
  const [err, setErr] = useState('');
  const needsVal = op !== 'empty' && op !== 'notempty';
  return (
    <Modal title="Conditional formatting" onClose={onClose} wide>
      {rules.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {rules.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--k-e5e7eb)', fontSize: 13 }}>
              <span style={{ width: 22, height: 22, borderRadius: 4, background: r.bg ?? 'transparent', color: r.fg ?? 'inherit', border: '1px solid var(--k-d1d5db)', fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: r.b ? 800 : 400 }}>A</span>
              <span style={{ flex: 1, minWidth: 0 }}>{opLabel(r.op)}{r.op !== 'empty' && r.op !== 'notempty' ? ` “${r.val}”` : ''} <span style={{ color: 'var(--k-9ca3af)' }}>· {rangeName(r)}</span></span>
              <button type="button" onClick={() => onDelete(r.id)} aria-label="Delete rule" style={{ border: 'none', background: 'none', color: 'var(--k-dc2626)', cursor: 'pointer', fontSize: 13 }}>Delete</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--k-374151)' }}>Add a rule</div>
      <label style={lab}>Apply to range</label>
      <input value={range} onChange={e => setRange(e.target.value)} style={{ ...field, width: '100%' }} placeholder="A2:D50" />
      <label style={lab}>Format cells if…</label>
      <select value={op} onChange={e => setOp(e.target.value as CondOp)} style={{ ...field, width: '100%' }}>{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {needsVal && <input value={val} onChange={e => setVal(e.target.value)} placeholder="Value" style={{ ...field, width: '100%', marginTop: 8 }} />}
      <label style={lab}>Formatting</label>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Fill <input type="color" value={bg} onChange={e => setBg(e.target.value)} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Text <input type="color" value={fg} onChange={e => setFg(e.target.value)} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={b} onChange={e => setB(e.target.checked)} /> Bold</label>
        <span style={{ padding: '3px 10px', borderRadius: 4, background: bg, color: fg, fontWeight: b ? 800 : 400, border: '1px solid var(--k-d1d5db)' }}>Preview</span>
      </div>
      {err && <div style={{ color: 'var(--k-dc2626)', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" style={plain} onClick={onClose}>Done</button>
        <button type="button" style={primary} onClick={() => { const e = onAdd({ range, op, val, bg, fg, b }); if (e) setErr(e); else { setErr(''); setVal(''); } }}>Add rule</button>
      </div>
    </Modal>
  );
}
const rangeName = (r: { r1: number; c1: number; r2: number; c2: number }) => `${colLetters(r.c1)}${r.r1 + 1}:${colLetters(r.c2)}${r.r2 + 1}`;
function colLetters(c: number) { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

// ── dropdowns, checkboxes and other entry rules ─────────────────────────────────────────

const KINDS: Array<[string, string]> = [['none', 'Normal cell (no rule)'], ['list', 'Dropdown — my own choices'], ['listrange', 'Dropdown — choices from a range'], ['check', 'Checkbox'], ['num', 'Number'], ['int', 'Whole number'], ['date', 'Date'], ['len', 'Text length'], ['email', 'Email address'], ['url', 'Web address']];
const OPS_V: Array<[string, string]> = [['between', 'between'], ['gt', 'greater than'], ['lt', 'less than'], ['ge', 'greater than or equal to'], ['le', 'less than or equal to'], ['eq', 'equal to'], ['ne', 'not equal to']];

export function ValidDialog({ rangeText, current, onApply, onClose }: { rangeText: string; current: ValidRule | undefined; onApply: (rule: ValidRule | null) => void; onClose: () => void }) {
  const initKind = !current ? 'none' : current.t === 'list' && current.src ? 'listrange' : current.t;
  const [kind, setKind] = useState<string>(initKind);
  const [opts, setOpts] = useState((current?.o ?? ['Yes', 'No']).join('\n'));
  const [src, setSrc] = useState(current?.src ?? '');
  const [op, setOp] = useState<string>(current?.op ?? 'between');
  const [a, setA] = useState(current?.a ?? '');
  const [b, setB] = useState(current?.b ?? '');
  const [warn, setWarn] = useState(!!current?.warn);
  const hasOp = kind === 'num' || kind === 'int' || kind === 'date' || kind === 'len';
  return (
    <Modal title="Data validation" onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--k-6b7280)', marginBottom: 6 }}>Applies to {rangeText}</div>
      <label style={lab}>Rule</label>
      <select value={kind} onChange={e => setKind(e.target.value)} style={{ ...field, width: '100%' }}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {kind === 'list' && (<><label style={lab}>Choices (one per line)</label><textarea value={opts} onChange={e => setOpts(e.target.value)} rows={6} style={{ ...field, width: '100%', height: 'auto', padding: 10 }} /></>)}
      {kind === 'listrange' && (<><label style={lab}>Range with the choices, e.g. Sheet1!A2:A20</label><input value={src} onChange={e => setSrc(e.target.value)} style={{ ...field, width: '100%' }} placeholder="Sheet1!A2:A20" /></>)}
      {hasOp && (<>
        <label style={lab}>{kind === 'len' ? 'Text length' : kind === 'date' ? 'Date (optional limit)' : 'Value'} must be</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={op} onChange={e => setOp(e.target.value)} style={{ ...field, flex: 1 }}>{OPS_V.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input value={a} onChange={e => setA(e.target.value)} placeholder={kind === 'date' ? '1/1/2026' : '0'} style={{ ...field, width: 100 }} />
          {op === 'between' && <input value={b} onChange={e => setB(e.target.value)} placeholder={kind === 'date' ? '12/31/2026' : '100'} style={{ ...field, width: 100 }} />}
        </div>
      </>)}
      {kind !== 'none' && kind !== 'check' && (<><label style={lab}>If someone types something else</label>
        <select value={warn ? 'warn' : 'reject'} onChange={e => setWarn(e.target.value === 'warn')} style={{ ...field, width: '100%' }}><option value="reject">Refuse the entry</option><option value="warn">Accept it but show a warning</option></select></>)}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" style={plain} onClick={onClose}>Cancel</button>
        <button type="button" style={primary} onClick={() => {
          if (kind === 'none') onApply(null);
          else if (kind === 'check') onApply({ t: 'check' });
          else if (kind === 'list') onApply({ t: 'list', o: opts.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 100), ...(warn ? { warn: 1 as const } : {}) });
          else if (kind === 'listrange') onApply({ t: 'list', src: src.trim(), ...(warn ? { warn: 1 as const } : {}) });
          else if (kind === 'email' || kind === 'url') onApply({ t: kind, ...(warn ? { warn: 1 as const } : {}) });
          else onApply({ t: kind as ValidRule['t'], op: op as ValidRule['op'], a, ...(op === 'between' ? { b } : {}), ...(warn ? { warn: 1 as const } : {}) });
          onClose();
        }}>Apply</button>
      </div>
    </Modal>
  );
}

// ── pivot table ─────────────────────────────────────────────────────────────────────────

export interface PivotForm { range: string; rowCol: number; colCol: number | null; valCol: number; agg: PivotAgg }
export function PivotDialog({ rangeText, headersOf, initial, onSave, onClose }: { rangeText: string; headersOf: (range: string) => string[] | null; initial?: PivotForm; onSave: (f: PivotForm) => string | null; onClose: () => void }) {
  const [range, setRange] = useState(initial?.range ?? rangeText);
  const [rowCol, setRowCol] = useState(initial?.rowCol ?? 0);
  const [colCol, setColCol] = useState<number | null>(initial?.colCol ?? null);
  const [valCol, setValCol] = useState(initial?.valCol ?? 1);
  const [agg, setAgg] = useState<PivotAgg>(initial?.agg ?? 'sum');
  const [err, setErr] = useState('');
  const heads = headersOf(range);
  const opts = (heads ?? []).map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>);
  return (
    <Modal title={initial ? 'Edit pivot table' : 'Create a pivot table'} onClose={onClose}>
      <label style={lab}>Source range (first row = column names)</label>
      <input value={range} onChange={e => setRange(e.target.value)} style={{ ...field, width: '100%' }} placeholder="A1:H200" />
      {!heads ? <div style={{ color: 'var(--k-dc2626)', fontSize: 12.5, marginTop: 8 }}>Type a range like A1:H200</div> : (<>
        <label style={lab}>Rows — group by</label><select value={rowCol} onChange={e => setRowCol(Number(e.target.value))} style={{ ...field, width: '100%' }}>{opts}</select>
        <label style={lab}>Columns — split by (optional)</label><select value={colCol ?? ''} onChange={e => setColCol(e.target.value === '' ? null : Number(e.target.value))} style={{ ...field, width: '100%' }}><option value="">(none)</option>{opts}</select>
        <label style={lab}>Values</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={agg} onChange={e => setAgg(e.target.value as PivotAgg)} style={{ ...field, width: 130 }}><option value="sum">Sum of</option><option value="count">Count of</option><option value="avg">Average of</option><option value="min">Min of</option><option value="max">Max of</option></select>
          <select value={valCol} onChange={e => setValCol(Number(e.target.value))} style={{ ...field, flex: 1 }}>{opts}</select>
        </div>
      </>)}
      {err && <div style={{ color: 'var(--k-dc2626)', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" style={plain} onClick={onClose}>Cancel</button>
        <button type="button" style={primary} disabled={!heads} onClick={() => { const e = onSave({ range, rowCol, colCol, valCol, agg }); if (e) setErr(e); else onClose(); }}>{initial ? 'Save' : 'Create'}</button>
      </div>
    </Modal>
  );
}

// ── protected ranges ────────────────────────────────────────────────────────────────────

export interface LockInfo { id: string; label: string; by: string; byName: string; mine: boolean }
export function ProtectDialog({ rangeText, locks, canManage, onAdd, onRemove, onClose }: { rangeText: string; locks: LockInfo[]; canManage: (l: LockInfo) => boolean; onAdd: (range: string) => string | null; onRemove: (id: string) => void; onClose: () => void }) {
  const [range, setRange] = useState(rangeText);
  const [err, setErr] = useState('');
  return (
    <Modal title="Protected ranges" onClose={onClose}>
      {locks.length > 0 && <div style={{ marginBottom: 12 }}>{locks.map(l => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--k-e5e7eb)', fontSize: 13 }}>
          <span>🔒</span><span style={{ flex: 1 }}>{l.label} <span style={{ color: 'var(--k-9ca3af)' }}>· only {l.mine ? 'you' : l.byName} can edit</span></span>
          {canManage(l) && <button type="button" onClick={() => onRemove(l.id)} style={{ border: 'none', background: 'none', color: 'var(--k-dc2626)', cursor: 'pointer', fontSize: 13 }}>Remove</button>}
        </div>))}</div>}
      <div style={{ fontSize: 13, color: 'var(--k-6b7280)', lineHeight: 1.5 }}>Protect cells so only you (and admins) can change them — everyone else can still see them. Good for headers, formulas and reference data.</div>
      <label style={lab}>Range to protect</label>
      <input value={range} onChange={e => setRange(e.target.value)} style={{ ...field, width: '100%' }} placeholder="A1:D1" />
      {err && <div style={{ color: 'var(--k-dc2626)', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" style={plain} onClick={onClose}>Done</button>
        <button type="button" style={primary} onClick={() => { const e = onAdd(range); if (e) setErr(e); else setErr(''); }}>Protect range</button>
      </div>
    </Modal>
  );
}

export function NoteDialog({ addr, initial, onSave, onClose }: { addr: string; initial: string; onSave: (t: string) => void; onClose: () => void }) {
  const [t, setT] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Modal title={`Note on ${addr}`} onClose={onClose}>
      <textarea ref={ref} value={t} onChange={e => setT(e.target.value)} rows={5} placeholder="Write a note for the team…" style={{ ...field, width: '100%', height: 'auto', padding: 10 }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        {initial && <button type="button" style={{ ...plain, color: 'var(--k-dc2626)' }} onClick={() => { onSave(''); onClose(); }}>Delete note</button>}
        <button type="button" style={plain} onClick={onClose}>Cancel</button>
        <button type="button" style={primary} onClick={() => { onSave(t.trim()); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

// ── version history ─────────────────────────────────────────────────────────────────────

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function HistoryDialog({ docId, authToken, ydoc, people, flush, onToast, onClose }: { docId: string; authToken?: string; ydoc: Y.Doc; people: DrivePerson[]; flush: () => Promise<void>; onToast: (m: string) => void; onClose: () => void }) {
  const [list, setList] = useState<DriveVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const h = () => ({ 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) });
  const load = async () => { try { const r = await fetch(`/api/crm/drive/doc-versions/${docId}`, { headers: h() }); const j = await r.json(); setList(r.ok ? j.versions ?? [] : []); } catch { setList([]); } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);
  const who = (id: string | null) => { const p = people.find(x => x.id === id); return p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : 'someone'; };
  const saveNow = async () => {
    setBusy('save');
    try {
      await flush();
      const label = window.prompt('Name this version (optional)') ?? '';
      const r = await fetch(`/api/crm/drive/doc-versions/${docId}`, { method: 'POST', headers: h(), body: JSON.stringify({ label }) });
      if (!r.ok) throw new Error();
      onToast('Version saved'); await load();
    } catch { onToast('Could not save a version'); } finally { setBusy(null); }
  };
  const restore = async (v: DriveVersion) => {
    if (!window.confirm(`Restore the spreadsheet to ${when(v.created_at)}? Everyone sees the change. The current version is saved first, so you can undo this.`)) return;
    setBusy(v.id);
    try {
      await flush();
      await fetch(`/api/crm/drive/doc-versions/${docId}`, { method: 'POST', headers: h(), body: JSON.stringify({ kind: 'restore' }) });
      const r = await fetch(`/api/crm/drive/doc-versions/${docId}?version=${v.id}`, { headers: h() });
      const j = await r.json(); if (!r.ok || !j.state) throw new Error();
      const tmp = new Y.Doc(); Y.applyUpdate(tmp, fromBase64(j.state)); replaceSheetContents(ydoc, tmp); tmp.destroy();
      onToast('Version restored'); onClose();
    } catch { onToast('Could not restore that version'); } finally { setBusy(null); }
  };
  return (
    <Modal title="Version history" onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><button type="button" style={primary} disabled={busy === 'save'} onClick={() => void saveNow()}>⭐ Save a version now</button></div>
      {list === null ? <div style={{ color: 'var(--k-9ca3af)', padding: 12 }}>Loading…</div> : list.length === 0 ? <div style={{ color: 'var(--k-9ca3af)', padding: 12, fontSize: 13.5 }}>No saved versions yet. One is taken automatically as people edit (at most every 10 minutes).</div> : list.map(v => (
        <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--k-e5e7eb)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--k-1a1a1a)' }}>{v.label || (v.kind === 'auto' ? 'Automatic save' : v.kind === 'restore' ? 'Before a restore' : 'Saved version')}</div>
            <div style={{ fontSize: 12, color: 'var(--k-9ca3af)' }}>{when(v.created_at)} · {who(v.created_by)}</div>
          </div>
          <button type="button" style={plain} disabled={busy === v.id} onClick={() => void restore(v)}>{busy === v.id ? 'Restoring…' : 'Restore'}</button>
        </div>
      ))}
    </Modal>
  );
}

export const MenuLabel = ({ children }: { children: ReactNode }) => <div style={{ padding: '8px 12px 3px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--k-9ca3af)' }}>{children}</div>;

export type IcoName = 'undo' | 'redo' | 'brush' | 'clear' | 'left' | 'center' | 'right' | 'wrap' | 'borders' | 'merge' | 'freeze' | 'filter' | 'sort' | 'chart' | 'search' | 'plus' | 'download' | 'refresh' | 'zoom' | 'dollar' | 'percent' | 'dec-' | 'dec+' | 'more' | 'table';
const ICO: Record<IcoName, ReactNode> = {
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></>,
  brush: <><path d="M14 4l6 6-8 8-3 1-4-4 1-3z" /><path d="M10 8l6 6" /></>,
  clear: <><path d="M5 5h11M10.5 5v9" /><path d="M14 14l6 6M20 14l-6 6" /></>,
  left: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />, center: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />, right: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  wrap: <><path d="M4 6h16M4 12h12a3 3 0 010 6h-5" /><path d="M13 15.5L10.5 18 13 20.5" /><path d="M4 18h3" /></>,
  borders: <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M12 4v16M4 12h16" /></>,
  merge: <><rect x="4" y="6" width="16" height="12" rx="1" /><path d="M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2" /></>,
  freeze: <><path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" /></>,
  filter: <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />,
  sort: <><path d="M8 5v14M5 16l3 3 3-3" /><path d="M16 19V5M13 8l3-3 3 3" /></>,
  chart: <path d="M5 20V11M12 20V4M19 20v-6" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  download: <><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19h14" /></>,
  refresh: <><path d="M20 11a8 8 0 00-14-4L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0014 4l2-2" /><path d="M20 20v-5h-5" /></>,
  zoom: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4M11 8.5v5M8.5 11h5" /></>,
  dollar: <path d="M12 3v18M16.5 7.5c-1-1.3-2.6-2-4.5-2-2.5 0-4 1.2-4 3s1.5 2.5 4 3 4 1.2 4 3-1.5 3-4 3c-2 0-3.8-.8-4.8-2.2" />,
  percent: <><path d="M18 6L6 18" /><circle cx="7.5" cy="7.5" r="2.2" /><circle cx="16.5" cy="16.5" r="2.2" /></>,
  'dec-': <><path d="M3 17h2M3 11h6M3 8h0" /><path d="M13 6l-3 3 3 3M10 9h10" /></>,
  'dec+': <><path d="M3 17h2" /><path d="M17 6l3 3-3 3M20 9H10" /><path d="M9 11v6M13 11v6" /></>,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  table: <><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 10h16M10 5v14" /></>,
};
export function Ico({ n, size = 17 }: { n: IcoName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>{ICO[n]}</svg>;
}
/** A toolbar button: icon or text, a tooltip with its shortcut, and a gold "on" state. */
export function TBtn({ title, onClick, on, disabled, children, style }: { title: string; onClick: () => void; on?: boolean; disabled?: boolean; children: ReactNode; style?: CSSProperties }) {
  return <button type="button" className={`sx-btn ${on ? 'on' : ''}`} title={title} aria-label={title} aria-pressed={on} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick} style={style}>{children}</button>;
}
export const TSep = () => <span style={{ width: 1, height: 20, background: 'var(--k-e5e7eb)', margin: '0 4px', flexShrink: 0, alignSelf: 'center' }} />;
export const SHEET_CSS = `
.sx-btn{height:30px;min-width:30px;padding:0 7px;border:none;border-radius:6px;background:transparent;color:var(--k-374151);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;font-size:13px;font-family:'DM Sans',sans-serif;font-weight:600;white-space:nowrap;flex-shrink:0}
.sx-btn:hover{background:var(--k-f3f4f6)} .sx-btn.on{background:var(--k-fdf6e9);color:#a06a12} .sx-btn:disabled{opacity:.4;cursor:default}
.sx-mb{height:30px;padding:0 10px;border:none;border-radius:6px;background:transparent;color:var(--k-374151);cursor:pointer;font-size:13.5px;font-weight:500;font-family:'DM Sans',sans-serif;flex-shrink:0}
.sx-mb:hover{background:var(--k-f3f4f6)} .sx-mb.on{background:var(--k-fdf6e9);color:#a06a12}
.sx-gold{height:30px;padding:0 12px;border:none;border-radius:6px;background:var(--k-fdf6e9);color:#a06a12;cursor:pointer;font-size:13px;font-weight:700;font-family:'DM Sans',sans-serif;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0}
.sx-gold:hover{background:#f6e6c4} .sx-gold:disabled{opacity:.6;cursor:default}
`;
