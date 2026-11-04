import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap';
import { docExtensions } from '@/components/crm/drive/doc-extensions';
import { mergeYState } from '@/lib/drive-server';

// Builds a live My Drive document from markdown, on the server — used by the Copilot (and the Drive API) to create documents with real
// content instead of an empty page. Markdown becomes TipTap JSON in the editor's own schema (so it renders exactly like a typed document),
// then a Yjs state, which is what a Drive document is stored as.

type Mark = { type: string; attrs?: Record<string, unknown> };
type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: Mark[] };

const MAX_MARKDOWN = 60_000;

/** Inline markdown (**bold**, *italic*, ~~strike~~, `code`, [text](https://…)) → text nodes with marks. */
function inline(src: string): PMNode[] {
  const out: PMNode[] = [];
  const push = (text: string, marks: Mark[]) => { if (text) out.push({ type: 'text', text, ...(marks.length ? { marks } : {}) }); };
  const walk = (s: string, marks: Mark[]) => {
    const re = /(\*\*|__)(.+?)\1|(\*|_)([^*_\s](?:[^*_]*[^*_\s])?)\3|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
    let rest = s;
    for (;;) {
      const m = re.exec(rest);
      if (!m) { push(rest, marks); return; }
      push(rest.slice(0, m.index), marks);
      if (m[1]) walk(m[2], [...marks, { type: 'bold' }]);
      else if (m[3]) walk(m[4], [...marks, { type: 'italic' }]);
      else if (m[5] !== undefined) walk(m[5], [...marks, { type: 'strike' }]);
      else if (m[6] !== undefined) push(m[6], [...marks, { type: 'code' }]);
      else walk(m[7], [...marks, { type: 'link', attrs: { href: m[8] } }]);
      rest = rest.slice(m.index + m[0].length);
    }
  };
  walk(src, []);
  return out;
}

const para = (text: string): PMNode => { const c = inline(text.trim()); return c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' }; };

const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const indentOf = (s: string) => s.replace(/\t/g, '    ').match(/^ */)![0].length;

/** A (possibly nested) list starting at lines[i]; returns the list node and the index after it. */
function parseList(lines: string[], i: number): [PMNode, number] {
  const base = indentOf(lines[i]);
  const first = BULLET.exec(lines[i]);
  const ordered = !first;
  const items: PMNode[] = [];
  let task = false;
  while (i < lines.length) {
    const line = lines[i];
    const m = ordered ? ORDERED.exec(line) : BULLET.exec(line);
    if (!m || indentOf(line) !== base) break;
    let text = m[2];
    const t = !ordered ? TASK.exec(text) : null;
    if (t) { task = true; text = t[2]; }
    const children: PMNode[] = [para(text)];
    i++;
    // Deeper-indented lines belong to this item: nested lists, or a wrapped continuation of its text.
    while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > base) {
      if (BULLET.test(lines[i]) || ORDERED.test(lines[i])) { const [sub, next] = parseList(lines, i); children.push(sub); i = next; }
      else { const p = children[0]; p.content = [...(p.content ?? []), ...inline(` ${lines[i].trim()}`)]; i++; }
    }
    items.push(t ? { type: 'taskItem', attrs: { checked: t[1].toLowerCase() === 'x' }, content: children } : { type: 'listItem', content: children });
  }
  return [{ type: ordered ? 'orderedList' : task ? 'taskList' : 'bulletList', content: items }, i];
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const isTableSep = (row: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row) && row.includes('-');

export function markdownToDocJson(markdown: string): PMNode {
  const lines = markdown.replace(/\r\n?/g, '\n').slice(0, MAX_MARKDOWN).split('\n');
  const blocks: PMNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = /^\s*```/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: 'codeBlock', content: body.length ? [{ type: 'text', text: body.join('\n') }] : undefined });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { blocks.push({ type: 'heading', attrs: { level: Math.min(3, h[1].length) }, content: inline(h[2]) }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: 'horizontalRule' }); i++; continue; }
    if (BULLET.test(line) || ORDERED.test(line)) { const [list, next] = parseList(lines, i); blocks.push(list); i = next; continue; }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'blockquote', content: q.join('\n').split(/\n\s*\n/).map(p => para(p.replace(/\n/g, ' '))) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      const width = head.length;
      const row = (cs: string[], type: 'tableHeader' | 'tableCell'): PMNode => ({
        type: 'tableRow',
        content: Array.from({ length: width }, (_, k) => ({ type, content: [para(cs[k] ?? '')] })),
      });
      blocks.push({ type: 'table', content: [row(head, 'tableHeader'), ...rows.map(r => row(r, 'tableCell'))] });
      continue;
    }
    // A paragraph runs until a blank line or the start of another block; its lines are joined with spaces.
    const p: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !BULLET.test(lines[i]) && !ORDERED.test(lines[i]) && !/^\s*>/.test(lines[i])) p.push(lines[i++].trim());
    blocks.push(para(p.join(' ')));
  }
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}

let schemaCache: ReturnType<typeof getSchema> | null = null;
const schema = () => (schemaCache ??= getSchema(docExtensions()));

/** Markdown → a throwaway Y.Doc holding the converted blocks in its 'default' fragment (for splicing into an existing document). The caller destroys it. */
export function markdownToYDoc(markdown: string): Y.Doc {
  const json = markdownToDocJson(markdown);
  schema().nodeFromJSON(json).check();
  return prosemirrorJSONToYDoc(schema(), json, 'default');
}

/**
 * Markdown → the stored form of a Drive document: base64 Yjs state + the plain text used for search. Throws if the result doesn't fit the
 * editor's schema, so a bad conversion can never be saved as a document the editor can't open.
 */
export function markdownToDriveState(markdown: string, opts: { letterhead?: boolean } = {}): { ystate: string; text: string } {
  return jsonToDriveState(markdownToDocJson(markdown), opts);
}

/** The same, from editor JSON (a Word file converted to a document goes through here). Throws if it doesn't fit the schema. */
export function jsonToDriveState(json: PMNode, opts: { letterhead?: boolean } = {}): { ystate: string; text: string } {
  schema().nodeFromJSON(json).check();
  const ydoc = prosemirrorJSONToYDoc(schema(), json, 'default');
  try {
    if (opts.letterhead) ydoc.getMap('meta').set('letterhead', true);
    const b64 = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64');
    const { state, text } = mergeYState(null, b64);
    return { ystate: state, text };
  } finally { ydoc.destroy(); }
}
