import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext, likePattern, stripCommentMarks } from '@/lib/drive-server';
import { DOC_COLS, FILE_COLS, FOLDER_COLS, type DriveDoc, type DriveFile, type DriveFolder, type DriveListing } from '@/lib/drive-types';

// Transaction Docs "Drive": list folders + live documents, and create new ones.
// Every read runs as the signed-in user, so the crm_drive_* read policies (crm_drive_can) decide what is visible.

export async function GET(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { userDb, bu } = dc;
  const url = new URL(req.url);
  const view = url.searchParams.get('view') ?? 'folder';
  const folderParam = url.searchParams.get('folder');
  const folderId = folderParam && folderParam !== 'root' ? folderParam : null;

  if (view === 'tree') {
    const { data, error } = await userDb.from('crm_drive_folders').select('id,parent_id,name,visibility,deal_id')
      .eq('business_unit', bu).is('trashed_at', null).order('name');
    if (error) return NextResponse.json({ error: 'Could not load folders' }, { status: 500 });
    return NextResponse.json({ folders: data ?? [] });
  }

  if (view === 'recent') {
    const { data, error } = await userDb.from('crm_drive_docs').select(DOC_COLS)
      .eq('business_unit', bu).is('trashed_at', null).eq('is_template', false).order('updated_at', { ascending: false }).limit(40);
    if (error) return NextResponse.json({ error: 'Could not load documents' }, { status: 500 });
    return NextResponse.json({ path: [], folder: null, folders: [], docs: data ?? [] } satisfies DriveListing);
  }

  if (view === 'templates') {
    const { data, error } = await userDb.from('crm_drive_docs').select(`${DOC_COLS},content_text`)
      .eq('business_unit', bu).eq('is_template', true).is('trashed_at', null).order('title');
    if (error) return NextResponse.json({ error: 'Could not load templates' }, { status: 500 });
    const docs = ((data ?? []) as unknown as Array<DriveDoc & { content_text: string }>).map(({ content_text, ...d }) => ({ ...d, snippet: content_text.replace(/\s+/g, ' ').slice(0, 110) }));
    return NextResponse.json({ path: [], folder: null, folders: [], docs } satisfies DriveListing);
  }

  if (view === 'trash') {
    const [f, d, fl] = await Promise.all([
      userDb.from('crm_drive_folders').select(FOLDER_COLS).eq('business_unit', bu).not('trashed_at', 'is', null),
      userDb.from('crm_drive_docs').select(DOC_COLS).eq('business_unit', bu).not('trashed_at', 'is', null),
      userDb.from('crm_drive_files').select(FILE_COLS).eq('business_unit', bu).not('trashed_at', 'is', null),
    ]);
    if (f.error || d.error || fl.error) return NextResponse.json({ error: 'Could not load the trash' }, { status: 500 });
    const folders = (f.data ?? []) as DriveFolder[];
    const docs = (d.data ?? []) as DriveDoc[];
    const files = (fl.data ?? []) as DriveFile[];
    // Trashing a folder stamps everything inside it with the same instant; show only the top of each trashed branch.
    const stamp = new Map(folders.map(x => [x.id, x.trashed_at]));
    const top = <T extends { trashed_at: string | null }>(parent: string | null, x: T) => !parent || !stamp.has(parent) || stamp.get(parent) !== x.trashed_at;
    return NextResponse.json({
      path: [], folder: null,
      folders: folders.filter(x => top(x.parent_id, x)),
      docs: docs.filter(x => top(x.folder_id, x)),
      files: files.filter(x => top(x.folder_id, x)),
    } satisfies DriveListing);
  }

  if (view === 'search') {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json({ path: [], folder: null, folders: [], docs: [] } satisfies DriveListing);
    const pat = likePattern(q);
    const [f, byTitle, byText, byFile] = await Promise.all([
      userDb.from('crm_drive_folders').select(FOLDER_COLS).eq('business_unit', bu).is('trashed_at', null).ilike('name', pat).limit(30),
      userDb.from('crm_drive_docs').select(DOC_COLS).eq('business_unit', bu).is('trashed_at', null).eq('is_template', false).ilike('title', pat).limit(40),
      userDb.from('crm_drive_docs').select(`${DOC_COLS},content_text`).eq('business_unit', bu).is('trashed_at', null).eq('is_template', false).ilike('content_text', pat).limit(40),
      userDb.from('crm_drive_files').select(FILE_COLS).eq('business_unit', bu).is('trashed_at', null).ilike('name', pat).limit(40),
    ]);
    const docs = new Map<string, DriveDoc>();
    for (const x of (byTitle.data ?? []) as unknown as DriveDoc[]) docs.set(x.id, x);
    for (const x of (byText.data ?? []) as unknown as Array<DriveDoc & { content_text: string }>) {
      if (docs.has(x.id)) continue;
      const i = x.content_text.toLowerCase().indexOf(q.toLowerCase());
      const { content_text, ...rest } = x;
      docs.set(x.id, { ...rest, snippet: `${i > 40 ? '…' : ''}${content_text.slice(Math.max(0, i - 40), i + 100).replace(/\s+/g, ' ')}…` });
    }
    return NextResponse.json({ path: [], folder: null, folders: (f.data ?? []) as DriveFolder[], docs: [...docs.values()], files: (byFile.data ?? []) as DriveFile[] } satisfies DriveListing);
  }

  // Default: the contents of one folder (or the top level).
  const path: Array<{ id: string; name: string }> = [];
  let folder: DriveFolder | null = null;
  let cur: string | null = folderId;
  for (let i = 0; cur && i < 25; i++) {
    const { data } = await userDb.from('crm_drive_folders').select(FOLDER_COLS).eq('id', cur).eq('business_unit', bu).maybeSingle();
    const row = data as DriveFolder | null;
    if (!row || row.trashed_at) { if (i === 0) return notFound('That folder is not available'); break; }
    if (i === 0) folder = row;
    path.unshift({ id: row.id, name: row.name });
    cur = row.parent_id;
  }
  const fq = userDb.from('crm_drive_folders').select(FOLDER_COLS).eq('business_unit', bu).is('trashed_at', null);
  const dq = userDb.from('crm_drive_docs').select(DOC_COLS).eq('business_unit', bu).is('trashed_at', null).eq('is_template', false);
  const lq = userDb.from('crm_drive_files').select(FILE_COLS).eq('business_unit', bu).is('trashed_at', null);
  const [f, d, fl] = await Promise.all([
    (folderId ? fq.eq('parent_id', folderId) : fq.is('parent_id', null)).order('name'),
    (folderId ? dq.eq('folder_id', folderId) : dq.is('folder_id', null)).order('updated_at', { ascending: false }),
    (folderId ? lq.eq('folder_id', folderId) : lq.is('folder_id', null)).order('name'),
  ]);
  if (f.error || d.error || fl.error) return NextResponse.json({ error: 'Could not load this folder' }, { status: 500 });
  return NextResponse.json({ path, folder, folders: (f.data ?? []) as DriveFolder[], docs: (d.data ?? []) as DriveDoc[], files: (fl.data ?? []) as DriveFile[] } satisfies DriveListing);
}

export async function POST(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { userDb, admin, bu, ctx } = dc;
  const body = await req.json().catch(() => ({})) as { type?: string; name?: string; title?: string; parent_id?: string | null; deal_id?: string | null; template_id?: string; from_doc_id?: string; as_template?: boolean };
  const type = body.type === 'doc' ? 'doc' : body.type === 'folder' ? 'folder' : null;
  if (!type) return NextResponse.json({ error: 'type must be folder or doc' }, { status: 400 });
  const label = ((type === 'folder' ? body.name : body.title) ?? '').trim().slice(0, type === 'folder' ? 200 : 300) || (type === 'folder' ? 'New folder' : 'Untitled document');

  // A new item takes on the visibility (and deal link) of the folder it is created in.
  let visibility: 'team' | 'private' = 'team';
  let shared_with: string[] = [];
  let deal_id: string | null = null;
  const parentId = body.parent_id || null;
  if (parentId) {
    const { data: parent } = await userDb.from('crm_drive_folders').select('id,visibility,shared_with,deal_id,trashed_at').eq('id', parentId).eq('business_unit', bu).maybeSingle();
    if (!parent || parent.trashed_at) return notFound('That folder is not available');
    visibility = parent.visibility; shared_with = parent.shared_with ?? []; deal_id = parent.deal_id;
  } else if (body.deal_id) {
    // A top-level folder for a deal: the caller must be able to see that deal (deal RLS answers that).
    const { data: deal } = await userDb.from('crm_deals').select('id').eq('id', body.deal_id).maybeSingle();
    if (!deal) return notFound('That deal is not available');
    deal_id = deal.id;
  }

  // From a template (a copy of it in this folder), or "Save as template" (a copy of a document, outside the folders, for the team).
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (type === 'doc' && (body.template_id || body.from_doc_id)) {
    const srcId = (body.template_id || body.from_doc_id) as string;
    if (!UUID.test(srcId)) return NextResponse.json({ error: 'invalid document' }, { status: 400 });
    const asTemplate = !!body.from_doc_id && body.as_template === true;
    const { data: seen } = await userDb.from('crm_drive_docs').select('id,title,deal_id,is_template,trashed_at').eq('id', srcId).eq('business_unit', bu).maybeSingle();
    if (!seen || seen.trashed_at || (body.template_id && !seen.is_template)) return notFound('That document is not available');
    // A document linked to a deal can't become a team-wide template (its contents belong to that deal's people).
    if (asTemplate && seen.deal_id) return NextResponse.json({ error: 'A document linked to a deal can’t be saved as a template' }, { status: 400 });
    const { data: srcRow } = await admin.from('crm_drive_docs').select('ystate,content_text').eq('id', srcId).single();
    if (!srcRow) return notFound('That document is not available');
    const copy = {
      business_unit: bu, created_by: ctx.userId, updated_by: ctx.userId,
      title: (body.title ?? '').trim().slice(0, 300) || (seen.title as string),
      ystate: srcRow.ystate ? stripCommentMarks(srcRow.ystate as string) : null,
      content_text: (srcRow.content_text as string) ?? '', version: srcRow.ystate ? 1 : 0,
      ...(asTemplate ? { is_template: true, folder_id: null, visibility: 'team', shared_with: [], deal_id: null } : { folder_id: parentId, visibility, shared_with, deal_id }),
    };
    const { data: made, error: e } = await admin.from('crm_drive_docs').insert(copy).select(DOC_COLS).single();
    if (e || !made) return NextResponse.json({ error: asTemplate ? 'Could not save the template' : 'Could not create the document' }, { status: 500 });
    return NextResponse.json({ type: 'doc', item: made });
  }

  const base = { business_unit: bu, created_by: ctx.userId, visibility, shared_with, deal_id };
  const { data, error } = type === 'folder'
    ? await admin.from('crm_drive_folders').insert({ ...base, parent_id: parentId, name: label }).select(FOLDER_COLS).single()
    : await admin.from('crm_drive_docs').insert({ ...base, folder_id: parentId, title: label, updated_by: ctx.userId }).select(DOC_COLS).single();
  if (error || !data) return NextResponse.json({ error: `Could not create the ${type}` }, { status: 500 });
  return NextResponse.json({ type, item: data });
}
