'use client';

/**
 * DriveHoverCard — the floating preview itself (see DriveHoverPreview.tsx for when it opens). Loaded lazily, the first time a card is
 * shown, so the Drive page does not carry the document editor and the PDF / Office renderers until someone hovers.
 *
 * Shows: the start of a live document, the first rows of a spreadsheet, page 1 of a PDF / Word / Excel file, the picture itself, or a
 * saved form's first page. What it draws is remembered (last 40) so a second look is instant; files over 15 MB are not pulled just to peek.
 * The card ignores the pointer completely (pointer-events none), so the row underneath stays clickable.
 */
import React, { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import * as Y from 'yjs';
import { fromBase64 } from 'lib0/buffer';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import DI from './DriveIcons';
import { docExtensions } from './doc-extensions';
import { DocStyles } from './DocStyles';
import { LetterheadHeader } from './Letterhead';
import type { PMNode } from '@/lib/doc-pdf';
import { colName, displayVal, listTabs, readRangeFromDoc, SheetError } from '@/lib/drive-sheet';
import { fmtSize, loadThumb, previewKind, type PreviewKind, type Thumb } from '@/lib/attachment-preview';
import type { DriveFile, DriveFormItem } from '@/lib/drive-types';
import type { HoverInfo, HoverItem, Shown } from './DriveHoverPreview';

type Loaded =
  | { t: 'doc'; json: PMNode; empty: boolean; letterhead: boolean }
  | { t: 'sheet'; tabs: Array<{ name: string; grid: string[][] }> }
  | { t: 'thumb'; thumb: Thumb; kind: PreviewKind }
  | { t: 'note'; text: string };

const CARD_W = 440;
const CARD_H = 500;
const GAP = 22;
const EDGE = 12;
const FILE_LIMIT = 15 * 1024 * 1024;

// ─── What gets drawn, loaded once per item version and remembered ────────────────────────────────────────────────────────────────
const cache = new Map<string, Promise<Loaded>>();
function remember(key: string, make: () => Promise<Loaded>): Promise<Loaded> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = make();
  cache.set(key, p);
  p.catch(() => { if (cache.get(key) === p) cache.delete(key); });   // a failure is not remembered, so the next hover tries again
  while (cache.size > 40) cache.delete(cache.keys().next().value as string);
  return p;
}

async function getJson<T>(url: string, token?: string): Promise<T> {
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || 'Could not load the preview');
  return j as T;
}

const textLen = (n: PMNode): number => (typeof n.text === 'string' ? n.text.length : 0) + (n.content ?? []).reduce((s, c) => s + textLen(c), 0);
/** Only the first screenful is ever visible, so hand the editor the start of a long document, not all of it. */
function firstPart(json: PMNode): PMNode {
  const keep: PMNode[] = [];
  let chars = 0;
  for (const n of json.content ?? []) {
    keep.push(n);
    chars += textLen(n);
    if (keep.length >= 60 || chars >= 3500) break;
  }
  return { ...json, content: keep };
}

/** A live document or live spreadsheet: one request for its saved state, then read it the same way Quick look does. */
async function loadLive(id: string, token?: string): Promise<Loaded> {
  const j = await getJson<{ state?: string | null; doc?: { kind?: string } }>(`/api/crm/drive/doc-state/${id}`, token);
  const y = new Y.Doc();
  try {
    if (j.state) Y.applyUpdate(y, fromBase64(j.state));
    if (j.doc?.kind === 'sheet') {
      const tabs = listTabs(y).map(t => {
        const grid = readRangeFromDoc(y, `${t.name}!A1:J30`).map(row => row.map(v => (v instanceof SheetError ? v.code : displayVal(v))));
        let last = grid.length - 1; while (last > 0 && grid[last].every(x => x === '')) last--;
        let lastCol = 0; grid.forEach(r => r.forEach((v, c) => { if (v !== '' && c > lastCol) lastCol = c; }));   // show only the columns that have something in them
        return { name: t.name, grid: grid.slice(0, last + 1).map(r => r.slice(0, lastCol + 1)) };
      });
      return { t: 'sheet', tabs };
    }
    const json = yXmlFragmentToProsemirrorJSON(y.getXmlFragment('default')) as PMNode;
    return { t: 'doc', json: firstPart(json), empty: !j.state, letterhead: y.getMap('meta').get('letterhead') === true };
  } finally { y.destroy(); }
}

/** Fetch a stored file and hand it to the CRM's own first-page thumbnailer (the same one the email composer uses). */
async function thumbOf(url: string, key: string, name: string, size: number | null, mime: string): Promise<Loaded> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Could not load the file');
  const blob = await r.blob();
  const file = new File([blob], name, { type: mime || blob.type });
  const thumb = await loadThumb({ key, name, size, mime, source: 'My Drive', file });
  return thumb ? { t: 'thumb', thumb, kind: previewKind({ mime, name }) } : { t: 'note', text: 'Couldn’t draw a preview of this one. Click to open it.' };
}

async function loadFile(f: DriveFile, token?: string): Promise<Loaded> {
  const mime = f.mime ?? '';
  if (previewKind({ mime, name: f.name }) === 'other' && !/\.(txt|md|log|doc)$/i.test(f.name)) return { t: 'note', text: 'No preview for this kind of file. Click to open or download it.' };
  if (f.size != null && f.size > FILE_LIMIT) return { t: 'note', text: `This file is ${fmtSize(f.size)}, too big to preview on hover. Click to open it.` };
  const j = await getJson<{ url: string }>(`/api/crm/drive/file/${f.id}`, token);
  return thumbOf(j.url, `drive:${f.id}:${f.updated_at}`, f.name, f.size, mime);
}

async function loadForm(f: DriveFormItem, token?: string): Promise<Loaded> {
  const unsaved: Loaded = { t: 'note', text: 'This form hasn’t been saved as a PDF yet. Open it and fill it in first.' };
  if (!f.has_pdf) return unsaved;
  const j = await getJson<{ url: string | null }>(`/api/crm/drive/forms/${f.id}`, token);
  if (!j.url) return unsaved;
  return thumbOf(j.url, `drive-form:${f.id}:${f.updated_at}`, `${f.title}.pdf`, null, 'application/pdf');
}

function loadFor(kind: Shown['kind'], item: HoverItem, token?: string): Promise<Loaded> {
  return remember(`${kind}:${item.id}:${item.updated_at}`, () => (kind === 'doc' ? loadLive(item.id, token) : kind === 'file' ? loadFile(item as DriveFile, token) : loadForm(item as DriveFormItem, token)));
}

// ─── The card ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export default function DriveHoverCard({ shown, token, info }: { shown: Shown; token?: string; info: HoverInfo }) {
  const [res, setRes] = useState<{ ok: true; v: Loaded } | { ok: false } | null>(null);
  useEffect(() => {
    let live = true;
    loadFor(shown.kind, shown.item, token).then(v => { if (live) setRes({ ok: true, v }); }).catch(() => { if (live) setRes({ ok: false }); });
    return () => { live = false; };
  }, [shown, token]);

  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const h = Math.min(CARD_H, vh - EDGE * 2);
  // Beside the pointer, never on top of it: the right if it fits, else the left; in a narrow window the roomier side, with a narrower card.
  const roomR = vw - EDGE - (shown.x + GAP), roomL = shown.x - GAP - EDGE;
  const useRight = roomR >= CARD_W || (roomL < CARD_W && roomR >= roomL);
  const w = Math.max(Math.min(CARD_W, useRight ? roomR : roomL), Math.min(300, vw - EDGE * 2));
  const left = Math.max(EDGE, Math.min(useRight ? shown.x + GAP : shown.x - GAP - w, vw - w - EDGE));
  const top = Math.max(EDGE, Math.min((shown.top + shown.bottom) / 2 - h * 0.28, vh - h - EDGE));

  const v = res && res.ok ? res.v : null;
  const foot = !v ? '' : v.t === 'doc' ? 'Start of the document' : v.t === 'sheet' ? `First rows${v.tabs.length > 1 ? ` · ${v.tabs.length} tabs` : ''}` : v.t === 'thumb' ? (v.thumb.pages && v.thumb.pages > 1 ? `Page 1 of ${v.thumb.pages}` : v.kind === 'image' ? '' : 'First page') : '';

  return (
    <div className="dhp" aria-hidden="true" data-kind={shown.kind}
      style={{ position: 'fixed', left, top, width: w, height: h, zIndex: 1150, pointerEvents: 'none', display: 'flex', flexDirection: 'column', background: 'var(--k-fff)', border: '1px solid var(--k-e5e7eb)', borderRadius: 12, boxShadow: '0 14px 44px rgba(0,0,0,.24), 0 2px 8px rgba(0,0,0,.08)', overflow: 'hidden', fontFamily: "'DM Sans',sans-serif", userSelect: 'none' }}>
      <style>{`
        @keyframes dhpIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
        @keyframes dhpSk{0%{background-position:100% 0}100%{background-position:-100% 0}}
        .dhp{animation:dhpIn .13s ease-out}
        .dhp .drive-doc{font-size:12.5px;line-height:1.55;min-height:0}
        .dhp .drive-doc h1{font-size:1.5em}.dhp .drive-doc h2{font-size:1.25em}
        .dhp-sk{height:9px;border-radius:5px;background:linear-gradient(90deg,var(--k-eef0f2) 25%,var(--k-f3f4f6) 50%,var(--k-eef0f2) 75%);background-size:200% 100%;animation:dhpSk 1.2s linear infinite}
        @media (prefers-reduced-motion:reduce){.dhp,.dhp-sk{animation:none}}
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--k-eef0f2)', flexShrink: 0 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: `${info.color}1f`, color: info.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><DI n={info.icon} size={16} /></span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--k-1a1a1a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.title}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--k-9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.sub}</span>
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', background: 'var(--k-f3f4f6)' }}>
        {!res && <Skeleton />}
        {res && !res.ok && <Note text="Couldn’t load a preview right now. Click to open it." />}
        {v?.t === 'note' && <Note text={v.text} />}
        {v?.t === 'doc' && <DocBody doc={v} />}
        {v?.t === 'sheet' && <SheetBody tab={v.tabs[0]} />}
        {v?.t === 'thumb' && <ThumbBody thumb={v.thumb} kind={v.kind} w={w} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 14px', borderTop: '1px solid var(--k-eef0f2)', fontSize: 11.5, color: 'var(--k-9ca3af)', flexShrink: 0 }}>
        <span>Click to open</span><span>{foot}</span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ background: 'var(--k-fff)', height: '100%', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 11 }}>
      {[92, 100, 84, 96, 60, 0, 98, 90, 78, 94, 70].map((p, i) => p === 0 ? <div key={i} style={{ height: 6 }} /> : <div key={i} className="dhp-sk" style={{ width: `${p}%` }} />)}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, textAlign: 'center', fontSize: 13, lineHeight: 1.5, color: 'var(--k-6b7280)', background: 'var(--k-fff)' }}>{text}</div>;
}

const fade = (to: string): React.CSSProperties => ({ position: 'absolute', left: 0, right: 0, bottom: 0, height: 64, background: `linear-gradient(to bottom, transparent, ${to})`, pointerEvents: 'none' });

function DocBody({ doc }: { doc: Extract<Loaded, { t: 'doc' }> }) {
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions: docExtensions(), content: doc.json as never, editorProps: { attributes: { class: 'drive-doc' } } }, [doc]);
  return (
    <div style={{ background: 'var(--k-fff)', height: '100%', padding: '20px 24px', overflow: 'hidden', position: 'relative' }}>
      {doc.letterhead && <LetterheadHeader />}
      {doc.empty ? <div style={{ color: 'var(--k-9ca3af)', fontSize: 13 }}>This document is empty so far.</div> : <EditorContent editor={editor} />}
      <div style={fade('var(--k-fff)')} />
      <DocStyles />
    </div>
  );
}

function SheetBody({ tab }: { tab: { name: string; grid: string[][] } | undefined }) {
  if (!tab || !tab.grid.length) return <Note text="This spreadsheet is empty so far." />;
  const cols = Math.min(8, Math.max(1, ...tab.grid.map(r => r.length)));
  const cell: React.CSSProperties = { padding: '4px 6px', border: '1px solid var(--k-e5e7eb)', whiteSpace: 'nowrap', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' };
  const head: React.CSSProperties = { background: 'var(--k-f3f4f6)', color: 'var(--k-6b7280)', fontWeight: 600, padding: '3px 6px', border: '1px solid var(--k-e5e7eb)' };
  return (
    <div style={{ background: 'var(--k-fff)', height: '100%', overflow: 'hidden', position: 'relative' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%' }}>
        <thead><tr><th style={{ ...head, width: 28 }} />{Array.from({ length: cols }, (_, c) => <th key={c} style={head}>{colName(c)}</th>)}</tr></thead>
        <tbody>{tab.grid.map((row, r) => (
          <tr key={r}>
            <td style={{ ...head, textAlign: 'center', fontWeight: 400, color: 'var(--k-9ca3af)' }}>{r + 1}</td>
            {Array.from({ length: cols }, (_, c) => <td key={c} style={{ ...cell, color: 'var(--k-1a1a1a)', fontWeight: r === 0 ? 700 : 400 }}>{row[c] ?? ''}</td>)}
          </tr>
        ))}</tbody>
      </table>
      <div style={fade('var(--k-fff)')} />
    </div>
  );
}

function ThumbBody({ thumb, kind, w }: { thumb: Thumb; kind: PreviewKind; w: number }) {
  if (thumb.html && thumb.htmlWidth) {   // Word / Excel / PowerPoint / text, drawn by the CRM's own renderers (already scrubbed)
    const natural = Math.min(thumb.htmlWidth, 900);
    return (
      <div style={{ height: '100%', overflow: 'hidden', position: 'relative', background: 'var(--k-fff)' }}>
        <div style={{ width: natural, transform: `scale(${w / natural})`, transformOrigin: 'top left' }} dangerouslySetInnerHTML={{ __html: thumb.html }} />
        <div style={fade('var(--k-f3f4f6)')} />
      </div>
    );
  }
  if (thumb.grid) {
    return (
      <div style={{ height: '100%', background: 'var(--k-fff)', padding: 10 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%' }}>
          <tbody>{thumb.grid.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ border: '1px solid var(--k-e5e7eb)', padding: '3px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90, color: 'var(--k-1a1a1a)', fontWeight: i === 0 ? 700 : 400 }}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (!thumb.src) return <Note text="No preview for this one. Click to open it." />;
  if (kind === 'image') {   // a picture: show all of it
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb.src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
      </div>
    );
  }
  return (   // a PDF page: from the top, cut off where the card ends
    <div style={{ height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumb.src} alt="" style={{ width: '100%', display: 'block', background: '#fff' }} />
      <div style={fade('var(--k-f3f4f6)')} />
    </div>
  );
}
