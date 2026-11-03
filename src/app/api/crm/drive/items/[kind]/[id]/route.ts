import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound, forbidden } from '@/lib/crm-auth';
import { driveContext, descendantFolderIds, type DriveContext } from '@/lib/drive-server';
import { DOC_COLS, FOLDER_COLS } from '@/lib/drive-types';

// Rename / move / share / trash / restore / permanently delete one folder or document.
//
// Rules: anyone who can SEE an item may rename, move and trash it (it is a shared workspace, like a Drive). Only its owner
// or an admin may change who it is shared with, move it out of a deal's folder, or delete it for good.
// Visibility is stored on every item, so moving or sharing a folder cascades to everything inside it.

type Kind = 'folder' | 'doc';
type Row = { id: string; created_by: string | null; visibility: 'team' | 'private'; shared_with: string[]; deal_id: string | null; trashed_at: string | null; parent_id?: string | null; folder_id?: string | null };

const tableOf = (k: string) => (k === 'folder' ? 'crm_drive_folders' : k === 'doc' ? 'crm_drive_docs' : null);

async function loadVisible(dc: DriveContext, kind: Kind, id: string): Promise<Row | null> {
  const t = tableOf(kind)!;
  const { data } = await dc.userDb.from(t).select(kind === 'folder' ? FOLDER_COLS : DOC_COLS).eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  return (data as unknown as Row | null) ?? null;
}

/** Folder ids in a folder's subtree (itself included) and the documents inside them. */
async function subtree(dc: DriveContext, folderId: string) {
  const { data } = await dc.admin.from('crm_drive_folders').select('id,parent_id').eq('business_unit', dc.bu);
  const folderIds = [folderId, ...descendantFolderIds((data ?? []) as Array<{ id: string; parent_id: string | null }>, folderId)];
  const { data: docs } = await dc.admin.from('crm_drive_docs').select('id').eq('business_unit', dc.bu).in('folder_id', folderIds);
  return { folderIds, docIds: ((docs ?? []) as Array<{ id: string }>).map(d => d.id) };
}

async function applyToSubtree(dc: DriveContext, folderId: string, patch: Record<string, unknown>) {
  const { folderIds, docIds } = await subtree(dc, folderId);
  const stamp = { ...patch, updated_at: new Date().toISOString() };
  await dc.admin.from('crm_drive_folders').update(stamp).in('id', folderIds);
  if (docIds.length) await dc.admin.from('crm_drive_docs').update(stamp).in('id', docIds);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { kind: k, id } = await params;
  if (!tableOf(k)) return notFound();
  const kind = k as Kind;
  const t = tableOf(kind)!;
  const row = await loadVisible(dc, kind, id);
  if (!row) return notFound();
  const canManage = dc.isAdmin || row.created_by === dc.ctx.userId;
  const body = await req.json().catch(() => ({})) as {
    name?: string; title?: string;
    move?: { parent_id: string | null };
    share?: { visibility: 'team' | 'private'; shared_with?: string[] };
    trash?: boolean;
  };
  const now = new Date().toISOString();

  // Rename
  const label = kind === 'folder' ? body.name : body.title;
  if (label !== undefined) {
    const v = label.trim().slice(0, kind === 'folder' ? 200 : 300);
    if (!v) return NextResponse.json({ error: 'Give it a name' }, { status: 400 });
    const { error } = await dc.admin.from(t).update(kind === 'folder' ? { name: v, updated_at: now } : { title: v, updated_by: dc.ctx.userId, updated_at: now }).eq('id', id);
    if (error) return NextResponse.json({ error: 'Could not rename' }, { status: 500 });
  }

  // Move
  if (body.move) {
    const target = body.move.parent_id || null;
    let adopt: { visibility: 'team' | 'private'; shared_with: string[]; deal_id: string | null } | null = null;
    if (target) {
      if (kind === 'folder') {
        const { data } = await dc.admin.from('crm_drive_folders').select('id,parent_id').eq('business_unit', dc.bu);
        if (target === id || descendantFolderIds((data ?? []) as Array<{ id: string; parent_id: string | null }>, id).includes(target)) {
          return NextResponse.json({ error: "A folder can't be moved into itself" }, { status: 400 });
        }
      }
      const { data: dest } = await dc.userDb.from('crm_drive_folders').select('id,visibility,shared_with,deal_id,trashed_at').eq('id', target).eq('business_unit', dc.bu).maybeSingle();
      if (!dest || dest.trashed_at) return notFound('That folder is not available');
      adopt = { visibility: dest.visibility, shared_with: dest.shared_with ?? [], deal_id: dest.deal_id };
      if (row.deal_id !== adopt.deal_id && !canManage) return forbidden('Only the owner or an admin can move this out of a deal folder');
    }
    const place = kind === 'folder' ? { parent_id: target } : { folder_id: target };
    const { error } = await dc.admin.from(t).update({ ...place, updated_at: now }).eq('id', id);
    if (error) return NextResponse.json({ error: 'Could not move' }, { status: 500 });
    if (adopt) {
      if (kind === 'folder') await applyToSubtree(dc, id, adopt);
      else await dc.admin.from('crm_drive_docs').update({ ...adopt, updated_at: now }).eq('id', id);
    }
  }

  // Share (owner / admin)
  if (body.share) {
    if (!canManage) return forbidden('Only the owner or an admin can change who this is shared with');
    const visibility = body.share.visibility === 'private' ? 'private' : 'team';
    let shared: string[] = [];
    if (visibility === 'private' && body.share.shared_with?.length) {
      const { data } = await dc.admin.from('crm_profiles').select('id').eq('business_unit', dc.bu).in('id', body.share.shared_with.slice(0, 50));
      shared = ((data ?? []) as Array<{ id: string }>).map(p => p.id);
    }
    const patch = { visibility, shared_with: shared };
    if (kind === 'folder') await applyToSubtree(dc, id, patch);
    else await dc.admin.from('crm_drive_docs').update({ ...patch, updated_at: now }).eq('id', id);
  }

  // Trash / restore. A folder stamps everything inside it with one instant so restoring brings back exactly that branch.
  if (body.trash !== undefined) {
    if (body.trash) {
      if (kind === 'folder') await applyToSubtree(dc, id, { trashed_at: now });
      else await dc.admin.from('crm_drive_docs').update({ trashed_at: now, updated_at: now }).eq('id', id);
    } else {
      // Put it back at the top level when the folder it lived in is itself in the trash.
      const parentId = kind === 'folder' ? row.parent_id : row.folder_id;
      let orphan = false;
      if (parentId) {
        const { data: p } = await dc.admin.from('crm_drive_folders').select('trashed_at').eq('id', parentId).maybeSingle();
        orphan = !p || !!p.trashed_at;
      }
      const place = orphan ? (kind === 'folder' ? { parent_id: null } : { folder_id: null }) : {};
      if (kind === 'folder') {
        const { folderIds, docIds } = await subtree(dc, id);
        const stamp = row.trashed_at;
        if (stamp) {
          await dc.admin.from('crm_drive_folders').update({ trashed_at: null, updated_at: now }).in('id', folderIds).eq('trashed_at', stamp);
          if (docIds.length) await dc.admin.from('crm_drive_docs').update({ trashed_at: null, updated_at: now }).in('id', docIds).eq('trashed_at', stamp);
        }
        if (orphan) await dc.admin.from('crm_drive_folders').update(place).eq('id', id);
      } else {
        await dc.admin.from('crm_drive_docs').update({ trashed_at: null, updated_at: now, ...place }).eq('id', id);
      }
    }
  }

  const fresh = await loadVisible(dc, kind, id);
  return NextResponse.json({ ok: true, item: fresh });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { kind: k, id } = await params;
  if (!tableOf(k)) return notFound();
  const kind = k as Kind;
  const row = await loadVisible(dc, kind, id);
  if (!row) return notFound();
  if (!row.trashed_at) return NextResponse.json({ error: 'Move it to the trash first' }, { status: 400 });
  if (!(dc.isAdmin || row.created_by === dc.ctx.userId)) return forbidden('Only the owner or an admin can delete this for good');
  const { error } = await dc.admin.from(tableOf(kind)!).delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
