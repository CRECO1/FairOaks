import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmSuperAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';
import { scopeKey, findRedeemableApproval, type ExportScope } from '@/lib/export-approval';

/**
 * Bulk export of the contact database — the one route that hands the book over.
 *
 * The owner exports directly; he is the approver. Everyone else needs a live
 * approval for this exact scope, granted by the owner, unexpired and not yet
 * spent. That check happens here rather than in the UI on purpose: this is
 * where the data actually leaves, so this is where the gate has to be.
 *
 * Approval is never standing. Redeeming one marks it consumed, and the next
 * export starts the conversation again.
 *
 * Honest limit: an agent signed into the CRM already has the contacts they can
 * see loaded in their browser to display them. This governs the export feature
 * and makes every use of it visible and answerable — it is not a control
 * against someone copying what is already on their own screen.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const isOwner = !!(await getCrmSuperAdmin(req));

  const idsParam = req.nextUrl.searchParams.get('ids');
  const ids = idsParam ? idsParam.split(',').map(s => s.trim()).filter(Boolean) : null;

  // An agent exports their own unit whatever they ask for; the owner may pick.
  const requestedUnit = req.nextUrl.searchParams.get('unit') ?? ctx.businessUnit ?? 'commercial';
  const unit = isOwner ? requestedUnit : (ctx.businessUnit ?? requestedUnit);

  const scope: ExportScope = { businessUnit: unit, ids: ids && ids.length ? ids : null };
  const key = scopeKey(scope);

  let redeemedId: string | null = null;

  if (!isOwner) {
    const check = await findRedeemableApproval(ctx.userId, key);
    if (!check.ok) {
      // 403 with the reason spelled out — "awaiting approval" and "denied" are
      // different answers and the requester should not have to guess which.
      await writeAuditLog({
        actorId: ctx.userId,
        action: 'export_blocked',
        targetType: 'crm_clients',
        metadata: { unit, scope_key: key, status: check.status ?? 'none' },
        req,
      });
      return NextResponse.json(
        { error: check.reason, status: check.status ?? 'none', needsApproval: true },
        { status: 403 },
      );
    }
    redeemedId = check.requestId!;
  }

  const db = adminClient();
  let q = db.from('crm_clients')
    .select('first_name,last_name,business_name,type,email,phone,cell_phone,budget,size_range,asset_types,address,city,state,zip,brokerage,license,notes,business_unit,lead_source,tags,created_at,last_touched_at')
    .eq('business_unit', unit)
    .order('last_name');
  if (scope.ids) q = q.in('id', scope.ids);

  const { data, error } = await q;
  if (error) { console.error('[api] db error:', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }

  // Spend the approval only once the rows are actually in hand, so a failed
  // query does not burn the requester's permission.
  if (redeemedId) {
    await db.from('crm_export_requests')
      .update({ status: 'consumed', consumed_at: new Date().toISOString() })
      .eq('id', redeemedId).eq('status', 'approved');
  }

  await writeAuditLog({
    actorId: ctx.userId,
    action: 'export_contacts',
    targetType: 'crm_clients',
    targetId: redeemedId ?? undefined,
    metadata: {
      unit,
      count: data?.length ?? 0,
      scope_key: key,
      via: isOwner ? 'owner_direct' : 'approved_request',
    },
    req,
  });

  const headers = ['First Name','Last Name','Business Name','Type','Email','Phone','Cell Phone','Budget','Size Range','Asset Types','Address','City','State','ZIP','Brokerage','License','Notes','Business Unit','Lead Source','Tags','Created','Last Touched'];
  const rows = (data ?? []).map(c => [
    c.first_name ?? '', c.last_name ?? '', c.business_name ?? '', c.type ?? '',
    c.email ?? '', c.phone ?? '', c.cell_phone ?? '', c.budget ?? '', c.size_range ?? '',
    (c.asset_types ?? []).join('; '), c.address ?? '', c.city ?? '', c.state ?? '', c.zip ?? '',
    c.brokerage ?? '', c.license ?? '', c.notes ?? '', c.business_unit ?? '', c.lead_source ?? '',
    (c.tags ?? []).join('; '),
    c.created_at ? new Date(c.created_at).toLocaleDateString() : '',
    c.last_touched_at ? new Date(c.last_touched_at).toLocaleDateString() : '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="contacts-${unit}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
