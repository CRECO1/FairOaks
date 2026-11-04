import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

// Find & replace for live documents: matches are highlighted by decorations (view-only, never written into the shared document);
// replacing edits the text like any other typing, so teammates see it live.

export interface FindStorage { q: string; cur: number; matchCase: boolean }
export interface Match { from: number; to: number }
const key = new PluginKey('findReplace');
const st = (ed: Editor) => (ed.storage as unknown as { findReplace: FindStorage }).findReplace;

export function findMatches(doc: PMNode, q: string, matchCase: boolean): Match[] {
  if (!q) return [];
  const needle = matchCase ? q : q.toLowerCase();
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = ''; const map: number[] = [];   // text index -> doc position
    node.forEach((child, off) => {
      if (child.isText) { for (let i = 0; i < (child.text ?? '').length; i++) { text += child.text![i]; map.push(pos + 1 + off + i); } }
      else { text += '￼'; map.push(pos + 1 + off); }
    });
    const hay = matchCase ? text : text.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + Math.max(1, needle.length))) out.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
    return false;
  });
  return out;
}

export const FindReplace = Extension.create<Record<string, never>, FindStorage>({
  name: 'findReplace',
  addStorage() { return { q: '', cur: 0, matchCase: false }; },
  addProseMirrorPlugins() {
    const ed = this.editor;
    return [new Plugin({
      key,
      props: {
        decorations(state) {
          const s = st(ed); if (!s.q) return DecorationSet.empty;
          const ms = findMatches(state.doc, s.q, s.matchCase);
          return DecorationSet.create(state.doc, ms.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.cur ? 'find-hit find-cur' : 'find-hit' })));
        },
      },
    })];
  },
});

/** Re-draw the highlights (a no-op transaction makes ProseMirror ask for decorations again). */
export function refreshFind(ed: Editor) { ed.view.dispatch(ed.state.tr.setMeta('findRefresh', true)); }

export function setFind(ed: Editor, q: string, matchCase: boolean) { const s = st(ed); s.q = q; s.matchCase = matchCase; s.cur = 0; refreshFind(ed); }
export function countFind(ed: Editor): number { const s = st(ed); return findMatches(ed.state.doc, s.q, s.matchCase).length; }
export function currentFind(ed: Editor): number { return st(ed).cur; }

export function stepFind(ed: Editor, dir: 1 | -1) {
  const s = st(ed); const ms = findMatches(ed.state.doc, s.q, s.matchCase); if (!ms.length) return;
  s.cur = (s.cur + dir + ms.length) % ms.length;
  const m = ms[s.cur];
  ed.chain().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run();
  refreshFind(ed);
}

/** Replace the current match (or the next one from the cursor) and move on. */
export function replaceOne(ed: Editor, rep: string) {
  const s = st(ed); const ms = findMatches(ed.state.doc, s.q, s.matchCase); if (!ms.length) return;
  const m = ms[Math.min(s.cur, ms.length - 1)];
  const tr = ed.state.tr;
  if (rep) tr.replaceWith(m.from, m.to, ed.schema.text(rep, ed.state.doc.resolve(m.from).marks())); else tr.delete(m.from, m.to);
  ed.view.dispatch(tr);
  const left = findMatches(ed.state.doc, s.q, s.matchCase).length;
  s.cur = left ? Math.min(s.cur, left - 1) : 0;
  refreshFind(ed);
}

export function replaceAll(ed: Editor, rep: string): number {
  const s = st(ed); const ms = findMatches(ed.state.doc, s.q, s.matchCase); if (!ms.length) return 0;
  const tr = ed.state.tr;
  for (const m of [...ms].reverse()) { if (rep) tr.replaceWith(m.from, m.to, ed.schema.text(rep, ed.state.doc.resolve(m.from).marks())); else tr.delete(m.from, m.to); }
  ed.view.dispatch(tr); s.cur = 0; refreshFind(ed);
  return ms.length;
}
