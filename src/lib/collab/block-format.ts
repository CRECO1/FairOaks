import { Extension, Mark, mergeAttributes } from '@tiptap/core';

/** Paragraph / heading indent (levels of 0.5") and line spacing — block attributes stored in the shared doc. */
export const MAX_INDENT = 8;
export const LINE_SPACINGS = [1, 1.15, 1.5, 2] as const;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockFormat: {
      indentBlock: () => ReturnType;
      outdentBlock: () => ReturnType;
      setLineSpacing: (v: number | null) => ReturnType;
    };
  }
}

const TYPES = ['paragraph', 'heading'];

export const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes() {
    return [{
      types: TYPES,
      attributes: {
        indent: {
          default: 0,
          parseHTML: el => Math.min(MAX_INDENT, Math.max(0, parseInt(el.getAttribute('data-indent') ?? '0', 10) || 0)),
          renderHTML: attrs => (attrs.indent ? { 'data-indent': String(attrs.indent), style: `margin-left:${Number(attrs.indent) * 0.5}in` } : {}),
        },
        lineSpacing: {
          default: null,
          parseHTML: el => { const v = parseFloat(el.getAttribute('data-line-spacing') ?? ''); return Number.isFinite(v) && v > 0 ? v : null; },
          renderHTML: attrs => (attrs.lineSpacing ? { 'data-line-spacing': String(attrs.lineSpacing), style: `line-height:${attrs.lineSpacing}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    const bump = (d: number) => () => ({ state, tr, dispatch }: { state: import('@tiptap/pm/state').EditorState; tr: import('@tiptap/pm/state').Transaction; dispatch?: (t: import('@tiptap/pm/state').Transaction) => void }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!TYPES.includes(node.type.name)) return;
        const next = Math.min(MAX_INDENT, Math.max(0, (Number(node.attrs.indent) || 0) + d));
        if (next !== (Number(node.attrs.indent) || 0)) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next }); changed = true; }
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return {
      indentBlock: bump(1),
      outdentBlock: bump(-1),
      setLineSpacing: (v: number | null) => ({ state, tr, dispatch }) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (TYPES.includes(node.type.name)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineSpacing: v });
        });
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});

export const Subscript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML() { return [{ tag: 'sub' }, { style: 'vertical-align', getAttrs: v => (v === 'sub' ? null : false) }]; },
  renderHTML({ HTMLAttributes }) { return ['sub', mergeAttributes(HTMLAttributes), 0]; },
  addKeyboardShortcuts() { return { 'Mod-,': () => this.editor.commands.toggleMark(this.name) }; },
});

export const Superscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML() { return [{ tag: 'sup' }, { style: 'vertical-align', getAttrs: v => (v === 'super' ? null : false) }]; },
  renderHTML({ HTMLAttributes }) { return ['sup', mergeAttributes(HTMLAttributes), 0]; },
  addKeyboardShortcuts() { return { 'Mod-.': () => this.editor.commands.toggleMark(this.name) }; },
});
