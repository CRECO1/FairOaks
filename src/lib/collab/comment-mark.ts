import { Mark, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

/**
 * The highlight a comment hangs on. It is an ordinary mark stored IN the document (so it syncs live, survives edits, and moves with
 * its words); its `commentId` is the id of the row in crm_drive_comments. `excludes: ''` lets two comments overlap the same words.
 */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: el => el.getAttribute('data-comment-id'),
        renderHTML: attrs => (attrs.commentId ? { 'data-comment-id': attrs.commentId } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-comment-id]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes({ class: 'comment-hl' }, HTMLAttributes), 0]; },
});

/** Take a comment's highlight off the document (used when it is resolved or deleted). */
export function removeCommentMark(editor: Editor, commentId: string) {
  const { state, view } = editor;
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mk = node.marks.find(m => m.type.name === 'comment' && m.attrs.commentId === commentId);
    if (mk) tr.removeMark(pos, pos + node.nodeSize, mk);
  });
  if (tr.docChanged) view.dispatch(tr);
}

/** Where a comment's highlight is in the document right now (the first stretch of text that carries it), or null. */
export function findCommentRange(editor: Editor, commentId: string): { from: number; to: number } | null {
  let from = -1, to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.marks.some(m => m.type.name === 'comment' && m.attrs.commentId === commentId)) return;
    if (from < 0) from = pos;
    to = pos + node.nodeSize;
  });
  return from < 0 ? null : { from, to };
}
