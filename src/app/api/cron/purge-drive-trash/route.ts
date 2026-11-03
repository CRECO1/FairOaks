/**
 * GET /api/cron/purge-drive-trash — daily. My Drive items (documents, files, forms, folders) stay in the trash for 30 days, then are
 * removed for good. Secured with CRON_SECRET. Add `?dry=1` to see what WOULD be removed without removing anything.
 *
 * Safety rules (this deletes data, so they are strict):
 *  - only rows whose trashed_at is more than 30 days old; at most 300 of each kind per run (the rest go tomorrow);
 *  - a FORM is only unlinked from My Drive (its crm_drive_forms row). The filled form / any e-signed copy is never touched;
 *  - a FOLDER is deleted only when its whole subtree is in the trash for more than 30 days and nothing else is left inside it
 *    (a folder delete cascades to everything in it, so anything not in the trash blocks it);
 *  - uploaded files lose their storage object together with their row; a document's versions, comments and links go with it, and its
 *    activity-log trail is kept (a "deleted … automatically" entry).
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { logDocEvent } from '@/lib/drive-events';
import { descendantFolderIds } from '@/lib/drive-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEEP_DAYS = 30;
const BATCH = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const db = adminClient();
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  const out = { dry, docs: 0, files: 0, forms: 0, folders: 0, folders_kept: 0 };

  // Documents (versions, comments and links cascade; the activity trail stays).
  const { data: docs } = await db.from('crm_drive_docs').select('id,title,business_unit').not('trashed_at', 'is', null).lt('trashed_at', cutoff).limit(BATCH);
  out.docs = docs?.length ?? 0;
  if (!dry && docs?.length) {
    for (const d of docs) await logDocEvent(db, { docId: d.id as string, bu: d.business_unit as string, actor: null, kind: 'deleted', detail: { title: d.title, auto: true } });
    await db.from('crm_drive_docs').delete().in('id', docs.map(d => d.id as string));
  }

  // Uploaded files: the row and the stored object.
  const { data: files } = await db.from('crm_drive_files').select('id,storage_path').not('trashed_at', 'is', null).lt('trashed_at', cutoff).limit(BATCH);
  out.files = files?.length ?? 0;
  if (!dry && files?.length) {
    const { error } = await db.from('crm_drive_files').delete().in('id', files.map(f => f.id as string));
    if (!error) {
      const paths = files.map(f => f.storage_path as string).filter(Boolean);
      if (paths.length) await db.storage.from('drive-files').remove(paths);
    }
  }

  // Forms: unlink from My Drive only (the saved form itself is never deleted here).
  const { data: forms } = await db.from('crm_drive_forms').select('id').not('trashed_at', 'is', null).lt('trashed_at', cutoff).limit(BATCH);
  out.forms = forms?.length ?? 0;
  if (!dry && forms?.length) await db.from('crm_drive_forms').delete().in('id', forms.map(f => f.id as string));

  // Folders, deepest first, and only when nothing live is left in their subtree.
  const { data: all } = await db.from('crm_drive_folders').select('id,parent_id,trashed_at');
  const folders = (all ?? []) as Array<{ id: string; parent_id: string | null; trashed_at: string | null }>;
  const byId = new Map(folders.map(f => [f.id, f]));
  const old = (f: { trashed_at: string | null }) => !!f.trashed_at && f.trashed_at < cutoff;
  const depth = (f: { parent_id: string | null }) => { let n = 0; for (let p = f.parent_id; p && byId.has(p); p = byId.get(p)!.parent_id) n++; return n; };
  const candidates = folders.filter(old).sort((a, b) => depth(b) - depth(a)).slice(0, BATCH);
  const gone = new Set<string>();
  for (const f of candidates) {
    if (gone.has(f.id)) continue;
    const ids = [f.id, ...descendantFolderIds(folders, f.id)];
    if (!ids.every(id => old(byId.get(id)!))) { out.folders_kept++; continue; }   // something inside is not in the trash (or is newer)
    // Anything still inside blocks the delete (a folder delete cascades). A dry run hasn't removed the old items yet, so it ignores those.
    const left = await Promise.all(['crm_drive_docs', 'crm_drive_files', 'crm_drive_forms'].map(async t => {
      const q = db.from(t).select('id', { count: 'exact', head: true }).in('folder_id', ids);
      return (await (dry ? q.or(`trashed_at.is.null,trashed_at.gte.${cutoff}`) : q)).count ?? 0;
    }));
    if (left.some(n => n > 0)) { out.folders_kept++; continue; }
    if (!dry) {
      const { error } = await db.from('crm_drive_folders').delete().eq('id', f.id);
      if (error) { out.folders_kept++; continue; }
    }
    out.folders += ids.length; ids.forEach(id => gone.add(id));
  }

  if (!dry && (out.docs || out.files || out.forms || out.folders)) console.info('[purge-drive-trash]', JSON.stringify(out));
  return NextResponse.json({ ok: true, ...out });
}
