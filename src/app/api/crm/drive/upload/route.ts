import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';
import { DRIVE_FILE_MAX, DRIVE_FILE_TYPES, FILE_COLS } from '@/lib/drive-types';

// Upload a file into a Drive folder. The browser PUTs the bytes straight to storage (a posted body is capped at ~4.5 MB on Vercel),
// so this route only hands out a signed upload URL (presign) and then records the file once it has landed (confirm).
//   POST { action: 'presign', filename, size, parent_id }  → { uploadUrl, storagePath, contentType }
//   POST { action: 'confirm', storagePath, filename, parent_id } → { file }
// A new file takes on the visibility (and deal link) of the folder it is uploaded to.

const BUCKET = 'drive-files';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const extOf = (n: string) => (n.split('.').pop() ?? '').toLowerCase();

export async function POST(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { userDb, admin, bu, ctx } = dc;
  const body = await req.json().catch(() => ({})) as { action?: string; filename?: string; size?: number; parent_id?: string | null; storagePath?: string };
  const filename = (body.filename ?? '').trim().slice(0, 255);
  const parentId = body.parent_id || null;
  if (!filename) return NextResponse.json({ error: 'filename required' }, { status: 400 });
  if (parentId && !UUID_RE.test(parentId)) return NextResponse.json({ error: 'invalid folder' }, { status: 400 });

  // Destination folder must be visible to the caller (RLS) and not in the trash.
  let inherit: { visibility: 'team' | 'private'; shared_with: string[]; deal_id: string | null } = { visibility: ctx.role === 'agent' ? 'private' : 'team', shared_with: [], deal_id: null };   // an agent's top-level files start private
  if (parentId) {
    const { data: parent } = await userDb.from('crm_drive_folders').select('id,visibility,shared_with,deal_id,trashed_at').eq('id', parentId).eq('business_unit', bu).maybeSingle();
    if (!parent || parent.trashed_at) return notFound('That folder is not available');
    inherit = { visibility: parent.visibility, shared_with: parent.shared_with ?? [], deal_id: parent.deal_id };
  }

  if (body.action === 'presign') {
    const contentType = DRIVE_FILE_TYPES[extOf(filename)];
    if (!contentType) {
      const ext = extOf(filename);
      const hint = ext === 'heic' || ext === 'heif' ? ' Share the photo as a JPG, or set Camera → Formats to Most Compatible.' : '';
      return NextResponse.json({ error: `.${ext || '?'} files can't be uploaded here — use PDF, Word, Excel, PowerPoint, an image, CSV or text.${hint}` }, { status: 400 });
    }
    if (Number(body.size) > DRIVE_FILE_MAX) return NextResponse.json({ error: 'A file must be 25 MB or smaller' }, { status: 400 });
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const storagePath = `${bu}/${crypto.randomUUID()}/${safe}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data) { console.error('[drive/upload] presign', error); return NextResponse.json({ error: 'Could not start the upload — try again' }, { status: 500 }); }
    return NextResponse.json({ uploadUrl: data.signedUrl, storagePath, contentType });
  }

  if (body.action === 'confirm') {
    const path = body.storagePath ?? '';
    // The path comes back from the browser: it must be one this workspace's presign could have produced.
    const m = path.match(new RegExp(`^${bu.replace(/[^a-z0-9_-]/gi, '')}/([0-9a-f-]{36})/([^/]+)$`, 'i'));
    if (!m || m[2].includes('..')) return NextResponse.json({ error: 'storagePath is not valid' }, { status: 400 });
    const { data: existing } = await admin.from('crm_drive_files').select(FILE_COLS).eq('storage_path', path).maybeSingle();
    if (existing) return NextResponse.json({ file: existing }); // a retried confirm
    // Size and type come from what actually landed in storage, not from the request.
    const { data: listed } = await admin.storage.from(BUCKET).list(`${bu}/${m[1]}`, { limit: 5 });
    const obj = listed?.find(o => o.name === m[2]);
    if (!obj) return NextResponse.json({ error: 'The file didn’t reach storage — try the upload again' }, { status: 400 });
    const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
    const { data, error } = await admin.from('crm_drive_files').insert({
      business_unit: bu, folder_id: parentId, name: filename, storage_path: path, size: meta.size ?? null,
      mime: meta.mimetype || DRIVE_FILE_TYPES[extOf(filename)] || 'application/octet-stream', created_by: ctx.userId, ...inherit,
    }).select(FILE_COLS).single();
    if (error || !data) {
      console.error('[drive/upload] confirm', error);
      await admin.storage.from(BUCKET).remove([path]); // don't leave an orphaned object behind
      return NextResponse.json({ error: 'Could not save the file' }, { status: 500 });
    }
    return NextResponse.json({ file: data });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
