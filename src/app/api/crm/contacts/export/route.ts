import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmSuperAdmin, unauthorized, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';

/**
 * Bulk export of the contact database — the one route that hands the book over.
 *
 * Owner only. Zack decided nobody but the account owner exports, ever, so there
 * is no approval path any more: this is a flat super_admin check. The gate lives
 * here rather than in the UI on purpose — this is where the data actually
 * leaves, so hiding the button is presentation, not enforcement.
 *
 * A non-owner reaching this endpoint is by definition someone calling the API
 * directly, since they have no export affordance in the app at all. That is
 * worth knowing about, so the refusal is logged as export_blocked rather than
 * being answered silently.
 *
 * Honest limit: an agent signed into the CRM already has the contacts they can
 * see loaded in their browser to display them. This governs the export feature
 * — it is not a control against someone copying what is on their own screen.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  if (!(await getCrmSuperAdmin(req))) {
    await writeAuditLog({
      actorId: ctx.userId,
      action: 'export_blocked',
      targetType: 'crm_clients',
      metadata: { reason: 'not_owner', role: ctx.role, business_unit: ctx.businessUnit, path: 'contacts' },
      req,
    });
    return forbidden('Exporting contacts is limited to the account owner.');
  }

  const idsParam = req.nextUrl.searchParams.get('ids');
  const ids = idsParam ? idsParam.split(',').map(s => s.trim()).filter(Boolean) : null;
  const unit = req.nextUrl.searchParams.get('unit') ?? ctx.businessUnit ?? 'commercial';
  const scope = { ids: ids && ids.length ? ids : null };

  const db = adminClient();
  let q = db.from('crm_clients')
    .select('first_name,last_name,business_name,type,email,phone,cell_phone,budget,size_range,asset_types,address,city,state,zip,brokerage,license,notes,business_unit,lead_source,tags,created_at,last_touched_at')
    .eq('business_unit', unit)
    .order('last_name');
  if (scope.ids) q = q.in('id', scope.ids);

  const { data, error } = await q;
  if (error) { console.error('[api] db error:', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }

  // Every export the owner takes is still recorded — who, which unit, how many
  // rows, when. Removing the approval workflow does not remove the trail.
  await writeAuditLog({
    actorId: ctx.userId,
    action: 'export_contacts',
    targetType: 'crm_clients',
    metadata: {
      unit,
      count: data?.length ?? 0,
      selection: scope.ids ? `${scope.ids.length} selected` : 'all',
      via: 'owner_direct',
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
