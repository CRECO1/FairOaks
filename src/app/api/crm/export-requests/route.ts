/**
 * GET  /api/crm/export-requests  — what is outstanding
 * POST /api/crm/export-requests  — ask the owner for permission to export
 *
 * The owner sees every pending request; everyone else sees only their own, so
 * the queue cannot be used to work out who else is asking for what.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmSuperAdmin, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';
import {
  mintToken, scopeKey, scopeLabel, sendApprovalRequestEmail,
  TOKEN_TTL_MS, type ExportScope,
} from '@/lib/export-approval';

const COLS = 'id, requester_id, requester_name, requester_email, business_unit, scope_label, row_count, status, created_at, approved_at, approval_expires_at, denied_at, consumed_at';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const isOwner = !!(await getCrmSuperAdmin(req));

  const db = adminClient();
  let q = db.from('crm_export_requests').select(COLS).order('created_at', { ascending: false }).limit(50);
  if (!isOwner) q = q.eq('requester_id', ctx.userId);

  const { data, error } = await q;
  if (error) return dbError('export-requests:list', error);
  return NextResponse.json({ requests: data ?? [], isOwner });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  // The owner is the approver — he never queues behind himself.
  if (await getCrmSuperAdmin(req)) {
    return NextResponse.json({ status: 'owner', message: 'You are the approver — export directly.' });
  }

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  // Scope comes from the client, but identity never does: name, email and the
  // unit an agent is allowed to touch are re-read from their profile.
  const db = adminClient();
  const { data: profile } = await db
    .from('crm_profiles').select('first_name, last_name, email, role, business_unit')
    .eq('id', ctx.userId).single();

  const requesterName = profile
    ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Unknown agent'
    : 'Unknown agent';
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const unit = isAdmin
    ? (typeof body.business_unit === 'string' ? body.business_unit : ctx.businessUnit ?? 'commercial')
    : (ctx.businessUnit ?? 'commercial');

  const ids: string[] | null = Array.isArray(body.ids) && body.ids.length
    ? body.ids.filter((v: unknown): v is string => typeof v === 'string')
    : null;

  const scope: ExportScope = { businessUnit: unit, ids };
  const key = scopeKey(scope);

  // Count server-side. A client-supplied count would make the approval email
  // lie about the size of what is being handed over.
  let countQ = db.from('crm_clients').select('id', { count: 'exact', head: true }).eq('business_unit', unit);
  if (ids) countQ = countQ.in('id', ids);
  const { count } = await countQ;
  const rowCount = count ?? 0;

  // An identical pending ask is the same ask. Re-sending would just let anyone
  // fill the owner's inbox by clicking twice.
  const { data: existing } = await db
    .from('crm_export_requests').select('id, status, created_at')
    .eq('requester_id', ctx.userId).eq('scope_key', key).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1);
  if (existing?.[0]) {
    return NextResponse.json({
      status: 'pending', requestId: existing[0].id, alreadyPending: true,
      message: 'Your export request is awaiting owner approval.',
    });
  }

  const { raw, hash } = mintToken();
  const label = scopeLabel(scope, rowCount);

  const { data: created, error } = await db.from('crm_export_requests').insert({
    requester_id: ctx.userId,
    requester_name: requesterName,
    requester_email: profile?.email ?? null,
    business_unit: unit,
    scope_key: key,
    scope_label: label,
    row_count: rowCount,
    status: 'pending',
    token_hash: hash,
    token_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    requested_ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
  }).select('id').single();

  if (error) return dbError('export-requests:create', error);

  const { sent } = await sendApprovalRequestEmail({
    requesterName,
    requesterEmail: profile?.email ?? null,
    scopeText: label,
    rowCount,
    businessUnit: unit,
    rawToken: raw,
    requestedAt: new Date(),
  });

  await writeAuditLog({
    actorId: ctx.userId,
    action: 'export_requested',
    targetType: 'crm_export_requests',
    targetId: created.id,
    metadata: { scope_key: key, scope_label: label, row_count: rowCount, unit, notified: sent },
    req,
  });

  return NextResponse.json({
    status: 'pending',
    requestId: created.id,
    rowCount,
    scopeLabel: label,
    notified: sent,
    message: 'Your export request has been sent to the owner for approval.',
  });
}
