import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext, mergeYState } from '@/lib/drive-server';
import { DOC_COLS } from '@/lib/drive-types';

// Load a live document (metadata + its merged Yjs state) and save edits back.
// Saves are MERGES: the client sends the Yjs update(s) since its last save, the server applies them onto the stored state
// (Yjs updates commute) and writes it with an optimistic version check, so two people saving at once never overwrite each other.

export const maxDuration = 30;
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
    const { data: cur, error } = await dc.admin.from('crm_drive_docs').select('ystate,version').eq('id', id).single();
    if (error || !cur) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
    let merged: { state: string; text: string };
    try { merged = mergeYState(cur.ystate as string | null, body.update); }
    catch { return NextResponse.json({ error: 'That change could not be read' }, { status: 400 }); }
    const { data: ok, error: upErr } = await dc.admin.from('crm_drive_docs')
      .update({ ystate: merged.state, content_text: merged.text, version: (cur.version as number) + 1, updated_by: dc.ctx.userId, updated_at: new Date().toISOString() })
      .eq('id', id).eq('version', cur.version).select('version');
    if (upErr) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
    if (ok && ok.length) return NextResponse.json({ ok: true, version: ok[0].version });
    // Someone else saved between our read and write — merge onto their result and try again.
  }
  return NextResponse.json({ error: 'Busy — try again' }, { status: 409 });
}
