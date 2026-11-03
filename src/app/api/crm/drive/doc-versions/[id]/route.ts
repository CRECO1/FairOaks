import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound, forbidden } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';
import { logDocEvent } from '@/lib/drive-events';
import type { DriveVersion } from '@/lib/drive-types';

// Version history of a live document.
//   GET            → the list (newest first), no document bytes
//   GET ?version=… → one version's saved state, to preview or restore it
//   POST { label?, kind? } → snapshot what is saved right now ("Save a version", or the safety copy taken before a restore)
//   DELETE ?version=… → remove one (its creator, or an admin)
// Automatic snapshots are taken by the save route (doc-state) at most once every 10 minutes of editing.
// Restoring is done in the editor (it replaces the live content, so everyone editing sees it and it is itself saved + versioned).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = 'id,doc_id,label,kind,size,created_by,created_at';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const { data: doc } = await dc.userDb.from('crm_drive_docs').select('id').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!doc) return notFound('That document is not available');
  const vid = req.nextUrl.searchParams.get('version');
  if (vid) {
    if (!UUID_RE.test(vid)) return notFound();
    const { data } = await dc.userDb.from('crm_drive_versions').select(`${COLS},ystate`).eq('id', vid).eq('doc_id', id).maybeSingle();
    if (!data) return notFound('That version is not available');
    const { ystate, ...meta } = data as unknown as DriveVersion & { ystate: string };
    return NextResponse.json({ version: meta, state: ystate });
  }
  const { data, error } = await dc.userDb.from('crm_drive_versions').select(COLS).eq('doc_id', id).order('created_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: 'Could not load the history' }, { status: 500 });
  return NextResponse.json({ versions: (data ?? []) as DriveVersion[] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const { data: seen } = await dc.userDb.from('crm_drive_docs').select('id,trashed_at').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!seen || seen.trashed_at) return notFound('That document is not available');
  const b = await req.json().catch(() => ({})) as { label?: string; kind?: string };
  const kind = b.kind === 'restore' ? 'restore' : 'manual';
  const { data: cur } = await dc.admin.from('crm_drive_docs').select('ystate,content_text').eq('id', id).single();
  if (!cur?.ystate) return NextResponse.json({ error: 'Nothing has been saved in this document yet' }, { status: 400 });
  const label = (b.label ?? '').trim().slice(0, 120) || (kind === 'restore' ? 'Before restore' : null);
  const { data, error } = await dc.admin.from('crm_drive_versions').insert({
    doc_id: id, ystate: cur.ystate, content_text: cur.content_text ?? '', size: (cur.ystate as string).length, label, kind, created_by: dc.ctx.userId,
  }).select(COLS).single();
  if (error || !data) return NextResponse.json({ error: 'Could not save the version' }, { status: 500 });
  await logDocEvent(dc.admin, { docId: id, bu: dc.bu, actor: dc.ctx.userId, kind: kind === 'restore' ? 'version_restored' : 'version_saved', detail: { label } });
  return NextResponse.json({ version: data as DriveVersion });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  const vid = req.nextUrl.searchParams.get('version') ?? '';
  if (!UUID_RE.test(id) || !UUID_RE.test(vid)) return notFound();
  const { data: v } = await dc.userDb.from('crm_drive_versions').select('id,created_by').eq('id', vid).eq('doc_id', id).maybeSingle();
  if (!v) return notFound('That version is not available');
  if (v.created_by !== dc.ctx.userId && !dc.isAdmin) return forbidden('Only the person who saved a version or an admin can delete it');
  await dc.admin.from('crm_drive_versions').delete().eq('id', vid);
  return NextResponse.json({ ok: true });
}
