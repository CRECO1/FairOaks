import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, hiddenDealIds, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { resolveSignature, withSignature } from '@/lib/agent-signature';
import {
  SECURE_BUCKET, LINK_DAYS, KEEP_DAYS, UUID_RE, genToken, secureUrl, addDays, cleanItems, canSeeRequest, logSecure, removeRequestFiles,
  requestEmail, sendSecureEmail, PRESETS, type SecureRequestRow,
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
  if (!(await assertOwnsResource('crm_clients', r.client_id, ctx))) return null;
  // A request on a deal also obeys the deal's own walls (a private deal stays private).
  if (r.deal_id && !(await assertOwnsResource('crm_deals', r.deal_id, ctx))) return null;
  return (await canSeeRequest(db, ctx, r)) ? r : null;
}

function publicShape(r: SecureRequestRow) {
  const { token: _t, ...rest } = r;
  return { ...rest, link: r.status === 'open' && !r.purged_at ? secureUrl(r.token) : null };
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
    ? await db.from('crm_secure_files').select('id, request_id, item_key, name, file_size, file_type, created_at').in('request_id', ids).order('created_at')
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
  return NextResponse.json({
    requests: visible.map(r => ({ ...publicShape(r), deal_label: r.deal_id ? dealLabel.get(r.deal_id) ?? 'Deal' : null, files: (files ?? []).filter(f => f.request_id === r.id) })),
  });
}

// ── POST { clientId, preset?, items?, note?, email?, name?, send? }   create (and email) a request
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const db = adminClient();
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
  }).select('*').single();
  if (error || !row) { console.error('[secure-requests] insert', error); return NextResponse.json({ error: 'Could not create the request' }, { status: 500 }); }
  const r = row as SecureRequestRow;
  const me = await actorName(ctx);
  await logSecure(db, r.id, { id: ctx.userId, label: me }, 'created', items.map(i => i.label).join('; '), ipOf(req));

  let emailed = false; let emailError: string | undefined;
  if (send) {
    const { subject, html } = requestEmail(unit, { name, senderName: me, url: secureUrl(r.token), items, note, expiresAt: r.expires_at });
    const res = await sendSecureEmail(unit, email, subject, withSignature(html, await resolveSignature(db, { agentId: ctx.userId })));
    emailed = res.ok; emailError = res.error;
    if (res.ok) {
      await db.from('crm_secure_requests').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
      await logSecure(db, r.id, { id: ctx.userId, label: me }, 'sent', email, ipOf(req));
    }
  }
  return NextResponse.json({ request: { ...publicShape({ ...r, sent_at: emailed ? new Date().toISOString() : null }), files: [] }, emailed, emailError });
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
    await db.from('crm_secure_requests').update({ status: 'open', expires_at: addDays(LINK_DAYS) }).eq('id', r.id);
    await logSecure(db, r.id, me, 'extended', `reopened for ${LINK_DAYS} days`, ip);
  } else if (act === 'extend') {
    await db.from('crm_secure_requests').update({ status: 'open', expires_at: addDays(LINK_DAYS) }).eq('id', r.id);
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
  } else if (act === 'resend') {
    if (r.status !== 'open' || r.purged_at || Date.parse(r.expires_at) <= Date.now()) return NextResponse.json({ error: 'This link is not active — extend it first.' }, { status: 400 });
    const email = (typeof body.email === 'string' && body.email.trim()) || r.recipient_email || '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'No valid email address to send to.' }, { status: 400 });
    const { subject, html } = requestEmail(r.business_unit, { name: r.recipient_name ?? '', senderName: me.label, url: secureUrl(r.token), items: r.items, note: r.note, expiresAt: r.expires_at, reminder: !!r.sent_at });
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
