import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext, mergeYState } from '@/lib/drive-server';
import { DOC_COLS } from '@/lib/drive-types';
import { logDocEdit } from '@/lib/drive-events';

// Load a live document (metadata + its merged Yjs state) and save edits back.
// Saves are MERGES: the client sends the Yjs update(s) since its last save, the server applies them onto the stored state
// (Yjs updates commute) and writes it with an optimistic version check, so two people saving at once never overwrite each other.

export const maxDuration = 30;

// Version history: take an automatic snapshot of what was just saved when the last one is 10+ minutes old (so a long editing
// session leaves a trail, not a row per keystroke), and keep only the newest 60 automatic ones. Best effort — a failure here must
// never fail the save itself (and the history table may not exist yet on an older database).
async function autoSnapshot(admin: SupabaseClient, docId: string, merged: { state: string; text: string }, userId: string) {
  try {
    if (!merged.text.trim()) return;
    const { data: last } = await admin.from('crm_drive_versions').select('created_at').eq('doc_id', docId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.created_at as string).getTime() < 10 * 60_000) return;
    await admin.from('crm_drive_versions').insert({ doc_id: docId, ystate: merged.state, content_text: merged.text, size: merged.state.length, kind: 'auto', created_by: userId });
    const { data: autos } = await admin.from('crm_drive_versions').select('id').eq('doc_id', docId).eq('kind', 'auto').order('created_at', { ascending: false }).range(60, 200);
    if (autos?.length) await admin.from('crm_drive_versions').delete().in('id', autos.map(a => a.id as string));
  } catch (e) { console.error('[drive] auto snapshot', e); }
}
const MAX_UPDATE_B64 = 4_000_000; // ~3 MB of binary, under the platform's request limit

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  const { data, error } = await dc.userDb.from('crm_drive_docs').select(`${DOC_COLS},ystate`).eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (error || !data) return notFound('That document is not available');
  const { ystate, ...doc } = data as unknown as Record<string, unknown> & { ystate: string | null; trashed_at: string | null };
  if (doc.trashed_at) return NextResponse.json({ error: 'That document is in the trash', trashed: true, doc }, { status: 410 });
  return NextResponse.json({ doc, state: ystate ?? null });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { update?: string };
  if (typeof body.update !== 'string' || !body.update) return NextResponse.json({ error: 'update required' }, { status: 400 });
  if (body.update.length > MAX_UPDATE_B64) return NextResponse.json({ error: 'That change is too large to save in one go' }, { status: 413 });

  // Must be able to see the doc (RLS) to write it.
  const { data: seen } = await dc.userDb.from('crm_drive_docs').select('id,trashed_at').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!seen) return notFound('That document is not available');
  if (seen.trashed_at) return NextResponse.json({ error: 'That document is in the trash' }, { status: 410 });

  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: cur, error } = await dc.admin.from('crm_drive_docs').select('ystate,version,content_text').eq('id', id).single();
    if (error || !cur) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
    let merged: { state: string; text: string };
    try { merged = mergeYState(cur.ystate as string | null, body.update); }
    catch { return NextResponse.json({ error: 'That change could not be read' }, { status: 400 }); }
    const { data: ok, error: upErr } = await dc.admin.from('crm_drive_docs')
      .update({ ystate: merged.state, content_text: merged.text, version: (cur.version as number) + 1, updated_by: dc.ctx.userId, updated_at: new Date().toISOString() })
      .eq('id', id).eq('version', cur.version).select('version');
    if (upErr) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
    if (ok && ok.length) {
      await autoSnapshot(dc.admin, id, merged, dc.ctx.userId);
      // The activity log: only a real change counts (a no-op save, e.g. a reconnect, isn't an edit).
      if (merged.state !== cur.ystate) await logDocEdit(dc.admin, { docId: id, bu: dc.bu, actor: dc.ctx.userId, charsBefore: ((cur.content_text as string | null) ?? '').length, charsAfter: merged.text.length, wordsAfter: merged.text.split(/\s+/).filter(Boolean).length });
      return NextResponse.json({ ok: true, version: ok[0].version });
    }
    // Someone else saved between our read and write — merge onto their result and try again.
  }
  return NextResponse.json({ error: 'Busy — try again' }, { status: 409 });
}
