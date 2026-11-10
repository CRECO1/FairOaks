import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound, forbidden } from '@/lib/crm-auth';
import { driveContext, descendantFolderIds, liveCopies, type DriveContext } from '@/lib/drive-server';
import { logDocEvent } from '@/lib/drive-events';
import { pushBellNotification, senderName } from '@/lib/notify';
import { DOC_COLS, FILE_COLS, FOLDER_COLS, FORM_LINK_COLS } from '@/lib/drive-types';

// Rename / move / share / trash / restore / permanently delete one folder or document.
//
// Rules: anyone who can SEE an item may rename, move and trash it (it is a shared workspace, like a Drive). Only its owner
// or an admin may change who it is shared with, move it out of a deal's folder, or delete it for good.
// Visibility is stored on every item, so moving or sharing a folder cascades to everything inside it.

type Kind = 'folder' | 'doc' | 'file' | 'form';
type Row = { submission_id?: string; id: string; created_by: string | null; visibility: 'team' | 'private'; shared_with: string[]; deal_id: string | null; trashed_at: string | null; parent_id?: string | null; folder_id?: string | null };

const tableOf = (k: string) => (k === 'folder' ? 'crm_drive_folders' : k === 'doc' ? 'crm_drive_docs' : k === 'file' ? 'crm_drive_files' : k === 'form' ? 'crm_drive_forms' : null);
const colsOf = (k: Kind): string => (k === 'folder' ? FOLDER_COLS : k === 'doc' ? DOC_COLS : k === 'file' ? FILE_COLS : FORM_LINK_COLS);

async function loadVisible(dc: DriveContext, kind: Kind, id: string): Promise<Row | null> {
  const t = tableOf(kind)!;
  const { data } = await dc.userDb.from(t).select(colsOf(kind)).eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  const row = (data as unknown as Row | null) ?? null;
  // A filed form is always team-visible with no deal link — say so, so the shared rules below treat it like the other items.
  return row && kind === 'form' ? { ...row, visibility: 'team', shared_with: [], deal_id: null } : row;
}

/**
 * Folder ids in a folder's subtree (itself included) and the documents inside them.
 * Reads go through the CALLER's access (RLS) by default, so a folder action never reaches an item the caller cannot see; `all`
 * reads everything (only used to find out whether other people's items sit inside, before a permanent delete).
 * `mine` is the subset the caller created, which is all a non-admin may re-share.
 */
async function subtree(dc: DriveContext, folderId: string, opts?: { all?: boolean }) {
  const db = opts?.all ? dc.admin : dc.userDb;
  const me = dc.ctx.userId;
  type Item = { id: string; created_by: string | null };
  const { data } = await db.from('crm_drive_folders').select('id,parent_id,created_by').eq('business_unit', dc.bu);
  const allFolders = (data ?? []) as Array<Item & { parent_id: string | null }>;
  const folderIds = [folderId, ...descendantFolderIds(allFolders, folderId)];
  const { data: docs } = await db.from('crm_drive_docs').select('id,created_by').eq('business_unit', dc.bu).in('folder_id', folderIds);
  const { data: files } = await db.from('crm_drive_files').select('id,storage_path,created_by').eq('business_unit', dc.bu).in('folder_id', folderIds);
  const { data: forms } = await db.from('crm_drive_forms').select('id').eq('business_unit', dc.bu).in('folder_id', folderIds);
  const d = (docs ?? []) as Item[], f = (files ?? []) as Array<Item & { storage_path: string }>;
  const sub = allFolders.filter(x => folderIds.includes(x.id) && x.id !== folderId);
  return {
    formIds: ((forms ?? []) as Array<{ id: string }>).map(x => x.id), folderIds, docIds: d.map(x => x.id), fileIds: f.map(x => x.id), filePaths: f.map(x => x.storage_path),
    mine: { folderIds: folderIds.filter(id => id === folderId || allFolders.find(x => x.id === id)?.created_by === me), docIds: d.filter(x => x.created_by === me).map(x => x.id), fileIds: f.filter(x => x.created_by === me).map(x => x.id) },
    foreign: sub.filter(x => x.created_by !== me).length + d.filter(x => x.created_by !== me).length + f.filter(x => x.created_by !== me).length,
  };
}

/** Apply a patch to a folder and what is inside it. Sharing/visibility changes by a non-admin only reach the items they created. */
async function applyToSubtree(dc: DriveContext, folderId: string, patch: Record<string, unknown>) {
  const st = await subtree(dc, folderId);
  const own = !dc.isAdmin && ('visibility' in patch || 'shared_with' in patch || 'deal_id' in patch);
  const { folderIds, docIds, fileIds } = own ? st.mine : st;
  const { formIds } = st;
  const stamp = { ...patch, updated_at: new Date().toISOString() };
  // forms carry only the trash stamp (their sharing is fixed: always the team)
  if (formIds.length && 'trashed_at' in patch) await dc.admin.from('crm_drive_forms').update({ trashed_at: patch.trashed_at, updated_at: stamp.updated_at }).in('id', formIds);
  await dc.admin.from('crm_drive_folders').update(stamp).in('id', folderIds);
  if (docIds.length) await dc.admin.from('crm_drive_docs').update(stamp).in('id', docIds);
  if (fileIds.length) await dc.admin.from('crm_drive_files').update(stamp).in('id', fileIds);
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
  const isTemplate = (row as unknown as { is_template?: boolean }).is_template === true;
  const body = await req.json().catch(() => ({})) as {
    name?: string; title?: string;
    move?: { parent_id: string | null };
    share?: { visibility: 'team' | 'private'; shared_with?: string[] };
    trash?: boolean;
  };
  // A live document made from an uploaded file moves, is shared and is trashed together with that file. So only the file's owner (or an admin)
  // may do those to the document — someone who merely converted another person's file can edit it, but can't carry the original away with it.
  if (kind === 'doc' && !dc.isAdmin && (body.move || body.share || body.trash !== undefined)) {
    const pair = (await liveCopies(dc.admin, { docIds: [id] }))[0];
    if (pair) {
      const { data: f } = await dc.admin.from('crm_drive_files').select('created_by').eq('id', pair.file_id).maybeSingle();
      if (f && f.created_by !== dc.ctx.userId) return forbidden('This document was made from a file that belongs to someone else — only they (or an admin) can move, share or trash it');
    }
  }
  // Templates are team-wide and live outside the folders: they can be renamed, edited and trashed, not moved or re-shared.
  if (isTemplate && (body.move || body.share)) return NextResponse.json({ error: 'A template can’t be moved or shared separately — it is always available to the team' }, { status: 400 });
  const now = new Date().toISOString();

  // Rename
  const label = kind === 'doc' ? body.title : body.name ?? body.title;
  if (label !== undefined && kind === 'form') {
    const v = label.trim().slice(0, 200);
    if (!v) return NextResponse.json({ error: 'Give it a name' }, { status: 400 });
    // The form lives on a deal / property whose access rules are RLS on the submission itself: renaming needs the same visibility.
    const { data: seen } = await dc.userDb.from('crm_form_submissions').select('id').eq('id', row.submission_id as string).maybeSingle();
    if (!seen) return notFound();
    await dc.admin.from('crm_form_submissions').update({ title: v, updated_at: new Date().toISOString() }).eq('id', row.submission_id as string);
    await dc.admin.from('crm_drive_forms').update({ updated_at: new Date().toISOString() }).eq('id', id);
  } else
  if (label !== undefined) {
    const v = label.trim().slice(0, kind === 'doc' ? 300 : 200);
    if (!v) return NextResponse.json({ error: 'Give it a name' }, { status: 400 });
    const { error } = await dc.admin.from(t).update(kind === 'doc' ? { title: v, updated_by: dc.ctx.userId, updated_at: now } : { name: v, updated_at: now }).eq('id', id);
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
      // The move writes the destination's sharing over the item's own. Someone who can see it but doesn't own it must not be able to widen (or narrow) who
      // else can — that is the share branch below, which needs the owner or an admin.
      if (kind !== 'folder' && !canManage) {
        const cur = row as unknown as { visibility?: string; shared_with?: string[] | null };
        const same = adopt.visibility === cur.visibility && [...adopt.shared_with].sort().join() === [...(cur.shared_with ?? [])].sort().join();
        if (!same) return forbidden('Only the owner or an admin can move this into a folder that is shared differently');
      }
      // Forms are always shared with the team, so they can't go into a private or deal folder — and neither can a folder that holds forms.
      if (dest.visibility !== 'team' || dest.deal_id) {
        if (kind === 'form') return NextResponse.json({ error: 'Forms can only go in team folders (not private ones)' }, { status: 400 });
        if (kind === 'folder' && (await subtree(dc, id)).formIds.length) return NextResponse.json({ error: 'This folder has forms in it, and forms are always shared with the team — move the forms out first' }, { status: 400 });
      }
      if (row.deal_id !== adopt.deal_id && !canManage) return forbidden('Only the owner or an admin can move this out of a deal folder');
    }
    if (!target && row.deal_id && !canManage) return forbidden('Only the owner or an admin can move this out of a deal folder');
    const place = kind === 'folder' ? { parent_id: target } : { folder_id: target }; // docs and files both live in folder_id
    const { error } = await dc.admin.from(t).update({ ...place, updated_at: now }).eq('id', id);
    if (error) return NextResponse.json({ error: 'Could not move' }, { status: 500 });
    if (adopt && kind !== 'form') {
      if (kind === 'folder') await applyToSubtree(dc, id, adopt);
      else await dc.admin.from(t).update({ ...adopt, updated_at: now }).eq('id', id);
    }
  }

  // Share (owner / admin)
  if (body.share) {
    if (kind === 'form') return NextResponse.json({ error: 'Forms are always shared with the team' }, { status: 400 });
    if (!canManage) return forbidden('Only the owner or an admin can change who this is shared with');
    const visibility = body.share.visibility === 'private' ? 'private' : 'team';
    if (visibility === 'private' && kind === 'folder' && (await subtree(dc, id)).formIds.length) return NextResponse.json({ error: 'This folder has forms in it, and forms are always shared with the team — move the forms out first' }, { status: 400 });
    let shared: string[] = [];
    if (visibility === 'private' && Array.isArray(body.share.shared_with) && body.share.shared_with.length) {
      const { data } = await dc.admin.from('crm_profiles').select('id').eq('business_unit', dc.bu).in('id', body.share.shared_with.filter(x => typeof x === 'string').slice(0, 50));
      shared = ((data ?? []) as Array<{ id: string }>).map(p => p.id);
    }
    const patch = { visibility, shared_with: shared };
    if (kind === 'folder') await applyToSubtree(dc, id, patch);
    else await dc.admin.from(t).update({ ...patch, updated_at: now }).eq('id', id);
    // Tell the people who were just added (bell + phone alert), never yourself and never someone who already had access.
    if (visibility === 'private') {
      const had = new Set(row.shared_with ?? []);
      const added = shared.filter(p => !had.has(p) && p !== dc.ctx.userId && p !== row.created_by);
      if (added.length) {
        const who = await senderName(dc.admin, dc.ctx.userId);
        const label = String((row as unknown as { title?: string; name?: string }).title ?? (row as unknown as { name?: string }).name ?? 'an item');
        const message = `${who} shared ${kind === 'folder' ? 'the folder' : kind === 'file' ? 'the file' : ''} “${label}” with you`.replace('  ', ' ');
        const entityType = kind === 'doc' ? 'drive_doc' : 'drive_folder';
        const rows = added.map(recipient_id => ({ recipient_id, sender_id: dc.ctx.userId, type: 'share', message, entity_type: entityType, entity_id: id }));
        await dc.admin.from('crm_notifications').insert(rows);
        await Promise.all(rows.map(r => pushBellNotification(dc.admin, { recipientId: r.recipient_id, type: 'share', message, entityType, tag: `drive-share-${id}` })));
      }
    }
  }

  // Trash / restore. A folder stamps everything inside it with one instant so restoring brings back exactly that branch.
  if (body.trash !== undefined) {
    if (body.trash) {
      if (kind === 'folder') await applyToSubtree(dc, id, { trashed_at: now });
      else await dc.admin.from(t).update({ trashed_at: now, updated_at: now }).eq('id', id);
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
        const { folderIds, docIds, fileIds } = await subtree(dc, id);
        const stamp = row.trashed_at;
        if (stamp) {
          await dc.admin.from('crm_drive_folders').update({ trashed_at: null, updated_at: now }).in('id', folderIds).eq('trashed_at', stamp);
          if (docIds.length) await dc.admin.from('crm_drive_docs').update({ trashed_at: null, updated_at: now }).in('id', docIds).eq('trashed_at', stamp);
          if (fileIds.length) await dc.admin.from('crm_drive_files').update({ trashed_at: null, updated_at: now }).in('id', fileIds).eq('trashed_at', stamp);
        }
        if (orphan) await dc.admin.from('crm_drive_folders').update(place).eq('id', id);
      } else {
        await dc.admin.from(t).update({ trashed_at: null, updated_at: now, ...place }).eq('id', id);
      }
    }
  }

  // A live document made from an uploaded file moves, shares and goes to / comes back from the trash together with that file
  // (the lists show them as ONE item, so the file must never be left behind in the open).
  if (kind === 'doc' && (body.move || body.share || body.trash !== undefined)) {
    const pair = (await liveCopies(dc.admin, { docIds: [id] }))[0];
    if (pair) {
      const { data: d } = await dc.admin.from('crm_drive_docs').select('folder_id,visibility,shared_with,deal_id,trashed_at').eq('id', id).maybeSingle();
      if (d) await dc.admin.from('crm_drive_files').update({ folder_id: d.folder_id, visibility: d.visibility, shared_with: d.shared_with, deal_id: d.deal_id, trashed_at: d.trashed_at, updated_at: now }).eq('id', pair.file_id);
    }
  }

  // Activity log (documents): what just happened, in the order the rules above ran.
  if (kind === 'doc') {
    const ev = (k: Parameters<typeof logDocEvent>[1]['kind'], detail: Record<string, unknown> = {}) => logDocEvent(dc.admin, { docId: id, bu: dc.bu, actor: dc.ctx.userId, kind: k, detail });
    const was = String((row as unknown as { title?: string }).title ?? '');
    const now2 = (label ?? '').trim().slice(0, 300);
    if (label !== undefined && now2 && now2 !== was) await ev('renamed', { from: was, to: now2 });
    if (body.move) {
      let to = 'All files';
      if (body.move.parent_id) { const { data: f } = await dc.admin.from('crm_drive_folders').select('name').eq('id', body.move.parent_id).maybeSingle(); to = (f?.name as string) ?? 'a folder'; }
      await ev('moved', { to });
    }
    if (body.share) await ev('shared', { visibility: body.share.visibility === 'private' ? 'private' : 'team', people: body.share.visibility === 'private' ? (body.share.shared_with ?? []).length : 0 });
    if (body.trash !== undefined) await ev(body.trash ? 'trashed' : 'restored');
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
  // Uploaded files live in storage too: remove the objects (this one, or everything under a deleted folder) with the rows.
  let paths: string[] = [];
  if (kind === 'file') paths = [String((row as unknown as { storage_path?: string }).storage_path ?? '')].filter(Boolean);
  else if (kind === 'folder') {
    // Deleting a folder for good also deletes everything inside it (the database cascades), so a non-admin owner can only do that
    // when every item in it is theirs.
    const st = await subtree(dc, id, { all: true });
    if (!dc.isAdmin && st.foreign > 0) return forbidden('This folder holds items that belong to other people. Move them out, or ask an admin.');
    paths = st.filePaths;
  }
  if (kind === 'file' && !paths.length) {
    const { data } = await dc.admin.from('crm_drive_files').select('storage_path').eq('id', id).maybeSingle();
    if (data?.storage_path) paths = [data.storage_path as string];
  }
  // Deleting a live document for good also removes the uploaded file it was made from (they were shown as one item).
  let sourceFileId: string | null = null;
  if (kind === 'doc') {
    sourceFileId = (await liveCopies(dc.admin, { docIds: [id] }))[0]?.file_id ?? null;
    if (sourceFileId && !dc.isAdmin) {
      const { data: f } = await dc.admin.from('crm_drive_files').select('created_by').eq('id', sourceFileId).maybeSingle();
      if (f && f.created_by !== dc.ctx.userId) return forbidden('This document was made from a file that belongs to someone else — only they (or an admin) can delete it for good');
    }
    if (sourceFileId) {
      const { data } = await dc.admin.from('crm_drive_files').select('storage_path').eq('id', sourceFileId).maybeSingle();
      if (data?.storage_path) paths = [data.storage_path as string];
    }
  }
  const { error } = await dc.admin.from(tableOf(kind)!).delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500 });
  if (sourceFileId) await dc.admin.from('crm_drive_files').delete().eq('id', sourceFileId);
  if (kind === 'doc') await logDocEvent(dc.admin, { docId: id, bu: dc.bu, actor: dc.ctx.userId, kind: 'deleted', detail: { title: (row as unknown as { title?: string }).title ?? '' } });
  if (paths.length) await dc.admin.storage.from('drive-files').remove(paths);
  return NextResponse.json({ ok: true });
}
