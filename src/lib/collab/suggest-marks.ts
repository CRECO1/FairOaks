import { Extension, Mark } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// Suggesting mode: edits made while it is on are recorded IN the document as marks — typed text carries `suggestAdd`, "deleted" text
// stays in place carrying `suggestDel` (struck through) — so they sync live and anyone can Accept (keep) or Reject (undo) them.
// Only typing, Backspace/Delete, paste and cut are tracked; formatting and structure changes (headings, lists, tables) apply directly.

const attrs = () => ({
  author: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-author') ?? '', renderHTML: (a: Record<string, unknown>) => (typeof a.author === 'string' && a.author ? { 'data-author': a.author.slice(0, 120) } : {}) },
  authorId: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-author-id') ?? '', renderHTML: (a: Record<string, unknown>) => (typeof a.authorId === 'string' && a.authorId ? { 'data-author-id': a.authorId.slice(0, 64) } : {}) },
});
// renderHTML builds the attributes by hand (never merging shared document state wholesale — see comment-mark.ts).
const markSpec = (name: string, cls: string, flag: string) => Mark.create({
  name, inclusive: false, excludes: '',
  addAttributes: attrs,
  parseHTML() { return [{ tag: `span[${flag}]` }]; },
  renderHTML({ HTMLAttributes }) {
    const by = typeof HTMLAttributes?.['data-author'] === 'string' ? (HTMLAttributes['data-author'] as string).slice(0, 120) : '';
    return ['span', { class: cls, [flag]: '1', title: `${cls === 'sg-add' ? 'Suggested addition' : 'Suggested deletion'}${by ? ` by ${by}` : ''}` }, 0];
  },
});
export const SuggestAdd = markSpec('suggestAdd', 'sg-add', 'data-sg-add');
export const SuggestDel = markSpec('suggestDel', 'sg-del', 'data-sg-del');

export interface SuggestStorage { on: boolean; author: string; authorId: string }
const key = new PluginKey('suggestTracking');

/** Tracking for this person's editor: reads editor.storage.suggest.{on,author,authorId}. */
export const SuggestTracking = Extension.create<Record<string, never>, SuggestStorage>({
  name: 'suggest',
  addStorage() { return { on: false, author: '', authorId: '' }; },
  addProseMirrorPlugins() {
    const ed = this.editor;
    const st = () => ed.storage.suggest as SuggestStorage;
    const on = () => st().on && !!st().authorId;
    const addMark = () => ed.schema.marks.suggestAdd.create({ author: st().author, authorId: st().authorId });
    const delMark = () => ed.schema.marks.suggestDel.create({ author: st().author, authorId: st().authorId });

    /** "Delete" [from,to): the person's own suggested text really goes; anything else is struck through. */
    const track = (tr: Transaction, from: number, to: number) => {
      const segs: Array<{ from: number; to: number; own: boolean; del: boolean }> = [];
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
        if (b <= a) return;
        const add = node.marks.find(m => m.type.name === 'suggestAdd');
        segs.push({ from: a, to: b, own: !!add && add.attrs.authorId === st().authorId, del: node.marks.some(m => m.type.name === 'suggestDel') });
      });
      for (const g of segs.reverse()) {
        if (g.own) tr.delete(g.from, g.to);
        else if (!g.del) tr.addMark(g.from, g.to, delMark());
      }
    };
    const insert = (view: EditorView, text: string, from: number, to: number) => {
      const { state } = view;
      const tr = state.tr;
      if (to > from) track(tr, from, to);
      const at = tr.mapping.map(to, 1);   // after any struck text, so new text follows what it replaces
      const base = (state.storedMarks ?? state.doc.resolve(from).marks()).filter(m => m.type.name !== 'suggestAdd' && m.type.name !== 'suggestDel');
      tr.insert(at, state.schema.text(text, [...base, addMark()]));
      tr.setSelection(TextSelection.create(tr.doc, at + text.length));
      view.dispatch(tr.scrollIntoView());
    };
    return [new Plugin({
      key,
      props: {
        handleTextInput: (view, from, to, text) => { if (!on() || !text) return false; insert(view, text, from, to); return true; },
        handlePaste: (view, event) => {
          if (!on()) return false;
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (!text) return false;
          const { from, to } = view.state.selection;
          insert(view, text.replace(/\r\n?/g, '\n').replace(/\n+/g, ' '), from, to);
          return true;
        },
        handleKeyDown: (view, ev) => {
          if (!on() || (ev.key !== 'Backspace' && ev.key !== 'Delete') || ev.metaKey || ev.ctrlKey || ev.altKey) return false;
          const { state } = view;
          const { from, to, empty, $from } = state.selection;
          const tr = state.tr;
          if (!empty) { track(tr, from, to); tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(to, 1))); view.dispatch(tr); return true; }
          const back = ev.key === 'Backspace';
          if (back ? $from.parentOffset === 0 : $from.parentOffset >= $from.parent.content.size) return false;   // joining paragraphs is not tracked
          const a = back ? from - 1 : from, b = back ? from : from + 1;
          if (!state.doc.textBetween(a, b)) return false;
          track(tr, a, b);
          // the cursor steps over struck text, or stays put when the character really went
          const gone = tr.doc.content.size < state.doc.content.size;
          const pos = back ? (gone ? a : a) : (gone ? from : b);
          tr.setSelection(TextSelection.create(tr.doc, Math.max(1, Math.min(pos, tr.doc.content.size - 1))));
          view.dispatch(tr);
          return true;
        },
        handleDOMEvents: {
          cut: (view, event) => {
            if (!on()) return false;
            const { from, to, empty } = view.state.selection;
            if (empty) return false;
            (event as ClipboardEvent).clipboardData?.setData('text/plain', view.state.doc.textBetween(from, to, ' '));
            event.preventDefault();
            const tr = view.state.tr; track(tr, from, to); tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(to, 1))); view.dispatch(tr);
            return true;
          },
        },
      },
    })];
  },
});

export interface Suggestion { type: 'add' | 'del'; from: number; to: number; text: string; author: string; authorId: string }

/** Every pending suggestion, adjacent runs by the same person merged. */
export function listSuggestions(editor: Editor): Suggestion[] {
  const out: Suggestion[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      const type = m.type.name === 'suggestAdd' ? 'add' : m.type.name === 'suggestDel' ? 'del' : null;
      if (!type) continue;
      const last = out[out.length - 1];
      const text = node.text ?? '';
      if (last && last.type === type && last.authorId === m.attrs.authorId && last.to === pos) { last.to = pos + node.nodeSize; last.text += text; }
      else out.push({ type, from: pos, to: pos + node.nodeSize, text, author: String(m.attrs.author || 'Someone'), authorId: String(m.attrs.authorId || '') });
    }
  });
  return out;
}

/** Accept = keep the change (added text becomes ordinary, struck text is removed); reject = undo it. */
export function resolveSuggestions(editor: Editor, list: Suggestion[], accept: boolean) {
  const { state, view } = editor;
  const tr = state.tr;
  for (const s of [...list].sort((a, b) => b.from - a.from)) {
    const keep = s.type === 'add' ? accept : !accept;   // does the text stay in the document?
    if (keep) tr.removeMark(s.from, s.to, s.type === 'add' ? state.schema.marks.suggestAdd : state.schema.marks.suggestDel);
    else tr.delete(s.from, s.to);
  }
  view.dispatch(tr);
}
