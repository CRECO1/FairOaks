import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { BlockFormat, Subscript, Superscript } from '@/lib/collab/block-format';
import { CommentMark } from '@/lib/collab/comment-mark';
import { SuggestAdd, SuggestDel } from '@/lib/collab/suggest-marks';
import { ImageNode } from '@/lib/collab/image-node';
import { CrmRefNode } from '@/lib/collab/crm-ref-node';

/** The document schema — shared by the live editor and the read-only version preview so both render identically. */
export const docExtensions = () => [
  // Yjs owns undo/redo. TipTap 3's StarterKit also bundles Underline + Link (configured below) and a trailing-empty-paragraph node, which would rewrite shared docs.
  StarterKit.configure({ undoRedo: false, link: false, underline: false, trailingNode: false, heading: { levels: [1, 2, 3] } }),
  Underline,
  Highlight.configure({ multicolor: true }),
  Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  // font family / size / text colour live on one `textStyle` mark; the Word and PDF writers read it (see doc-docx.ts, doc-pdf.ts)
  TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
  BlockFormat, Subscript, Superscript,
  CommentMark, SuggestAdd, SuggestDel, ImageNode, CrmRefNode,
];
