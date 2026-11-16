import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { normalizeAddress } from '@/lib/broker-ingest/upsert';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_TABLES: [string, string][] = [
  ['crm_deals', 'Deals'], ['crm_listing_contacts', 'Linked contacts'], ['crm_listing_files', 'Documents & photos'], ['crm_property_tenants', 'Rent roll rows'],
  ['crm_listing_vendors', 'Vendor / building notes'], ['crm_property_suites', 'Suites'], ['office_suites', 'Floor-plan suites'], ['crm_form_submissions', 'Forms'],
  ['crm_envelopes', 'E-sign envelopes'], ['crm_deal_emails', 'Emails'], ['crm_campaigns', 'Campaigns'], ['crm_campaign_projects', 'Campaign projects'],
];
type Row = { id: string; name: string; address: string; status: string; created_at: string; agent_id: string | null; refs: Record<string, number>; refTotal: number; askedPeople: number; targetedPeople: number };

/**
 * Duplicate properties — the same street address saved as more than one listing row (tags land on every copy, so counts double and the owner link can sit
 * on the wrong one). Admins only.
 *  GET  — groups of same-address rows, what each one holds, a suggested keeper (the one with the most attached), and recent merges that can be undone.
 *  POST { keeper, dup } — move everything on `dup` onto `keeper` and mark `dup` status 'merged' (hidden everywhere, never deleted); POST { undo } — put it all back.
 * The work is done by the database functions crm_merge_listings / crm_unmerge_listings in ONE transaction, with a record of every row moved.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const db = adminClient();
  const { data: ls } = await db.from('crm_listings').select('id, name, address, status, created_at, listing_agent_id, flyer_type').eq('business_unit', ctx.businessUnit ?? 'commercial').or('status.is.null,status.neq.merged').limit(1000);
  const groups = new Map<string, NonNullable<typeof ls>>();
  for (const l of ls ?? []) {
    // Some rows (older lease imports) have no address saved and carry it in the name instead.
    const key = normalizeAddress(String(l.address || l.name || '').split(',')[0]);
    if (!key || !/^\d/.test(key)) continue;
    // A sale listing and a lease listing of the SAME building are two different listings (own flyer, own public page), not duplicates: keep them apart.
    const kind = String((l as { flyer_type?: string | null }).flyer_type ?? '').toLowerCase();
    const gk = kind === 'sale' || kind === 'lease' ? `${key}|${kind}` : key;
    groups.set(gk, [...(groups.get(gk) ?? []), l]);
  }
  const dupGroups = [...groups.values()].filter(g => g.length > 1);
  const ids = dupGroups.flatMap(g => g.map(l => l.id as string));
  const refs = new Map<string, Record<string, number>>(); ids.forEach(i => refs.set(i, {}));
  if (ids.length) {
    await Promise.all(REF_TABLES.map(async ([t, label]) => {
      const { data } = await db.from(t).select('listing_id').in('listing_id', ids).limit(5000);
      for (const r of data ?? []) { const m = refs.get(r.listing_id as string); if (m) m[label] = (m[label] ?? 0) + 1; }
    }));
  }
  const people = async (col: string) => { const out = new Map<string, number>(); for (const id of ids) { const { count } = await db.from('crm_clients').select('id', { count: 'exact', head: true }).contains(col, [id]); out.set(id, count ?? 0); } return out; };
  const asked = ids.length ? await people('tagged_listing_ids') : new Map<string, number>();
  const targeted = ids.length ? await people('targeted_listing_ids') : new Map<string, number>();
  const result = dupGroups.map(g => {
    const rows: Row[] = g.map(l => { const m = refs.get(l.id as string) ?? {}; return { id: l.id as string, name: String(l.name ?? ''), address: String(l.address || l.name || '').split(',')[0].trim(), status: String(l.status ?? 'active'), created_at: String(l.created_at ?? ''), agent_id: (l.listing_agent_id as string | null) ?? null, refs: m, refTotal: Object.values(m).reduce((a, b) => a + b, 0), askedPeople: asked.get(l.id as string) ?? 0, targetedPeople: targeted.get(l.id as string) ?? 0 }; });
    const score = (r: Row) => r.refTotal * 10 + (r.status === 'active' ? 5 : 0) + (r.address.includes(',') ? 0 : 1);
    const keeper = [...rows].sort((a, b) => score(b) - score(a))[0].id;
    return { address: rows[0].address.trim(), keeper, rows };
  });
  const { data: recent } = await db.from('crm_listing_merges').select('id, keeper, dup, merged_at, moved').is('undone_at', null).order('merged_at', { ascending: false }).limit(10);
  const idName = new Map<string, string>();
  const rids = [...new Set((recent ?? []).flatMap(m => [m.keeper as string, m.dup as string]))];
  if (rids.length) { const { data: nm } = await db.from('crm_listings').select('id, address, name').in('id', rids); for (const n of nm ?? []) idName.set(n.id as string, String(n.address ?? '').split(',')[0].trim() || String(n.name ?? '')); }
  return NextResponse.json({
    groups: result,
    recent: (recent ?? []).map(m => ({ id: m.id, at: m.merged_at, keeper: idName.get(m.keeper as string) ?? '', dup: idName.get(m.dup as string) ?? '', moved: Object.values((m.moved ?? {}) as Record<string, string[]>).reduce((a, v) => a + v.length, 0) })),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const b = await req.json().catch(() => null);
  const db = adminClient();
  if (typeof b?.undo === 'string') {
    if (!UUID.test(b.undo)) return NextResponse.json({ error: 'bad merge id' }, { status: 400 });
    const { data: m } = await db.from('crm_listing_merges').select('id, keeper').eq('id', b.undo).maybeSingle();
    const { data: k } = m ? await db.from('crm_listings').select('business_unit').eq('id', m.keeper as string).maybeSingle() : { data: null };
    if (!m || !k || k.business_unit !== (ctx.businessUnit ?? 'commercial')) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data, error } = await db.rpc('crm_unmerge_listings', { p_merge: b.undo });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ ok: true, ...(data as object) });
  }
  const keeper = String(b?.keeper ?? ''); const dup = String(b?.dup ?? '');
  if (!UUID.test(keeper) || !UUID.test(dup) || keeper === dup) return NextResponse.json({ error: 'keeper and dup required' }, { status: 400 });
  const { data: both } = await db.from('crm_listings').select('id, business_unit, address, name, status, flyer_type').in('id', [keeper, dup]);
  if ((both ?? []).length !== 2 || (both ?? []).some(r => r.business_unit !== (ctx.businessUnit ?? 'commercial') || r.status === 'merged')) return NextResponse.json({ error: 'Both rows must be unmerged properties in your workspace' }, { status: 409 });
  const kinds = (both ?? []).map(r => String((r as { flyer_type?: string | null }).flyer_type ?? '').toLowerCase()).filter(k => k === 'sale' || k === 'lease');
  if (kinds.length === 2 && kinds[0] !== kinds[1]) return NextResponse.json({ error: 'One is a sale listing and the other a lease listing of the same building: they are two listings, not duplicates' }, { status: 409 });
  const addrOf = (id: string) => { const r = (both ?? []).find(x => x.id === id); return normalizeAddress(String(r?.address || r?.name || '').split(',')[0]); };
  const ka = addrOf(keeper); const da = addrOf(dup);
  if (!ka || ka !== da) return NextResponse.json({ error: 'These two rows do not have the same street address' }, { status: 409 });
  const { data, error } = await db.rpc('crm_merge_listings', { p_keeper: keeper, p_dup: dup, p_by: ctx.userId });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ ok: true, ...(data as object) });
}
