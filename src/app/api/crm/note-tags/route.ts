import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, assertOwnsResource, isAdminRole } from '@/lib/crm-auth';
import { listingAccessible, rentRollAccessible } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/crm/note-tags?contact_id=… — every property note that @-tags this contact: the property's Internal Notes,
 * a suite's notes (Floor Plan), a Rent Roll note, a vendor / building note. The contact card shows these as chips.
 *
 * Each source keeps its own access rule, so a tag can never be used to read a note the caller couldn't open:
 * property + vendor/building notes follow listing access (workspace, Restricted folders); Rent Roll rows are owner-level
 * information and only show to the property's own / assigned agents and admins; suite notes are workspace-wide, like
 * the Floor Plan itself.
 */
export type NoteTagItem = { kind: 'property' | 'suite' | 'rentroll' | 'vendor'; listing_id: string | null; label: string; detail: string };

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const contactId = req.nextUrl.searchParams.get('contact_id') ?? '';
  if (!UUID.test(contactId)) return NextResponse.json({ error: 'contact_id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_clients', contactId, ctx))) return notFound('Contact not found');

  const db = adminClient();
  const tagged = [contactId];
  const [lst, suites, tenants, vendors] = await Promise.all([
    db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').contains('tagged_contact_ids', tagged).limit(100),
    db.from('office_suites').select('id, business_unit, listing_id, suite_number, tenant_name').contains('tagged_contact_ids', tagged).limit(100),
    db.from('crm_property_tenants').select('id, listing_id, suite, tenant_name').contains('tagged_contact_ids', tagged).limit(100),
    db.from('crm_listing_vendors').select('id, listing_id, label, vendor, category').contains('tagged_contact_ids', tagged).limit(100),
  ]);
  if (lst.error || suites.error || tenants.error || vendors.error) {
    console.error('[note-tags]', lst.error ?? suites.error ?? tenants.error ?? vendors.error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // The parent listing of every hit, for names and for the access rules.
  const ids = new Set<string>();
  for (const r of [...(suites.data ?? []), ...(tenants.data ?? []), ...(vendors.data ?? [])]) if (r.listing_id) ids.add(r.listing_id as string);
  const parents = new Map<string, Record<string, unknown>>();
  for (const l of lst.data ?? []) parents.set(l.id as string, l);
  const missing = [...ids].filter(i => !parents.has(i));
  if (missing.length) {
    const { data } = await db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').in('id', missing);
    for (const l of data ?? []) parents.set(l.id as string, l);
  }
  const nameOf = (id: string | null | undefined) => { const l = id ? parents.get(id) : null; return String(l?.name || l?.address || 'a property'); };

  const items: NoteTagItem[] = [];
  for (const l of lst.data ?? []) if (listingAccessible(l, ctx)) items.push({ kind: 'property', listing_id: l.id as string, label: nameOf(l.id as string), detail: 'Internal notes' });
  for (const r of suites.data ?? []) {
    if (!isAdminRole(ctx.role) && r.business_unit !== ctx.businessUnit) continue;
    items.push({ kind: 'suite', listing_id: (r.listing_id as string | null) ?? null, label: `${nameOf(r.listing_id as string | null)} · Suite ${r.suite_number ?? ''}`.trim(), detail: 'Suite notes' });
  }
  for (const r of tenants.data ?? []) {
    const p = parents.get(r.listing_id as string);
    if (p && rentRollAccessible(p, ctx)) items.push({ kind: 'rentroll', listing_id: r.listing_id as string, label: `${nameOf(r.listing_id as string)} · ${r.tenant_name || `Suite ${r.suite ?? ''}`}`.trim(), detail: 'Rent roll notes' });
  }
  for (const r of vendors.data ?? []) {
    const p = parents.get(r.listing_id as string);
    if (p && listingAccessible(p, ctx)) items.push({ kind: 'vendor', listing_id: r.listing_id as string, label: `${nameOf(r.listing_id as string)} · ${r.label || r.vendor || 'Building note'}`, detail: r.category === 'building_info' ? 'Building notes' : 'Vendor notes' });
  }
  return NextResponse.json({ items });
}
