import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmSuperAdmin, unauthorized, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';
import { scopeKey, findRedeemableApproval, type ExportScope, type ExportDataset } from '@/lib/export-approval';

/**
 * Bulk export of the commission ledger and the 1099-NEC summary.
 *
 * These used to be built in the browser from data the commissions page had
 * already loaded, behind nothing but an isAdmin check on the button — so an
 * admin could take every agent's splits, or every contractor's tax totals,
 * with no request, no approval and no audit row. Per row this is more
 * sensitive than the contact book.
 *
 * Now it works exactly like the contact export: the owner (super_admin) is the
 * approver and exports directly; everyone else, admins included, needs a live
 * approval for this exact scope. The gate lives here, where the data actually
 * leaves, rather than on the button.
 *
 * Honest limit, same as the contact export: this governs the export feature.
 * An admin looking at the commissions page can already read what is on their
 * screen. What this removes is the one-click, whole-ledger file.
 */

const LIST_HEADERS = ['Deal','Property','Agent','Deal Type','Sale Price','Rate %','Gross GCI','Agent Split %','Agent Net','Brokerage Net','Referral Fee','Referral To','Tx Fee','Status','Close Date','Paid Date','Notes'];
const NEC_HEADERS  = ['Recipient Name','Email','Phone','License #','Box 1 NEC','Deal Count','Filing Required'];

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csvRow = (r: unknown[]) => r.map(csvCell).join(',');

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  // The commissions ledger is broker-level data; agents have no view of it at
  // all, approval or not. This route is about gating the people who CAN see it.
  const isOwner = !!(await getCrmSuperAdmin(req));
  const isAdmin = ctx.role === 'admin' || ctx.role === 'super_admin';
  if (!isAdmin) return forbidden('The commission ledger is broker-level.');

  const sp = req.nextUrl.searchParams;
  const view = sp.get('view') === '1099' ? '1099' : 'list';
  const dataset: ExportDataset = view === '1099' ? 'commissions_1099' : 'commissions';
  const unit = isOwner ? (sp.get('unit') ?? ctx.businessUnit ?? 'commercial') : (ctx.businessUnit ?? 'commercial');

  const str = (v: string | null) => (v && v.trim() ? v.trim() : undefined);
  const filters = { year: str(sp.get('year')), agent: str(sp.get('agent_id')), status: str(sp.get('status')) };
  // The 1099 view is a per-agent aggregate for one tax year; the other filters
  // do not apply to it, and letting them into the key would let an approval for
  // a narrow slice be redeemed for the whole year.
  const effective: Record<string, string | undefined> =
    view === '1099' ? { year: filters.year } : filters;

  const scope: ExportScope = { dataset, businessUnit: unit, ids: null, filters: effective };
  const key = scopeKey(scope);

  let redeemedId: string | null = null;
  if (!isOwner) {
    const check = await findRedeemableApproval(ctx.userId, key);
    if (!check.ok) {
      await writeAuditLog({
        actorId: ctx.userId, action: 'export_blocked', targetType: 'crm_commissions',
        metadata: { unit, dataset, scope_key: key, status: check.status ?? 'none' }, req,
      });
      return NextResponse.json(
        { error: check.reason, status: check.status ?? 'none', needsApproval: true },
        { status: 403 },
      );
    }
    redeemedId = check.requestId!;
  }

  const db = adminClient();
  let q = db.from('crm_commissions')
    .select('*, deal:crm_deals(client,property), agent:crm_profiles!agent_id(first_name,last_name,email,phone,license)')
    .eq('business_unit', unit)
    .order('close_date', { ascending: false, nullsFirst: false });
  if (effective.year)   q = q.gte('close_date', `${effective.year}-01-01`).lte('close_date', `${effective.year}-12-31`);
  if (effective.agent)  q = q.eq('agent_id', effective.agent);
  if (effective.status) q = q.eq('status', effective.status);

  const { data, error } = await q;
  if (error) { console.error('[api/commissions/export]', error); return NextResponse.json({ error: 'Internal server error.' }, { status: 500 }); }
  const rows = data ?? [];

  let csv: string;
  let count: number;
  if (view === '1099') {
    // Box 1 is what the brokerage paid the contractor: their net, not the GCI.
    const byAgent = new Map<string, { a: Record<string, any>; total: number; deals: number }>();
    for (const c of rows as Record<string, any>[]) {
      if (!c.agent_id) continue;
      const e = byAgent.get(c.agent_id) ?? { a: c.agent ?? {}, total: 0, deals: 0 };
      e.total += Number(c.agent_net) || 0;
      e.deals += 1;
      byAgent.set(c.agent_id, e);
    }
    const out = [...byAgent.values()].sort((x, y) => y.total - x.total);
    count = out.length;
    csv = [NEC_HEADERS.join(','), ...out.map(r => csvRow([
      `${r.a.first_name ?? ''} ${r.a.last_name ?? ''}`.trim(), r.a.email ?? '', r.a.phone ?? '', r.a.license ?? '',
      r.total.toFixed(2), r.deals, r.total >= 600 ? 'YES' : 'No',
    ]))].join('\n');
  } else {
    count = rows.length;
    csv = [LIST_HEADERS.join(','), ...(rows as Record<string, any>[]).map(c => csvRow([
      c.deal?.client ?? '', c.deal?.property ?? '',
      c.agent ? `${c.agent.first_name ?? ''} ${c.agent.last_name ?? ''}`.trim() : '',
      c.deal_type ?? '', c.sale_price, c.commission_rate, c.gross_commission, c.agent_split,
      c.agent_net, c.brokerage_net, c.referral_fee, c.referral_to ?? '', c.transaction_fee,
      c.status, c.close_date ?? '', c.paid_date ?? '', c.notes ?? '',
    ]))].join('\n');
  }

  // Spend the approval only once the rows are in hand, so a failed query does
  // not burn the requester's permission.
  if (redeemedId) {
    await db.from('crm_export_requests')
      .update({ status: 'consumed', consumed_at: new Date().toISOString() })
      .eq('id', redeemedId).eq('status', 'approved');
  }

  await writeAuditLog({
    actorId: ctx.userId, action: 'export_contacts', targetType: 'crm_commissions',
    targetId: redeemedId ?? undefined,
    metadata: { unit, dataset, count, scope_key: key, via: isOwner ? 'owner_direct' : 'approved_request' },
    req,
  });

  const name = view === '1099' ? `1099-nec-${effective.year ?? 'all'}` : `commissions-${effective.year ?? 'all'}`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
