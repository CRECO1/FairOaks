import { NextRequest, NextResponse } from 'next/server';
import * as Y from 'yjs';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext, mergeYState } from '@/lib/drive-server';
import { applyDocOp, broadcastDocUpdate, type DocOp } from '@/lib/drive-edit';
import { logDocEvent, mirrorDocToFeeds } from '@/lib/drive-events';

// Server-side edits to an existing live document (the Copilot uses these).
//   GET  → { title, text, words, version }       the document's current plain text, to read before editing
//   POST { op: 'append' | 'replace_text' | 'rewrite', markdown?, find?, replace? }
// Anyone who can open a document may edit it (same as in the editor). A "Before Copilot edit" version is saved first so the change can
// be undone from Version history; the edit is applied as a CRDT change (merges with live typing), logged in the activity log, and pushed
// to anyone who has the document open.

export const maxDuration = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const { data: seen } = await dc.userDb.from('crm_drive_docs').select('id,title,trashed_at,version').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!seen || seen.trashed_at) return notFound('That document is not available');
  const { data } = await dc.admin.from('crm_drive_docs').select('content_text').eq('id', id).single();
  const text = ((data?.content_text as string | null) ?? '').slice(0, 40_000);
  return NextResponse.json({ title: seen.title, text, words: text.split(/\s+/).filter(Boolean).length, version: seen.version });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const b = await req.json().catch(() => ({})) as { op?: string; markdown?: string; find?: string; replace?: string };
  const op: DocOp | null = b.op === 'append' ? { op: 'append', markdown: String(b.markdown ?? '') }
    : b.op === 'rewrite' ? { op: 'rewrite', markdown: String(b.markdown ?? '') }
    : b.op === 'replace_text' ? { op: 'replace_text', find: String(b.find ?? ''), replace: String(b.replace ?? '') } : null;
  if (!op) return NextResponse.json({ error: 'op must be append, replace_text or rewrite' }, { status: 400 });

  const { data: seen } = await dc.userDb.from('crm_drive_docs').select('id,title,trashed_at').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!seen || seen.trashed_at) return notFound('That document is not available');

  let snapped = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: cur } = await dc.admin.from('crm_drive_docs').select('ystate,version,content_text').eq('id', id).single();
    if (!cur) return NextResponse.json({ error: 'Could not read the document' }, { status: 500 });
    const ydoc = new Y.Doc();
    try {
      if (cur.ystate) Y.applyUpdate(ydoc, new Uint8Array(Buffer.from(cur.ystate as string, 'base64')));
      const before = Y.encodeStateVector(ydoc);
      const r = applyDocOp(ydoc, op);
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: 422 });
      const update = Y.encodeStateAsUpdate(ydoc, before);
      const merged = mergeYState(cur.ystate as string | null, Buffer.from(update).toString('base64'));

      // A restore point first (once), so a Copilot edit can always be undone from Version history.
      if (!snapped && cur.ystate) {
        await dc.admin.from('crm_drive_versions').insert({ doc_id: id, ystate: cur.ystate, content_text: cur.content_text ?? '', size: (cur.ystate as string).length, kind: 'manual', label: 'Before Copilot edit', created_by: dc.ctx.userId });
        snapped = true;
      }
      const { data: ok, error } = await dc.admin.from('crm_drive_docs')
        .update({ ystate: merged.state, content_text: merged.text, version: (cur.version as number) + 1, updated_by: dc.ctx.userId, updated_at: new Date().toISOString() })
        .eq('id', id).eq('version', cur.version).select('version');
      if (error) return NextResponse.json({ error: 'Could not save the edit' }, { status: 500 });
      if (ok && ok.length) {
        const charsBefore = ((cur.content_text as string | null) ?? '').length;
        await logDocEvent(dc.admin, { docId: id, bu: dc.bu, actor: dc.ctx.userId, kind: 'edited', detail: { via: 'copilot', op: op.op, chars_before: charsBefore, chars_after: merged.text.length, words_after: merged.text.split(/\s+/).filter(Boolean).length } });
        const dl = merged.text.length - charsBefore;
        await mirrorDocToFeeds(dc.admin, { docId: id, actor: dc.ctx.userId, text: (title, who) => `Live document “${title}” edited by ${who} using the Copilot — ${op.op === 'rewrite' ? 'rewritten' : op.op === 'append' ? `added about ${Math.max(0, dl).toLocaleString()} characters` : 'one passage replaced'}` });
        await broadcastDocUpdate(id, update);
        return NextResponse.json({ ok: true, version: ok[0].version, chars_before: charsBefore, chars_after: merged.text.length });
      }
      // someone saved in between: re-read and re-apply on top of theirs
    } finally { ydoc.destroy(); }
  }
  return NextResponse.json({ error: 'The document is being edited right now — try again in a moment' }, { status: 409 });
}
