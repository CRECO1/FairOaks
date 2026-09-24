import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, forbidden, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';

/**
 * Merge duplicate contacts into one surviving record.
 *
 * Body: { primaryId: string, dupIds: string[] }
 * The survivor (primaryId) keeps its identity; each dup's blanks fill the survivor's
 * blanks, all emails/tags/asset-types/notes are unioned, every deal/task/activity/
 * enrollment/import pointing at a dup is repointed to the survivor, then the dups are
 * deleted. Super-admin only — the same tier that may delete contacts. Runs on the
 * service-role client (so ref-reassignment isn't blocked by RLS), gated by the auth
 * check above.
 */

// Tables whose client_id must move from the merged-away duplicates to the survivor.
const REF_TABLES: [string, string][] = [
  ['crm_deals', 'client_id'],
  ['crm_tasks', 'client_id'],
  ['crm_client_activities', 'client_id'],
  ['crm_activity', 'client_id'],
  ['crm_campaign_enrollments', 'client_id'],
  ['email_lead_imports', 'client_id'],
];

const norm = (e?: string | null) => String(e ?? '').toLowerCase().trim().replace(/,+$/, '');
const uniq = <T,>(a: T[]) => [...new Set(a)];

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (ctx.role !== 'super_admin') return forbidden('Only a super admin can merge contacts.');

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const primaryId: string = typeof body.primaryId === 'string' ? body.primaryId : '';
  const dupIds: string[] = (Array.isArray(body.dupIds) ? (body.dupIds as unknown[]) : [])
    .filter((x): x is string => typeof x === 'string' && x !== primaryId)
    .filter((x, i, a) => a.indexOf(x) === i);
  if (!primaryId || dupIds.length === 0) {
    return NextResponse.json({ error: 'primaryId and a non-empty dupIds are required' }, { status: 400 });
  }
  if (dupIds.length > 50) {
    return NextResponse.json({ error: 'Refusing to merge more than 50 duplicates at once' }, { status: 400 });
  }

  const db = adminClient();
  const { data: rows, error } = await db.from('crm_clients').select('*').in('id', [primaryId, ...dupIds]);
  if (error) return dbError('load contacts', error);
  const primary = (rows ?? []).find(r => r.id === primaryId);
  const dups = (rows ?? []).filter(r => dupIds.includes(r.id));
  if (!primary || dups.length === 0) return NextResponse.json({ error: 'Contacts not found' }, { status: 404 });

  // Safety: same workspace, and a unit-scoped admin can only touch their own workspace.
  const unit = primary.business_unit;
  if (ctx.businessUnit && unit !== ctx.businessUnit) return forbidden('Contact is in a different workspace.');
  if (dups.some(d => d.business_unit !== unit)) {
    return NextResponse.json({ error: 'All contacts must be in the same workspace.' }, { status: 400 });
  }

  // Enrichment: fill the survivor's blanks, union multi-value fields, keep every email.
  const patch: Record<string, unknown> = {};
  const FILL = ['phone', 'cell_phone', 'business_name', 'brokerage', 'license', 'address', 'city', 'state', 'zip', 'lead_source', 'birthday', 'budget', 'size_range', 'lease_expiration_date'];
  for (const f of FILL) {
    if (!String((primary as Record<string, unknown>)[f] ?? '').trim()) {
      const hit = dups.find(d => String((d as Record<string, unknown>)[f] ?? '').trim());
      if (hit) patch[f] = (hit as Record<string, unknown>)[f];
    }
  }
  const allEmails: string[] = [];
  for (const r of [primary, ...dups]) {
    for (const e of [r.email, ...((r.extra_emails as string[] | null) ?? [])]) {
      const n = norm(e);
      if (n && n.includes('@') && !allEmails.includes(n)) allEmails.push(n);
    }
  }
  if (allEmails.length) {
    const pe = norm(primary.email) || allEmails[0];
    patch.email = pe;
    patch.extra_emails = allEmails.filter(e => e !== pe);
  }
  patch.tags = uniq([...((primary.tags as string[] | null) ?? []), ...dups.flatMap(d => (d.tags as string[] | null) ?? [])]);
  patch.asset_types = uniq([...((primary.asset_types as string[] | null) ?? []), ...dups.flatMap(d => (d.asset_types as string[] | null) ?? [])]);
  const notes = uniq([primary.notes, ...dups.map(d => d.notes)].map(x => String(x ?? '').trim()).filter(Boolean));
  if (notes.length > 1) patch.notes = notes.join('\n\n');

  const { error: pErr } = await db.from('crm_clients').update(patch).eq('id', primaryId);
  if (pErr) return dbError('enrich survivor', pErr);

  // Repoint every reference off the duplicates and onto the survivor (best-effort per table).
  let refsMoved = 0;
  for (const [table, col] of REF_TABLES) {
    const { data, error: rErr } = await db.from(table).update({ [col]: primaryId }).in(col, dupIds).select('id');
    if (!rErr) refsMoved += (data ?? []).length;
  }

  const { error: dErr } = await db.from('crm_clients').delete().in('id', dupIds);
  if (dErr) return dbError('delete duplicates', dErr);

  await writeAuditLog({
    actorId: ctx.userId,
    action: 'merge_contacts',
    targetType: 'crm_clients',
    targetId: primaryId,
    metadata: { primaryId, dupIds, merged: dups.length, refsMoved, businessUnit: unit },
    req,
  }).catch(() => {});

  const { data: updated } = await db.from('crm_clients').select('*').eq('id', primaryId).single();
  return NextResponse.json({ ok: true, primary: updated, merged: dups.length, refsMoved });
}
