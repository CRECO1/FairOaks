'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * "@" mentions of CRM contacts and deals inside a document. Typing "@" and a few letters lists matching records (read with the caller's
 * own access); Enter / click inserts a chip that links to the record. Clicking a chip anywhere in the document opens that contact or deal
 * (the CRM listens for `crm:open-record`).
 */
interface Hit { kind: 'contact' | 'deal'; id: string; label: string }
const TRIGGER = /(?:^|\s)@([\p{L}\p{N}][\p{L}\p{N} .'-]{0,28})?$/u;

export default function DocMention({ editor, authToken }: { editor: Editor | null; authToken?: string }) {
  const [state, setState] = useState<{ q: string; from: number; x: number; y: number } | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [idx, setIdx] = useState(0);
  const live = useRef({ state, hits, idx }); live.current = { state, hits, idx };

  // Watch what is typed before the cursor.
  useEffect(() => {
    if (!editor) return;
    const check = () => {
      const { selection } = editor.state;
      if (!selection.empty || !editor.isEditable) { setState(null); return; }
      const { $from } = selection;
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
      const m = TRIGGER.exec(before);
      if (!m) { setState(null); return; }
      const q = m[1] ?? '';
      const from = selection.from - q.length - 1;
      const c = editor.view.coordsAtPos(selection.from);
      setState({ q, from, x: c.left, y: c.bottom + 4 });
    };
    editor.on('update', check); editor.on('selectionUpdate', check);
    return () => { editor.off('update', check); editor.off('selectionUpdate', check); };
  }, [editor]);

  // Look up matches (debounced).
  const q = state?.q ?? null;
  useEffect(() => {
    if (q === null || q.length < 1) { setHits([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/crm/drive/mention-search?q=${encodeURIComponent(q)}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
        const j = await r.json().catch(() => ({})) as { results?: Hit[] };
        setHits(r.ok ? (j.results ?? []) : []); setIdx(0);
      } catch { setHits([]); }
    }, 180);
    return () => clearTimeout(t);
  }, [q, authToken]);

  const pick = (h: Hit) => {
    const s = live.current.state;
    if (!editor || !s) return;
    editor.chain().focus().deleteRange({ from: s.from, to: editor.state.selection.from })
      .insertContent([{ type: 'crmRef', attrs: { kind: h.kind, id: h.id, label: h.label } }, { type: 'text', text: ' ' }]).run();
    setState(null); setHits([]);
  };

  // Arrow keys / Enter / Escape while the list is open; a click on a chip opens its record.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      const { state: s, hits: h, idx: i } = live.current;
      if (!s || !h.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setIdx((i + 1) % h.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setIdx((i - 1 + h.length) % h.length); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); pick(h[i]); }
      else if (e.key === 'Escape') { e.stopPropagation(); setState(null); }
    };
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.crm-ref') as HTMLElement | null;
      if (!el?.dataset.id) return;
      window.dispatchEvent(new CustomEvent('crm:open-record', { detail: { kind: el.dataset.kind, id: el.dataset.id } }));
    };
    dom.addEventListener('keydown', onKey, true); dom.addEventListener('click', onClick);
    return () => { dom.removeEventListener('keydown', onKey, true); dom.removeEventListener('click', onClick); };
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state || !hits.length) return null;
  return (
    <div role="listbox" aria-label="Mention a contact or deal" style={{ position: 'fixed', left: Math.min(state.x, (typeof window !== 'undefined' ? window.innerWidth : 800) - 290), top: state.y, width: 280, maxHeight: 260, overflowY: 'auto', zIndex: 1500, background: 'var(--k-fff)', border: '1px solid var(--k-d1d5db)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.18)', padding: 4 }}>
      {hits.map((h, i) => (
        <div key={`${h.kind}:${h.id}`} role="option" aria-selected={i === idx} onMouseDown={e => { e.preventDefault(); pick(h); }} onMouseEnter={() => setIdx(i)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', minHeight: 36, borderRadius: 7, cursor: 'pointer', fontSize: 13.5, background: i === idx ? 'var(--k-fdf6e9)' : 'transparent' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--k-a06a12)', textTransform: 'uppercase', width: 46, flexShrink: 0 }}>{h.kind === 'deal' ? 'Deal' : 'Contact'}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.label}</span>
        </div>
      ))}
    </div>
  );
}
