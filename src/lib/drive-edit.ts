import * as Y from 'yjs';
import { markdownToYDoc } from '@/lib/drive-markdown';

// Edits to an EXISTING My Drive document, made on the server (the Copilot): add text at the end, replace one passage, or rewrite the whole
// document. They are applied to the stored Yjs state as ordinary CRDT operations, so they merge with anything people are typing.

export type DocOp =
  | { op: 'append'; markdown: string }
  | { op: 'replace_text'; find: string; replace: string }
  | { op: 'rewrite'; markdown: string };

const MAX = 60_000;

/** All the plain text runs of a document, in order (each Y.XmlText holds one block's inline content, formatting included). */
function textNodes(root: Y.XmlFragment | Y.XmlElement, out: Y.XmlText[] = []): Y.XmlText[] {
  for (const child of root.toArray()) {
    if (child instanceof Y.XmlText) out.push(child);
    else if (child instanceof Y.XmlElement) textNodes(child, out);
  }
  return out;
}
const plain = (t: Y.XmlText) => (t.toDelta() as Array<{ insert?: unknown }>).map(d => (typeof d.insert === 'string' ? d.insert : '\u0000')).join('');

/** Applies the edit to `ydoc`. Returns an error string when it can't be done safely (nothing is changed then). */
export function applyDocOp(ydoc: Y.Doc, op: DocOp): { error: string } | { ok: true } {
  const f = ydoc.getXmlFragment('default');
  if (op.op === 'replace_text') {
    const find = op.find;
    if (!find || find.length < 3) return { error: 'The text to replace is too short to find reliably — quote at least a few words exactly as they appear in the document.' };
    if (op.replace.length > MAX) return { error: 'The replacement is too long.' };
    const nodes = textNodes(f);
    const hits = nodes.flatMap(t => { const s = plain(t); const idx: number[] = []; for (let i = s.indexOf(find); i !== -1; i = s.indexOf(find, i + find.length)) idx.push(i); return idx.map(i => ({ t, i })); });
    if (hits.length === 0) return { error: 'That exact text is not in the document (check spelling and punctuation; a passage that spans two paragraphs or a table cell boundary can’t be replaced in one go — replace each paragraph separately).' };
    if (hits.length > 1) return { error: `That text appears ${hits.length} times — quote a longer passage so it is unique.` };
    const { t, i } = hits[0];
    // The new words take the formatting of the first character they replace (so a replaced bold word stays bold).
    let attrs: Record<string, unknown> | undefined;
    { let pos = 0; for (const seg of t.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>) { const len = typeof seg.insert === 'string' ? seg.insert.length : 1; if (i < pos + len) { attrs = seg.attributes; break; } pos += len; } }
    ydoc.transact(() => { t.delete(i, find.length); if (op.replace) t.insert(i, op.replace, attrs ?? {}); });
    return { ok: true };
  }
  const md = op.markdown ?? '';
  if (md.trim().length < 3) return { error: 'There is no text to add.' };
  if (md.length > MAX) return { error: 'That is too long to add in one go.' };
  let tmp: Y.Doc;
  try { tmp = markdownToYDoc(md); } catch { return { error: 'Could not turn that text into document content.' }; }
  try {
    const blocks = tmp.getXmlFragment('default').toArray().map(n => (n as Y.XmlElement).clone());
    ydoc.transact(() => {
      if (op.op === 'rewrite') f.delete(0, f.length);
      f.insert(f.length, blocks);
    });
  } finally { tmp.destroy(); }
  return { ok: true };
}

/**
 * Best effort: push the change to anyone who has the document open (Realtime private broadcast on the document's channel, same wire
 * format as the browser provider), so they see it appear instead of having to reload. If it fails nothing is lost — the change is saved.
 */
export async function broadcastDocUpdate(docId: string, update: Uint8Array): Promise<void> {
  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim(), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const d = Buffer.from(update).toString('base64');
    if (d.length > 120_000) return;   // a very large change: people pick it up when they next open the document
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: `drive-doc:${docId}`, event: 'y', private: true, payload: { t: 'update', from: 2147483000 + Math.floor(Math.random() * 400), d } }] }),
    });
  } catch (e) { console.error('[drive] live push', e); }
}
