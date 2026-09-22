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
  TOKEN_TTL_MS, type ExportScope, type ExportDataset,
} from '@/lib/export-approval';

const DATASETS: ExportDataset[] = ['contacts', 'commissions', 'commissions_1099'];

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

/**
 * How many rows this request would actually hand over, counted server-side so the
 * approval email cannot understate the size of what is being asked for.
 *
 * The 1099 view aggregates commissions per agent, so its "rows" are recipients,
 * not commission records — counted as distinct agents in that year.
 */
async function countScope(
  db: ReturnType<typeof adminClient>,
  dataset: ExportDataset,
  unit: string,
  ids: string[] | null,
  filters?: Record<string, string | undefined>,
): Promise<number> {
  if (dataset === 'contacts') {
    let q = db.from('crm_clients').select('id', { count: 'exact', head: true }).eq('business_unit', unit);
    if (ids) q = q.in('id', ids);
    const { count } = await q;
    return count ?? 0;
  }

  if (dataset === 'commissions_1099') {
    let q = db.from('crm_commissions').select('agent_id').eq('business_unit', unit);
    if (filters?.year) q = q.gte('close_date', `${filters.year}-01-01`).lte('close_date', `${filters.year}-12-31`);
    const { data } = await q;
    return new Set((data ?? []).map(r => r.agent_id).filter(Boolean)).size;
  }

  let q = db.from('crm_commissions').select('id', { count: 'exact', head: true }).eq('business_unit', unit);
  if (filters?.year) q = q.gte('close_date', `${filters.year}-01-01`).lte('close_date', `${filters.year}-12-31`);
  if (filters?.agent) q = q.eq('agent_id', filters.agent);
  if (filters?.status) q = q.eq('status', filters.status);
  const { count } = await q;
  return count ?? 0;
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

  // Which body of data. Unrecognised values fall back to contacts rather than
  // being trusted — the dataset decides what gets counted and handed over.
  const dataset: ExportDataset = DATASETS.includes(body.dataset) ? body.dataset : 'contacts';
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const filters = dataset === 'contacts'
    ? undefined
    : { year: str(body.year), agent: str(body.agent_id), status: str(body.status) };

  const scope: ExportScope = { dataset, businessUnit: unit, ids, filters };
  const key = scopeKey(scope);

  // Count server-side. A client-supplied count would make the approval email
  // lie about the size of what is being handed over.
  const rowCount = await countScope(db, dataset, unit, ids, filters);

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
