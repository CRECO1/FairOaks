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
import { CommentMark } from '@/lib/collab/comment-mark';

/** The document schema — shared by the live editor and the read-only version preview so both render identically. */
export const docExtensions = () => [
  // Yjs owns undo/redo. TipTap 3's StarterKit also bundles Underline + Link (configured below) and a trailing-empty-paragraph node, which would rewrite shared docs.
  StarterKit.configure({ undoRedo: false, link: false, underline: false, trailingNode: false, heading: { levels: [1, 2, 3] } }),
  Underline,
  Highlight,
  Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  CommentMark,
];
