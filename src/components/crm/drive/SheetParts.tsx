'use client';

/** Small building blocks for the spreadsheet editor: popover menus, colour palette, and its dialogs (rules, dropdowns, notes, history). */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Y from 'yjs';
import { fromBase64 } from 'lib0/buffer';
import type { CondOp, CondRule, ValidRule } from '@/lib/drive-sheet';
import { replaceSheetContents } from '@/lib/drive-sheet';
import type { DriveVersion } from '@/lib/drive-types';
import type { DrivePerson } from './DocsDrive';

const GOLD = '#c9922c';
const field: CSSProperties = { height: 34, border: '1px solid var(--k-d1d5db)', borderRadius: 8, padding: '0 10px', fontSize: 13.5, fontFamily: "'DM Sans',sans-serif", background: 'var(--k-fff)', color: 'var(--k-1a1a1a)', boxSizing: 'border-box' };
const primary: CSSProperties = { height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: GOLD, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };
const plain: CSSProperties = { height: 34, padding: '0 14px', border: '1px solid var(--k-d1d5db)', borderRadius: 8, background: 'var(--k-fff)', color: 'var(--k-374151)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" };

/** A button that opens a small floating panel under it. */
export function Pop({ label, title, children, style, active, align = 'left' }: { label: ReactNode; title: string; children: (close: () => void) => ReactNode; style: CSSProperties; active?: boolean; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} onMouseDown={e => e.preventDefault()} onClick={() => setOpen(o => !o)} style={{ ...style, background: active || open ? 'var(--k-fdf6e9)' : style.background }}>{label}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1300 }} />
          <div role="menu" style={{ position: 'absolute', [align]: 0, top: 'calc(100% + 4px)', zIndex: 1301, minWidth: 180, background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.18)', padding: 6, maxHeight: '70vh', overflowY: 'auto' }}>{children(() => setOpen(false))}</div>
        </>
      )}
    </div>
  );
}

export function Item({ children, onClick, danger, disabled, checked }: { children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; checked?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick}
      style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 8, padding: '8px 12px', border: 'none', background: 'none', cursor: disabled ? 'default' : 'pointer', fontSize: 13.5, borderRadius: 6, color: disabled ? 'var(--k-9ca3af)' : danger ? 'var(--k-dc2626)' : 'var(--k-1a1a1a)', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
      <span style={{ width: 14, color: GOLD }}>{checked ? '✓' : ''}</span>{children}
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

// ── dropdowns / checkboxes ──────────────────────────────────────────────────────────────

export function ValidDialog({ rangeText, current, onApply, onClose }: { rangeText: string; current: ValidRule | undefined; onApply: (rule: ValidRule | null) => void; onClose: () => void }) {
  const [kind, setKind] = useState<'none' | 'list' | 'check'>(current?.t ?? 'none');
  const [opts, setOpts] = useState((current?.o ?? ['Yes', 'No']).join('\n'));
  return (
    <Modal title="Dropdowns and checkboxes" onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--k-6b7280)', marginBottom: 6 }}>Applies to {rangeText}</div>
      <label style={lab}>Show as</label>
      <select value={kind} onChange={e => setKind(e.target.value as 'none' | 'list' | 'check')} style={{ ...field, width: '100%' }}>
        <option value="none">Normal cell</option><option value="list">Dropdown list</option><option value="check">Checkbox</option>
      </select>
      {kind === 'list' && (<><label style={lab}>Choices (one per line)</label><textarea value={opts} onChange={e => setOpts(e.target.value)} rows={6} style={{ ...field, width: '100%', height: 'auto', padding: 10 }} /></>)}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" style={plain} onClick={onClose}>Cancel</button>
        <button type="button" style={primary} onClick={() => { onApply(kind === 'none' ? null : kind === 'check' ? { t: 'check' } : { t: 'list', o: opts.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 100) }); onClose(); }}>Apply</button>
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
