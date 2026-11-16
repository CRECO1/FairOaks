import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getCrmContext, assertOwnsResource, hiddenDealIds, isAdminRole, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { resolveSignature, withSignature } from '@/lib/agent-signature';
import {
  SECURE_BUCKET, LINK_DAYS, KEEP_DAYS, UUID_RE, CONTENT_TYPES, MAX_FILE_SIZE, MAX_FILES_PER_REQUEST, extOf, genToken, secureUrl, addDays, cleanItems,
  canSeeRequest, indexVisible, logSecure, removeRequestFiles, requestEmail, folderEmail, sendSecureEmail, PRESETS,
  hashPassword, passwordProblem, verifyStoredUpload, SCAN_STAMP, type SecureRequestRow,
} from '@/lib/secure-upload';

// Agent side of "Secure documents" on a contact card. Everything here is service-role, so every action re-checks that the
// caller may see the CONTACT and then that they may see the REQUEST (broker, creator, contact owner, or added agent).
// Files are never returned by list: each download is a fresh 5-minute signed link, and is written to the access log.

export const dynamic = 'force-dynamic';
const DOWNLOAD_TTL_SECONDS = 300;
type Ctx = NonNullable<Awaited<ReturnType<typeof getCrmContext>>>;

async function actorName(ctx: Ctx): Promise<string> {
  const { data } = await adminClient().from('crm_profiles').select('first_name, last_name').eq('id', ctx.userId).maybeSingle();
  return [data?.first_name, data?.last_name].filter(Boolean).join(' ') || 'An agent';
}
const ipOf = (req: NextRequest) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;

async function loadRequest(id: string, ctx: Ctx): Promise<SecureRequestRow | null> {
  if (!UUID_RE.test(id)) return null;
  const db = adminClient();
  const { data } = await db.from('crm_secure_requests').select('*').eq('id', id).maybeSingle();
  const r = data as SecureRequestRow | null;
  if (!r) return null;
  if (r.client_id) { if (!(await assertOwnsResource('crm_clients', r.client_id, ctx))) return null; }
  // A stand-alone folder has no contact to check: it stays inside its own workspace instead.
  else if (!isAdminRole(ctx.role) && r.business_unit !== ctx.businessUnit) return null;
  // A request on a deal also obeys the deal's own walls (a private deal stays private).
  if (r.deal_id && !(await assertOwnsResource('crm_deals', r.deal_id, ctx))) return null;
  return (await canSeeRequest(db, ctx, r)) ? r : null;
}

// What a browser may know about a folder. The link token only while the link is live; the password hash NEVER.
function publicShape(r: SecureRequestRow) {
  const { token: _t, pass_hash: _p, failed_attempts: _f, ...rest } = r;
  return { ...rest, has_password: !!r.pass_hash, link: r.status === 'open' && !r.purged_at ? secureUrl(r.token) : null };
}
const FILE_COLS = 'id, request_id, item_key, name, file_size, file_type, created_at, scan_status, uploaded_by';
const mayManage = (ctx: Ctx, r: SecureRequestRow) => ctx.role === 'super_admin' || r.created_by === ctx.userId;
const liveLink = (r: SecureRequestRow) => r.status === 'open' && !r.purged_at && Date.parse(r.expires_at) > Date.now();
async function contactFor(clientId: string | null | undefined) {
  if (!clientId || !UUID_RE.test(clientId)) return null;
  const { data: tc } = await adminClient().from('crm_clients').select('id, first_name, last_name, phone, cell_phone, business_unit').eq('id', clientId).maybeSingle();
  return tc ? {
    id: tc.id as string, name: [tc.first_name, tc.last_name].filter(Boolean).join(' '), first_name: (tc.first_name as string | null) ?? '',
    phone: ((tc.cell_phone as string | null) || (tc.phone as string | null) || null), business_unit: tc.business_unit as string,
  } : null;
}

// ── GET ?clientId=…        → this contact's requests the caller may see (files listed, no links)
//    GET ?fileId=…         → a fresh 5-minute download link (logged)
//    GET ?logFor=<request> → that request's access log
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const db = adminClient();
  const sp = req.nextUrl.searchParams;

  const fileId = sp.get('fileId');
  if (fileId) {
    if (!UUID_RE.test(fileId)) return NextResponse.json({ error: 'invalid fileId' }, { status: 400 });
    const { data: f } = await db.from('crm_secure_files').select('id, request_id, name, storage_path').eq('id', fileId).maybeSingle();
    const r = f ? await loadRequest(f.request_id as string, ctx) : null;
    if (!f || !r) return notFound('File not found');
    const { data, error } = await db.storage.from(SECURE_BUCKET).createSignedUrl(f.storage_path as string, DOWNLOAD_TTL_SECONDS);
    if (error || !data?.signedUrl) { console.error('[secure-requests] sign failed', error); return NextResponse.json({ error: 'Could not generate a link.' }, { status: 500 }); }
    await logSecure(db, r.id, { id: ctx.userId, label: await actorName(ctx) }, 'downloaded', f.name as string, ipOf(req));
    return NextResponse.json({ url: data.signedUrl });
  }

  // GET ?zipFor=<request> → a short-lived link per file; the browser zips them (no big body through the server).
  const zipFor = sp.get('zipFor');
  if (zipFor) {
    const r = await loadRequest(zipFor, ctx);
    if (!r) return notFound('Request not found');
    const { data: fs } = await db.from('crm_secure_files').select('name, storage_path').eq('request_id', r.id).order('created_at');
    const out: { name: string; url: string }[] = [];
    for (const f of fs ?? []) {
      const { data } = await db.storage.from(SECURE_BUCKET).createSignedUrl(f.storage_path as string, DOWNLOAD_TTL_SECONDS);
      if (data?.signedUrl) out.push({ name: f.name as string, url: data.signedUrl });
    }
    if (!out.length) return NextResponse.json({ error: 'No files to download.' }, { status: 404 });
    await logSecure(db, r.id, { id: ctx.userId, label: await actorName(ctx) }, 'downloaded', `all ${out.length} files (zip)`, ipOf(req));
    return NextResponse.json({ files: out });
  }

  const logFor = sp.get('logFor');
  if (logFor) {
    const r = await loadRequest(logFor, ctx);
    if (!r) return notFound('Request not found');
    const { data } = await db.from('crm_secure_log').select('id, actor_label, action, detail, created_at').eq('request_id', r.id).order('created_at', { ascending: false }).limit(200);
    return NextResponse.json({ log: data ?? [] });
  }

  // GET ?id=<request> → one folder with its files (My Drive opens a folder this way). Same shape as the lists below.
  const oneId = sp.get('id');
  if (oneId) {
    const r = await loadRequest(oneId, ctx);
    if (!r) return notFound('Folder not found');
    const { data: fs1 } = await db.from('crm_secure_files').select(FILE_COLS).eq('request_id', r.id).order('created_at');
    let dealLabel1: string | null = null;
    if (r.deal_id) {
      const { data: d1 } = await db.from('crm_deals').select('crm_listings(address)').eq('id', r.deal_id).maybeSingle();
      const l = d1?.crm_listings as unknown as { address?: string } | { address?: string }[] | null | undefined;
      const address = Array.isArray(l) ? l[0]?.address : l?.address;
      dealLabel1 = address ? `Deal · ${address}` : 'Deal';
    }
    return NextResponse.json({ contact: await contactFor(r.client_id), requests: [{ ...publicShape(r), deal_label: dealLabel1, files: fs1 ?? [] }] });
  }

  // GET ?all=1[&business_unit=] → the My Drive index: every request the caller may see, as a status line each.
  // Read-only by design: no token, no link, no file names — the files themselves are only reachable from the contact or deal.
  if (sp.get('all') === '1') {
    const unit = isAdminRole(ctx.role) ? (sp.get('business_unit') ?? ctx.businessUnit ?? 'commercial') : (ctx.businessUnit ?? 'commercial');
    const { data: all, error: allErr } = await db.from('crm_secure_requests').select('*').eq('business_unit', unit).order('created_at', { ascending: false }).limit(500);
    if (allErr) { console.error('[secure-requests] index', allErr); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
    const reqRows = (all ?? []) as SecureRequestRow[];
    const clientIds = [...new Set(reqRows.map(r => r.client_id).filter((x): x is string => !!x))];
    const dealIdsAll = [...new Set(reqRows.map(r => r.deal_id).filter((x): x is string => !!x))];
    const { data: cs } = clientIds.length ? await db.from('crm_clients').select('id, first_name, last_name, business_name, agent_id, lead_hold, business_unit').in('id', clientIds) : { data: [] };
    const { data: dsAll } = dealIdsAll.length ? await db.from('crm_deals').select('id, agent_id, assigned_agent_ids, crm_listings(address)').in('id', dealIdsAll) : { data: [] };
    const cBy = new Map((cs ?? []).map(c => [c.id as string, c]));
    const dBy = new Map((dsAll ?? []).map(d => [d.id as string, d]));
    const hiddenDeals = new Set(await hiddenDealIds(ctx));
    const seen = reqRows.filter(r => indexVisible(ctx, unit, r, (r.client_id ? cBy.get(r.client_id) : null) as { agent_id?: string | null; lead_hold?: boolean | null; business_unit?: string | null } | null | undefined,
      (r.deal_id ? dBy.get(r.deal_id) : null) as { agent_id?: string | null; assigned_agent_ids?: string[] | null } | null | undefined, hiddenDeals));
    const seenIds = seen.map(r => r.id);
    const { data: fs } = seenIds.length ? await db.from('crm_secure_files').select('request_id, item_key').in('request_id', seenIds) : { data: [] };
    const { data: makers } = seen.length ? await db.from('crm_profiles').select('id, first_name, last_name').in('id', [...new Set(seen.map(r => r.created_by).filter((x): x is string => !!x))]) : { data: [] };
    const makerBy = new Map((makers ?? []).map(m => [m.id as string, [m.first_name, m.last_name].filter(Boolean).join(' ')]));
    return NextResponse.json({
      requests: seen.map(r => {
        const c = r.client_id ? cBy.get(r.client_id) : null;
        const d = r.deal_id ? dBy.get(r.deal_id) : null;
        const l = d?.crm_listings as unknown as { address?: string } | { address?: string }[] | null | undefined;
        const address = Array.isArray(l) ? l[0]?.address : l?.address;
        const mine = (fs ?? []).filter(f => f.request_id === r.id);
        const keys = new Set(mine.map(f => f.item_key as string | null));
        return {
          id: r.id, client_id: r.client_id, deal_id: r.deal_id, kind: r.kind, has_password: !!r.pass_hash, guest_view: r.guest_view,
          contact_name: r.kind === 'folder' && r.name ? r.name : c ? ([c.first_name, c.last_name].filter(Boolean).join(' ') || (c.business_name as string | null) || 'Contact') : (r.name || 'Secure folder'),
          deal_label: r.deal_id ? (address ? `Deal · ${address}` : 'Deal') : null,
          status: r.status, purged_at: r.purged_at, expires_at: r.expires_at, submitted_at: r.submitted_at, first_viewed_at: r.first_viewed_at, sent_at: r.sent_at,
          created_at: r.created_at, last_upload_at: r.last_upload_at, purge_after: r.purge_after, keep_files: r.keep_files,
          requested_by: r.created_by ? makerBy.get(r.created_by) ?? null : null,
          file_count: mine.length, items_total: r.items.length, items_done: r.items.filter(i => keys.has(i.key)).length,
        };
      }),
    });
  }

  // List: a contact's requests (?clientId) or one deal's (?dealId). Either way, only ones the caller may see.
  const dealIdParam = sp.get('dealId') ?? '';
  const clientIdParam = sp.get('clientId') ?? '';
  let rowsQ = db.from('crm_secure_requests').select('*').order('created_at', { ascending: false });
  if (dealIdParam) {
    if (!UUID_RE.test(dealIdParam)) return NextResponse.json({ error: 'invalid dealId' }, { status: 400 });
    if (!(await assertOwnsResource('crm_deals', dealIdParam, ctx))) return notFound('Deal not found');
    rowsQ = rowsQ.eq('deal_id', dealIdParam);
  } else {
    if (!UUID_RE.test(clientIdParam)) return NextResponse.json({ error: 'clientId or dealId required' }, { status: 400 });
    if (!(await assertOwnsResource('crm_clients', clientIdParam, ctx))) return notFound('Contact not found');
    rowsQ = rowsQ.eq('client_id', clientIdParam);
  }
  const { data: rows, error } = await rowsQ;
  if (error) { console.error('[secure-requests] list', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  const hidden = new Set(await hiddenDealIds(ctx));
  const visible: SecureRequestRow[] = [];
  for (const r of (rows ?? []) as SecureRequestRow[]) {
    if (r.deal_id && hidden.has(r.deal_id)) continue;   // a deal the caller may not see keeps its secure folder hidden too
    if (await canSeeRequest(db, ctx, r)) visible.push(r);
  }
  const ids = visible.map(r => r.id);
  const { data: files } = ids.length
    ? await db.from('crm_secure_files').select(FILE_COLS).in('request_id', ids).order('created_at')
    : { data: [] };
  // On a contact card, say which deal a request belongs to.
  const dealIds = [...new Set(visible.map(r => r.deal_id).filter((x): x is string => !!x))];
  const dealLabel = new Map<string, string>();
  if (dealIds.length) {
    const { data: ds } = await db.from('crm_deals').select('id, crm_listings(address)').in('id', dealIds);
    for (const d of ds ?? []) {
      const l = d.crm_listings as unknown as { address?: string } | { address?: string }[] | null;
      const address = Array.isArray(l) ? l[0]?.address : l?.address;
      dealLabel.set(d.id as string, address ? `Deal · ${address}` : 'Deal');
    }
  }
  // Who a text would go to (the contact, or the deal's contact) — for the 💬 Text box on each request.
  let textClientId = clientIdParam;
  if (dealIdParam) textClientId = ((await db.from('crm_deals').select('client_id').eq('id', dealIdParam).maybeSingle()).data?.client_id as string | undefined) ?? '';
  const contact = await contactFor(textClientId);
  return NextResponse.json({
    contact,
    requests: visible.map(r => ({ ...publicShape(r), deal_label: r.deal_id ? dealLabel.get(r.deal_id) ?? 'Deal' : null, files: (files ?? []).filter(f => f.request_id === r.id) })),
  });
}

// ── POST { clientId, preset?, items?, note?, email?, name?, send? }   create (and email) a request
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const db = adminClient();
  if (body.action === 'create_folder') return createFolder(req, body, ctx);
  if (body.action === 'presign') return agentPresign(body, ctx);
  if (body.action === 'confirm') return agentConfirm(req, body, ctx);
  // An optional password on the link (the same rules as a folder's).
  const reqPassword = typeof body.password === 'string' && body.password ? body.password : null;
  if (reqPassword) { const bad = passwordProblem(reqPassword); if (bad) return NextResponse.json({ error: bad }, { status: 400 }); }
  const dealId = typeof body.dealId === 'string' && UUID_RE.test(body.dealId) ? body.dealId : null;
  let clientId = typeof body.clientId === 'string' ? body.clientId : '';
  if (dealId) {
    // From a deal: the deal must be visible to the caller, and the request belongs to the deal's contact.
    if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
    const { data: d } = await db.from('crm_deals').select('client_id').eq('id', dealId).maybeSingle();
    if (!d?.client_id) return NextResponse.json({ error: 'Link this deal to a contact first — the request needs a name and email to go to.' }, { status: 400 });
    clientId = d.client_id as string;
  }
  if (!UUID_RE.test(clientId)) return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  const client = await assertOwnsResource('crm_clients', clientId, ctx, { ownerColumns: ['agent_id'] });
  if (!client) return notFound('Contact not found');

  let items = cleanItems(body.items);
  if (!items.length && typeof body.preset === 'string' && PRESETS[body.preset]) items = PRESETS[body.preset].items;
  if (!items.length) return NextResponse.json({ error: 'Pick at least one document to ask for.' }, { status: 400 });

  const { data: c } = await db.from('crm_clients').select('first_name, last_name, email, business_unit').eq('id', clientId).maybeSingle();
  const name = (typeof body.name === 'string' && body.name.trim()) || [c?.first_name, c?.last_name].filter(Boolean).join(' ') || '';
  const email = (typeof body.email === 'string' && body.email.trim()) || (c?.email as string | null) || '';
  const send = body.send !== false;
  if (send && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Add a valid email address for this contact (or choose "just give me the link").' }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 600) || null : null;
  const unit = (c?.business_unit as string | undefined) ?? ctx.businessUnit ?? 'commercial';

  const { data: row, error } = await db.from('crm_secure_requests').insert({
    client_id: clientId, deal_id: dealId, business_unit: unit, created_by: ctx.userId,
    recipient_name: name || null, recipient_email: email || null, note, items, token: genToken(),
    expires_at: addDays(LINK_DAYS), purge_after: addDays(KEEP_DAYS),
    ...(reqPassword ? { pass_hash: hashPassword(reqPassword), guest_view: body.guestView === true } : {}),
  }).select('*').single();
  if (error || !row) { console.error('[secure-requests] insert', error); return NextResponse.json({ error: 'Could not create the request' }, { status: 500 }); }
  const r = row as SecureRequestRow;
  const me = await actorName(ctx);
  await logSecure(db, r.id, { id: ctx.userId, label: me }, 'created', items.map(i => i.label).join('; '), ipOf(req));
  if (reqPassword) await logSecure(db, r.id, { id: ctx.userId, label: me }, 'secured', `password required${r.guest_view ? '; people with it can view files' : ''}`, ipOf(req));

  let emailed = false; let emailError: string | undefined;
  if (send) {
    const { subject, html } = requestEmail(unit, { name, senderName: me, url: secureUrl(r.token), items, note, expiresAt: r.expires_at, needsPassword: !!reqPassword });
    const res = await sendSecureEmail(unit, email, subject, withSignature(html, await resolveSignature(db, { agentId: ctx.userId })));
    emailed = res.ok; emailError = res.error;
    if (res.ok) {
      await db.from('crm_secure_requests').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
      await logSecure(db, r.id, { id: ctx.userId, label: me }, 'sent', email, ipOf(req));
    }
  }
  return NextResponse.json({ request: { ...publicShape({ ...r, sent_at: emailed ? new Date().toISOString() : null }), files: [] }, emailed, emailError });
}

// ── POST { action: 'create_folder', name, password?, guestView? }  a folder of your own in My Drive — no contact, no checklist.
// With a password it gets a live link straight away (link + password are both needed to get in); without one it has no link at all.
async function createFolder(req: NextRequest, body: Record<string, unknown>, ctx: Ctx) {
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  if (!name) return NextResponse.json({ error: 'Give the folder a name.' }, { status: 400 });
  const password = typeof body.password === 'string' && body.password ? body.password : null;
  if (password) { const bad = passwordProblem(password); if (bad) return NextResponse.json({ error: bad }, { status: 400 }); }
  const db = adminClient();
  const { data: row, error } = await db.from('crm_secure_requests').insert({
    kind: 'folder', name, client_id: null, business_unit: ctx.businessUnit ?? 'commercial', created_by: ctx.userId, items: [], token: genToken(),
    status: password ? 'open' : 'revoked', expires_at: addDays(LINK_DAYS), purge_after: addDays(KEEP_DAYS), keep_files: true,
    ...(password ? { pass_hash: hashPassword(password), guest_view: body.guestView !== false } : {}),
  }).select('*').single();
  if (error || !row) { console.error('[secure-requests] create_folder', error); return NextResponse.json({ error: 'Could not create the folder' }, { status: 500 }); }
  const r = row as SecureRequestRow;
  const me = { id: ctx.userId, label: await actorName(ctx) };
  await logSecure(db, r.id, me, 'created', `secure folder “${name}”`, ipOf(req));
  if (password) await logSecure(db, r.id, me, 'secured', `password required${r.guest_view ? '; people with it can view files' : '; upload only'}`, ipOf(req));
  return NextResponse.json({ request: { ...publicShape(r), deal_label: null, files: [] } });
}

// ── POST { action: 'presign', id, filename, file_size } / { action: 'confirm', id, storagePath, filename, itemKey? }
// An agent adding their own file to a folder they can see. The browser PUTs straight to storage; confirm runs the SAME
// type, signature and safety checks a guest's upload gets (verifyStoredUpload) before the file is recorded.
async function agentPresign(body: Record<string, unknown>, ctx: Ctx) {
  const r = await loadRequest(typeof body.id === 'string' ? body.id : '', ctx);
  if (!r) return notFound('Folder not found');
  if (r.purged_at) return NextResponse.json({ error: 'This folder was deleted.' }, { status: 400 });
  const filename = typeof body.filename === 'string' ? body.filename : '';
  if (!filename) return NextResponse.json({ error: 'filename required' }, { status: 400 });
  if (Number(body.file_size) > MAX_FILE_SIZE) return NextResponse.json({ error: `Each file must be ${MAX_FILE_SIZE / 1048576} MB or smaller.` }, { status: 400 });
  const contentType = CONTENT_TYPES[extOf(filename)];
  if (!contentType) return NextResponse.json({ error: `.${extOf(filename) || '?'} files can’t go in a secure folder — use PDF, JPG, PNG, Word, Excel or CSV.` }, { status: 400 });
  const db = adminClient();
  const { count } = await db.from('crm_secure_files').select('id', { count: 'exact', head: true }).eq('request_id', r.id);
  if ((count ?? 0) >= MAX_FILES_PER_REQUEST) return NextResponse.json({ error: `A secure folder holds up to ${MAX_FILES_PER_REQUEST} files. Start another folder for the rest.` }, { status: 400 });
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  const storagePath = `req-${r.id}/${Date.now()}_${randomBytes(4).toString('hex')}_${safe}`;
  const { data, error } = await db.storage.from(SECURE_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) { console.error('[secure-requests] presign', error); return NextResponse.json({ error: 'Could not start the upload — try again' }, { status: 500 }); }
  return NextResponse.json({ uploadUrl: data.signedUrl, storagePath, contentType });
}
async function agentConfirm(req: NextRequest, body: Record<string, unknown>, ctx: Ctx) {
  const r = await loadRequest(typeof body.id === 'string' ? body.id : '', ctx);
  if (!r) return notFound('Folder not found');
  if (r.purged_at) return NextResponse.json({ error: 'This folder was deleted.' }, { status: 400 });
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
  const filename = typeof body.filename === 'string' ? body.filename.slice(0, 255) : '';
  const db = adminClient();
  const me = { id: ctx.userId, label: await actorName(ctx) };
  const { data: existing } = await db.from('crm_secure_files').select(FILE_COLS).eq('storage_path', storagePath).eq('request_id', r.id).maybeSingle();
  if (existing) return NextResponse.json({ file: existing });   // a retried confirm
  const v = await verifyStoredUpload(db, r.id, storagePath, filename);
  if (!v.ok) {
    if (v.blocked) await logSecure(db, r.id, me, 'blocked', `${filename} — refused: looks like ${v.blocked.reason} (${v.blocked.code})`, ipOf(req));
    return NextResponse.json({ error: v.error }, { status: v.status });
  }
  const itemKey = typeof body.itemKey === 'string' && r.items.some(i => i.key === body.itemKey) ? body.itemKey : 'other';
  const { data: file, error } = await db.from('crm_secure_files')
    .insert({ request_id: r.id, item_key: itemKey, name: filename, storage_path: storagePath, file_size: v.size, file_type: v.type, uploaded_by: ctx.userId, ...SCAN_STAMP() })
    .select(FILE_COLS).single();
  if (error || !file) {
    console.error('[secure-requests] confirm insert', error);
    await db.storage.from(SECURE_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: 'Could not save that file — try again' }, { status: 500 });
  }
  await logSecure(db, r.id, me, 'uploaded', filename, ipOf(req));
  return NextResponse.json({ file });
}

// ── PATCH { id, action: 'revoke' | 'reopen' | 'extend' | 'keep' | 'unkeep' | 'resend' | 'share', agentIds? }
export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const r = await loadRequest(typeof body.id === 'string' ? body.id : '', ctx);
  if (!r) return notFound('Request not found');
  const db = adminClient();
  const me = { id: ctx.userId, label: await actorName(ctx) };
  const ip = ipOf(req);
  const act = body.action as string;

  if (act === 'revoke') {
    await db.from('crm_secure_requests').update({ status: 'revoked' }).eq('id', r.id);
    await logSecure(db, r.id, me, 'revoked', null, ip);
  } else if (act === 'reopen') {
    await db.from('crm_secure_requests').update({ status: 'open', expires_at: addDays(LINK_DAYS), failed_attempts: 0, locked_until: null }).eq('id', r.id);
    await logSecure(db, r.id, me, 'extended', `reopened for ${LINK_DAYS} days`, ip);
  } else if (act === 'extend') {
    await db.from('crm_secure_requests').update({ status: 'open', expires_at: addDays(LINK_DAYS), failed_attempts: 0, locked_until: null }).eq('id', r.id);
    await logSecure(db, r.id, me, 'extended', `link good for ${LINK_DAYS} more days`, ip);
  } else if (act === 'keep' || act === 'unkeep') {
    const keep = act === 'keep';
    await db.from('crm_secure_requests').update({ keep_files: keep, ...(keep ? {} : { purge_after: addDays(KEEP_DAYS) }) }).eq('id', r.id);
    await logSecure(db, r.id, me, 'kept', keep ? 'kept until deleted by hand' : `auto-delete back on (${KEEP_DAYS} days)`, ip);
  } else if (act === 'share') {
    // Only the broker or the request's creator decides who else sees it.
    if (ctx.role !== 'super_admin' && r.created_by !== ctx.userId) return NextResponse.json({ error: 'Only the person who made this request can change who sees it.' }, { status: 403 });
    const ids = Array.isArray(body.agentIds) ? [...new Set((body.agentIds as unknown[]).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].slice(0, 20) : [];
    const { data: profs } = ids.length ? await db.from('crm_profiles').select('id').in('id', ids) : { data: [] };
    const valid = (profs ?? []).map(p => p.id as string);
    await db.from('crm_secure_requests').update({ shared_with: valid }).eq('id', r.id);
    await logSecure(db, r.id, me, 'shared', `${valid.length} agent${valid.length === 1 ? '' : 's'} added`, ip);
  } else if (act === 'set_password') {
    // The password is the key to the folder for anyone outside the team, so only the broker or its creator sets it.
    if (!mayManage(ctx, r)) return NextResponse.json({ error: 'Only the person who made this folder can change its password.' }, { status: 403 });
    const bad = passwordProblem(body.password);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    const view = body.guestView === true;
    await db.from('crm_secure_requests').update({ pass_hash: hashPassword(body.password as string), guest_view: view, failed_attempts: 0, locked_until: null }).eq('id', r.id);
    await logSecure(db, r.id, me, 'secured', `password ${r.pass_hash ? 'changed' : 'set'}${view ? '; people with it can view files' : '; upload only'}`, ip);
  } else if (act === 'clear_password') {
    if (!mayManage(ctx, r)) return NextResponse.json({ error: 'Only the person who made this folder can change its password.' }, { status: 403 });
    await db.from('crm_secure_requests').update({ pass_hash: null, guest_view: false, failed_attempts: 0, locked_until: null }).eq('id', r.id);
    await logSecure(db, r.id, me, 'secured', 'password removed — the link is upload-only again', ip);
  } else if (act === 'rename') {
    if (r.kind !== 'folder') return NextResponse.json({ error: 'Only folders you created can be renamed.' }, { status: 400 });
    if (!mayManage(ctx, r)) return NextResponse.json({ error: 'Only the person who made this folder can rename it.' }, { status: 403 });
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
    if (!name) return NextResponse.json({ error: 'Give the folder a name.' }, { status: 400 });
    await db.from('crm_secure_requests').update({ name }).eq('id', r.id);
    await logSecure(db, r.id, me, 'renamed', `“${r.name ?? ''}” → “${name}”`, ip);
  } else if (act === 'texted') {
    // The 💬 Text box sent (or the agent opened a text on their own phone). Only live links count as "sent".
    if (r.status !== 'open' || r.purged_at || Date.parse(r.expires_at) <= Date.now()) return NextResponse.json({ error: 'This link is not active.' }, { status: 400 });
    const how = body.how === 'office-line' ? 'from the office line' : 'from their own phone (opened a text)';
    await db.from('crm_secure_requests').update({ sent_at: r.sent_at ?? new Date().toISOString() }).eq('id', r.id);
    await logSecure(db, r.id, me, 'sent', `link texted ${how}`, ip);
  } else if (act === 'resend') {
    if (!liveLink(r)) return NextResponse.json({ error: 'This link is not active — extend it first.' }, { status: 400 });
    const email = (typeof body.email === 'string' && body.email.trim()) || r.recipient_email || '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: r.kind === 'folder' ? 'Type the email address to send the link to.' : 'No valid email address to send to.' }, { status: 400 });
    const { subject, html } = r.kind === 'folder'
      ? folderEmail(r.business_unit, { folderName: r.name ?? 'Secure folder', senderName: me.label, url: secureUrl(r.token), expiresAt: r.expires_at, needsPassword: !!r.pass_hash, canView: r.guest_view })
      : requestEmail(r.business_unit, { name: r.recipient_name ?? '', senderName: me.label, url: secureUrl(r.token), items: r.items, note: r.note, expiresAt: r.expires_at, reminder: !!r.sent_at, needsPassword: !!r.pass_hash });
    const res = await sendSecureEmail(r.business_unit, email, subject, withSignature(html, await resolveSignature(db, { agentId: ctx.userId })));
    if (!res.ok) return NextResponse.json({ error: `Could not send: ${res.error ?? 'email failed'}` }, { status: 502 });
    await db.from('crm_secure_requests').update({ sent_at: r.sent_at ?? new Date().toISOString(), recipient_email: email }).eq('id', r.id);
    await logSecure(db, r.id, me, 'sent', email, ip);
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  const { data: fresh } = await db.from('crm_secure_requests').select('*').eq('id', r.id).single();
  return NextResponse.json({ request: publicShape(fresh as SecureRequestRow) });
}

// ── DELETE { fileId }  one file     |   DELETE { id }  the whole request and everything in it (the log stays on file for 'deleted')
export async function DELETE(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const db = adminClient();
  const me = { id: ctx.userId, label: await actorName(ctx) };

  if (typeof body.fileId === 'string') {
    if (!UUID_RE.test(body.fileId)) return NextResponse.json({ error: 'invalid fileId' }, { status: 400 });
    const { data: f } = await db.from('crm_secure_files').select('id, request_id, name, storage_path').eq('id', body.fileId).maybeSingle();
    const r = f ? await loadRequest(f.request_id as string, ctx) : null;
    if (!f || !r) return notFound('File not found');
    await db.storage.from(SECURE_BUCKET).remove([f.storage_path as string]);
    await db.from('crm_secure_files').delete().eq('id', f.id);
    await logSecure(db, r.id, me, 'deleted', f.name as string, ipOf(req));
    return NextResponse.json({ success: true });
  }
  if (typeof body.id === 'string') {
    const r = await loadRequest(body.id, ctx);
    if (!r) return notFound('Request not found');
    const n = await removeRequestFiles(db, r.id);
    // The request row (and with it the trail) is kept but closed: a deleted folder should still say who deleted it.
    await db.from('crm_secure_requests').update({ status: 'revoked', purged_at: new Date().toISOString() }).eq('id', r.id);
    await logSecure(db, r.id, me, 'deleted', `whole folder deleted (${n} file${n === 1 ? '' : 's'})`, ipOf(req));
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: 'fileId or id required' }, { status: 400 });
}
