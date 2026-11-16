import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { after } from 'next/server';
import { rateLimit, rateLimitFailOpen } from '@/lib/ratelimit';
import { isAutomationUA } from '@/lib/automation-ua';
import { adminClient } from '@/lib/supabase-admin';
import {
  SECURE_BUCKET, CONTENT_TYPES, MAX_FILE_SIZE, MAX_FILES_PER_REQUEST, UUID_RE, extOf, logSecure, notifyUploads, notifyOpened, sniffStored, type SecureRequestRow,
} from '@/lib/secure-upload';

// PUBLIC, token-gated — intentionally NOT in middleware.ts's matcher, so a tenant (no login) reaches it.
// Upload-only: this route never returns a file or a link to one, only the names of what THIS person already sent,
// so a leaked link can add paperwork but can never read any.
export const dynamic = 'force-dynamic';
const ipOf = (req: NextRequest) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;

type State = 'ok' | 'expired' | 'revoked' | 'deleted';
function stateOf(r: SecureRequestRow): State {
  if (r.purged_at) return 'deleted';
  if (r.status === 'revoked') return 'revoked';
  if (Date.parse(r.expires_at) <= Date.now()) return 'expired';
  return 'ok';
}

async function load(token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const db = adminClient();
  const { data } = await db.from('crm_secure_requests').select('*').eq('token', token).maybeSingle();
  return data ? { db, r: data as SecureRequestRow } : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const rl = await rateLimitFailOpen(req, 'secure-upload');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const { token } = await params;
  const ctx = await load(token);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { db, r } = ctx;
  const state = stateOf(r);

  let agentName = 'your CRECO broker';
  if (r.created_by) {
    const { data: p } = await db.from('crm_profiles').select('first_name, last_name').eq('id', r.created_by).maybeSingle();
    agentName = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || agentName;
  }
  if (state !== 'ok') return NextResponse.json({ state, agentName });

  // A real person opening the page — not a mail scanner pre-fetching the link.
  if (!isAutomationUA(req.headers.get('user-agent'))) {
    await db.from('crm_secure_requests').update({ view_count: r.view_count + 1, ...(r.first_viewed_at ? {} : { first_viewed_at: new Date().toISOString() }) }).eq('id', r.id);
    if (!r.first_viewed_at) {
      await logSecure(db, r.id, { label: 'tenant' }, 'viewed', 'opened the link', ipOf(req));
      after(() => notifyOpened(db, r));   // after the page has loaded — never slows the tenant
    }
  }
  const { data: files } = await db.from('crm_secure_files').select('id, item_key, name, file_size, created_at').eq('request_id', r.id).order('created_at');
  return NextResponse.json({
    state, agentName, name: r.recipient_name, items: r.items, note: r.note, expiresAt: r.expires_at,
    submitted: !!r.submitted_at, files: files ?? [], maxFileMb: MAX_FILE_SIZE / 1048576,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // Writes fail CLOSED: an unauthenticated caller must not get unlimited storage writes if Redis is down.
  const rl = await rateLimit(req, 'secure-upload');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests — please wait a few minutes and try again.' }, { status: 429 });
  const { token } = await params;
  const ctx = await load(token);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { db, r } = ctx;
  if (stateOf(r) !== 'ok') return NextResponse.json({ error: 'This link is no longer active. Please ask your broker for a new one.' }, { status: 410 });
  const body = await req.json().catch(() => ({}));
  const ip = ipOf(req);
  const folder = `req-${r.id}/`;
  const itemKeys = new Set(r.items.map(i => i.key));

  if (body.action === 'presign') {
    const filename = typeof body.filename === 'string' ? body.filename : '';
    if (!filename) return NextResponse.json({ error: 'filename required' }, { status: 400 });
    if (Number(body.file_size) > MAX_FILE_SIZE) return NextResponse.json({ error: `That file is too big — please keep each file under ${MAX_FILE_SIZE / 1048576} MB.` }, { status: 400 });
    const contentType = CONTENT_TYPES[extOf(filename)];
    if (!contentType) {
      const ext = extOf(filename);
      const hint = ext === 'heic' || ext === 'heif' ? ' On an iPhone, choose Camera → Formats → Most Compatible, or share the photo as a JPG.' : '';
      return NextResponse.json({ error: `.${ext || '?'} files can’t be uploaded here — please use PDF, JPG, PNG, Word or Excel.${hint}` }, { status: 400 });
    }
    const { count } = await db.from('crm_secure_files').select('id', { count: 'exact', head: true }).eq('request_id', r.id);
    if ((count ?? 0) >= MAX_FILES_PER_REQUEST) return NextResponse.json({ error: 'That’s the most files this link can take. Please call us if you need to send more.' }, { status: 400 });
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    const storagePath = `${folder}${Date.now()}_${randomBytes(4).toString('hex')}_${safe}`;
    const { data, error } = await db.storage.from(SECURE_BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data) { console.error('[secure-upload] presign', error); return NextResponse.json({ error: 'Could not start the upload — please try again.' }, { status: 500 }); }
    return NextResponse.json({ uploadUrl: data.signedUrl, storagePath, contentType });
  }

  if (body.action === 'confirm') {
    const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
    const filename = typeof body.filename === 'string' ? body.filename.slice(0, 255) : '';
    const objectName = storagePath.startsWith(folder) ? storagePath.slice(folder.length) : '';
    if (!objectName || objectName.includes('/') || objectName.includes('..') || !filename) return NextResponse.json({ error: 'Bad upload reference' }, { status: 400 });
    if (!CONTENT_TYPES[extOf(filename)]) return NextResponse.json({ error: 'That file type is not allowed.' }, { status: 400 });
    const itemKey = typeof body.itemKey === 'string' && itemKeys.has(body.itemKey) ? body.itemKey : 'other';

    const { data: existing } = await db.from('crm_secure_files').select('id, item_key, name, file_size, created_at').eq('storage_path', storagePath).maybeSingle();
    if (existing) return NextResponse.json({ file: existing });   // a retried confirm
    // Size and type come from what actually landed in storage, not from the request.
    const { data: listed, error: listError } = await db.storage.from(SECURE_BUCKET).list(folder.slice(0, -1), { search: objectName, limit: 5 });
    const obj = listed?.find(o => o.name === objectName);
    if (listError || !obj) return NextResponse.json({ error: 'The file didn’t finish uploading — please try again.' }, { status: 400 });
    const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
    if ((meta.size ?? 0) > MAX_FILE_SIZE) { await db.storage.from(SECURE_BUCKET).remove([storagePath]); return NextResponse.json({ error: 'That file is too big.' }, { status: 400 }); }
    // The first bytes must match the extension: a renamed program or a half-uploaded file is refused and removed.
    if (!(await sniffStored(db, storagePath, extOf(filename)))) {
      await db.storage.from(SECURE_BUCKET).remove([storagePath]);
      return NextResponse.json({ error: `“${filename}” doesn’t look like a real ${extOf(filename).toUpperCase()} file. Please try again, or send a PDF or photo.` }, { status: 400 });
    }
    const { data: file, error } = await db.from('crm_secure_files')
      .insert({ request_id: r.id, item_key: itemKey, name: filename, storage_path: storagePath, file_size: meta.size ?? null, file_type: meta.mimetype || CONTENT_TYPES[extOf(filename)] })
      .select('id, item_key, name, file_size, created_at').single();
    if (error || !file) {
      console.error('[secure-upload] insert', error);
      await db.storage.from(SECURE_BUCKET).remove([storagePath]);
      return NextResponse.json({ error: 'Could not save that file — please try again.' }, { status: 500 });
    }
    // New uploads re-open "finished" so the agent is told again about anything added afterwards.
    await db.from('crm_secure_requests').update({ last_upload_at: new Date().toISOString(), submitted_at: null }).eq('id', r.id);
    await logSecure(db, r.id, { label: 'tenant' }, 'uploaded', filename, ip);
    return NextResponse.json({ file });
  }

  if (body.action === 'remove') {
    const fileId = typeof body.fileId === 'string' && UUID_RE.test(body.fileId) ? body.fileId : '';
    const { data: f } = fileId ? await db.from('crm_secure_files').select('id, name, storage_path').eq('id', fileId).eq('request_id', r.id).maybeSingle() : { data: null };
    if (!f) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    await db.storage.from(SECURE_BUCKET).remove([f.storage_path as string]);
    await db.from('crm_secure_files').delete().eq('id', f.id);
    await logSecure(db, r.id, { label: 'tenant' }, 'removed', f.name as string, ip);
    return NextResponse.json({ success: true });
  }

  if (body.action === 'finish') {
    const { count } = await db.from('crm_secure_files').select('id', { count: 'exact', head: true }).eq('request_id', r.id);
    if (!count) return NextResponse.json({ error: 'Upload at least one file first.' }, { status: 400 });
    const now = new Date().toISOString();
    await db.from('crm_secure_requests').update({ submitted_at: now }).eq('id', r.id);
    await logSecure(db, r.id, { label: 'tenant' }, 'submitted', `${count} file${count === 1 ? '' : 's'}`, ip);
    after(() => notifyUploads(db, { ...r, submitted_at: now }, true));   // emails + phone alert go out after the tenant already sees "sent"
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
