import { safeObjectName } from '@/lib/safe-object-name';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { after } from 'next/server';
import { rateLimit, rateLimitFailOpen } from '@/lib/ratelimit';
import { isAutomationUA } from '@/lib/automation-ua';
import { adminClient } from '@/lib/supabase-admin';
import {
  SECURE_BUCKET, CONTENT_TYPES, MAX_FILE_SIZE, MAX_FILES_PER_REQUEST, UUID_RE, LOCK_AFTER, LOCK_MINUTES, CLOSE_AFTER, GUEST_SESSION_MINUTES,
  extOf, logSecure, notifyUploads, notifyOpened, notifyBlocked, notifyLocked, verifyStoredUpload, SCAN_STAMP,
  verifyPassword, makeGuestSession, checkGuestSession, type SecureRequestRow,
} from '@/lib/secure-upload';

// PUBLIC, token-gated — intentionally NOT in middleware.ts's matcher, so a tenant or guest (no login) reaches it.
//
// Two kinds of link share this route:
//  • No password (the original document request): UPLOAD-ONLY. It never returns a file or a link to one, only the names of what
//    was sent through the link itself — so a leaked link can add paperwork but can never read any.
//  • With a password: nothing at all happens until the password is right (then a 30-minute pass rides in the x-secure-session
//    header). If the folder's owner switched on viewing, a guest with the password can also list and download its files.
//    Wrong passwords are counted on the folder: a 15-minute lock after 5, and the link is closed (and the owner told) at 15.
export const dynamic = 'force-dynamic';
const ipOf = (req: NextRequest) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
const GUEST_DOWNLOAD_TTL_SECONDS = 120;

type State = 'ok' | 'expired' | 'revoked' | 'deleted';
function stateOf(r: SecureRequestRow): State {
  if (r.purged_at) return 'deleted';
  if (r.status === 'revoked') return 'revoked';
  if (Date.parse(r.expires_at) <= Date.now()) return 'expired';
  return 'ok';
}
const who = (r: SecureRequestRow) => ({ label: r.kind === 'folder' ? 'guest' : 'tenant' });
const passed = (req: NextRequest, r: SecureRequestRow) => !r.pass_hash || checkGuestSession(r, req.headers.get('x-secure-session'));
const canView = (r: SecureRequestRow) => !!r.pass_hash && r.guest_view;

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
    await db.from('crm_secure_requests').update({ view_count: r.view_count + 1 }).eq('id', r.id);
    if (!r.first_viewed_at) {
      // Claimed with a compare-and-set, so two page loads landing together record (and alert) the first open only once.
      const { data: first } = await db.from('crm_secure_requests').update({ first_viewed_at: new Date().toISOString() }).eq('id', r.id).is('first_viewed_at', null).select('id');
      if (first?.length) {
        await logSecure(db, r.id, who(r), 'viewed', 'opened the link', ipOf(req));
        after(() => notifyOpened(db, r));   // after the page has loaded — never slows the visitor
      }
    }
  }

  // Behind a password: say nothing about the folder — not its name, not what is in it — until the password is right.
  if (!passed(req, r)) {
    const lockedFor = r.locked_until && Date.parse(r.locked_until) > Date.now() ? Math.ceil((Date.parse(r.locked_until) - Date.now()) / 60_000) : 0;
    return NextResponse.json({ state: 'password', agentName, lockedMinutes: lockedFor });
  }

  const view = canView(r);
  let q = db.from('crm_secure_files').select('id, item_key, name, file_size, created_at, uploaded_by').eq('request_id', r.id).order('created_at');
  if (!view) q = q.is('uploaded_by', null);   // upload-only: never even the NAMES of what the team put in the folder
  const { data: files } = await q;
  return NextResponse.json({
    state, agentName, kind: r.kind, title: r.kind === 'folder' ? r.name : null, name: r.recipient_name, items: r.items, note: r.note, expiresAt: r.expires_at,
    submitted: !!r.submitted_at, canView: view, maxFileMb: MAX_FILE_SIZE / 1048576,
    files: (files ?? []).map(f => ({ id: f.id, item_key: f.item_key, name: f.name, file_size: f.file_size, created_at: f.created_at, mine: f.uploaded_by === null })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // Writes fail CLOSED: an unauthenticated caller must not get unlimited storage writes (or password guesses) if Redis is down.
  const rl = await rateLimit(req, 'secure-upload');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests — please wait a few minutes and try again.' }, { status: 429 });
  const { token } = await params;
  const ctx = await load(token);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { db } = ctx;
  let { r } = ctx;
  if (stateOf(r) !== 'ok') return NextResponse.json({ error: 'This link is no longer active. Please ask your broker for a new one.' }, { status: 410 });
  const body = await req.json().catch(() => ({}));
  const ip = ipOf(req);
  const folder = `req-${r.id}/`;
  const itemKeys = new Set(r.items.map(i => i.key));

  // ── The password ───────────────────────────────────────────────────────────
  if (body.action === 'unlock') {
    if (!r.pass_hash) return NextResponse.json({ session: null });
    if (r.locked_until && Date.parse(r.locked_until) > Date.now()) {
      const mins = Math.ceil((Date.parse(r.locked_until) - Date.now()) / 60_000);
      return NextResponse.json({ error: `Too many wrong passwords. Please wait ${mins} minute${mins === 1 ? '' : 's'} and try again.`, lockedMinutes: mins }, { status: 423 });
    }
    // Every guess first CLAIMS a numbered attempt (a compare-and-set on the counter), and only then is it checked — so guesses
    // fired in parallel cannot share a slot, and no more than CLOSE_AFTER are ever evaluated before the link shuts.
    let n = 0;
    for (let tries = 0; ; tries++) {
      n = (r.failed_attempts ?? 0) + 1;
      if (n > CLOSE_AFTER) break;
      const { data: claimed } = await db.from('crm_secure_requests').update({ failed_attempts: n }).eq('id', r.id).eq('failed_attempts', r.failed_attempts ?? 0).select('id');
      if (claimed?.length) break;
      if (tries >= 4) return NextResponse.json({ error: 'Please try again.' }, { status: 409 });
      const { data: fresh } = await db.from('crm_secure_requests').select('*').eq('id', r.id).single();
      r = fresh as SecureRequestRow;
      if (stateOf(r) !== 'ok') return NextResponse.json({ error: 'This link is no longer active. Please ask your broker for a new one.' }, { status: 410 });
    }
    const right = n <= CLOSE_AFTER && typeof body.password === 'string' && verifyPassword(body.password, r.pass_hash);
    if (right) {
      await db.from('crm_secure_requests').update({ failed_attempts: 0, locked_until: null }).eq('id', r.id);
      await logSecure(db, r.id, who(r), 'unlocked', 'entered the password', ip);
      return NextResponse.json({ session: makeGuestSession(r), minutes: GUEST_SESSION_MINUTES });
    }
    if (n >= CLOSE_AFTER) {
      await db.from('crm_secure_requests').update({ status: 'revoked' }).eq('id', r.id);
      await logSecure(db, r.id, { label: 'system' }, 'locked', `link closed after ${CLOSE_AFTER} wrong passwords`, ip);
      after(() => notifyLocked(db, r));
      return NextResponse.json({ error: 'This link has been closed after too many wrong passwords. Please contact your broker.' }, { status: 410 });
    }
    if (n % LOCK_AFTER === 0) {
      await db.from('crm_secure_requests').update({ locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() }).eq('id', r.id);
      await logSecure(db, r.id, { label: 'system' }, 'locked', `${n} wrong passwords — locked for ${LOCK_MINUTES} minutes`, ip);
      return NextResponse.json({ error: `That’s not the password. For safety this link is locked for ${LOCK_MINUTES} minutes.`, lockedMinutes: LOCK_MINUTES }, { status: 423 });
    }
    const left = LOCK_AFTER - (n % LOCK_AFTER);
    return NextResponse.json({ error: `That’s not the password. ${left} more ${left === 1 ? 'try' : 'tries'} before it locks for ${LOCK_MINUTES} minutes.` }, { status: 401 });
  }

  // Everything below needs the password first, when there is one.
  if (!passed(req, r)) return NextResponse.json({ error: 'Please enter the password again.', needsPassword: true }, { status: 401 });

  // ── A guest downloading a file (only when the owner allowed viewing, and only behind the password) ──
  if (body.action === 'download') {
    if (!canView(r)) return NextResponse.json({ error: 'Files in this folder can’t be opened from this link.' }, { status: 403 });
    const fileId = typeof body.fileId === 'string' && UUID_RE.test(body.fileId) ? body.fileId : '';
    const { data: f } = fileId ? await db.from('crm_secure_files').select('id, name, storage_path').eq('id', fileId).eq('request_id', r.id).maybeSingle() : { data: null };
    if (!f) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    const { data, error } = await db.storage.from(SECURE_BUCKET).createSignedUrl(f.storage_path as string, GUEST_DOWNLOAD_TTL_SECONDS, { download: f.name as string });
    if (error || !data?.signedUrl) { console.error('[secure-upload] guest sign', error); return NextResponse.json({ error: 'Could not open that file — please try again.' }, { status: 500 }); }
    await logSecure(db, r.id, who(r), 'downloaded', f.name as string, ip);
    return NextResponse.json({ url: data.signedUrl });
  }

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
    const safe = safeObjectName(filename, 100);
    const storagePath = `${folder}${Date.now()}_${randomBytes(4).toString('hex')}_${safe}`;
    const { data, error } = await db.storage.from(SECURE_BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data) { console.error('[secure-upload] presign', error); return NextResponse.json({ error: 'Could not start the upload — please try again.' }, { status: 500 }); }
    return NextResponse.json({ uploadUrl: data.signedUrl, storagePath, contentType });
  }

  if (body.action === 'confirm') {
    const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
    const filename = typeof body.filename === 'string' ? body.filename.slice(0, 255) : '';
    const itemKey = typeof body.itemKey === 'string' && itemKeys.has(body.itemKey) ? body.itemKey : 'other';
    const cols = 'id, item_key, name, file_size, created_at';
    const { data: existing } = await db.from('crm_secure_files').select(cols).eq('storage_path', storagePath).eq('request_id', r.id).maybeSingle();
    if (existing) return NextResponse.json({ file: { ...existing, mine: true } });   // a retried confirm
    // The same checks an agent's own upload gets: allowed type and size, the file really is that type, and the in-house safety scan.
    const v = await verifyStoredUpload(db, r.id, storagePath, filename);
    if (!v.ok) {
      if (v.blocked) {
        const reason = v.blocked.reason;
        await logSecure(db, r.id, { label: 'system' }, 'blocked', `${filename} — refused: looks like ${reason} (${v.blocked.code})`, ip);
        after(() => notifyBlocked(db, r, filename, reason));   // after the visitor has their answer — never slows the page
      }
      return NextResponse.json({ error: v.error }, { status: v.status });
    }
    const { data: file, error } = await db.from('crm_secure_files')
      .insert({ request_id: r.id, item_key: itemKey, name: filename, storage_path: storagePath, file_size: v.size, file_type: v.type, ...SCAN_STAMP() })
      .select(cols).single();
    if (error || !file) {
      console.error('[secure-upload] insert', error);
      await db.storage.from(SECURE_BUCKET).remove([storagePath]);
      return NextResponse.json({ error: 'Could not save that file — please try again.' }, { status: 500 });
    }
    // New uploads re-open "finished" so the agent is told again about anything added afterwards.
    await db.from('crm_secure_requests').update({ last_upload_at: new Date().toISOString(), submitted_at: null }).eq('id', r.id);
    await logSecure(db, r.id, who(r), 'uploaded', filename, ip);
    return NextResponse.json({ file: { ...file, mine: true } });
  }

  if (body.action === 'remove') {
    // Only what came in through the link — never a file the team put in the folder.
    const fileId = typeof body.fileId === 'string' && UUID_RE.test(body.fileId) ? body.fileId : '';
    const { data: f } = fileId ? await db.from('crm_secure_files').select('id, name, storage_path').eq('id', fileId).eq('request_id', r.id).is('uploaded_by', null).maybeSingle() : { data: null };
    if (!f) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    await db.storage.from(SECURE_BUCKET).remove([f.storage_path as string]);
    await db.from('crm_secure_files').delete().eq('id', f.id);
    await logSecure(db, r.id, who(r), 'removed', f.name as string, ip);
    return NextResponse.json({ success: true });
  }

  if (body.action === 'finish') {
    const { count } = await db.from('crm_secure_files').select('id', { count: 'exact', head: true }).eq('request_id', r.id).is('uploaded_by', null);
    if (!count) return NextResponse.json({ error: 'Upload at least one file first.' }, { status: 400 });
    const now = new Date().toISOString();
    await db.from('crm_secure_requests').update({ submitted_at: now }).eq('id', r.id);
    await logSecure(db, r.id, who(r), 'submitted', `${count} file${count === 1 ? '' : 's'}`, ip);
    after(() => notifyUploads(db, { ...r, submitted_at: now }, true));   // emails + phone alert go out after the visitor already sees "sent"
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
