import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { normalizeAddress } from '@/lib/broker-ingest/upsert';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export type OwnerSuggestion = { contact_id: string; name: string; email: string | null; ownerName: string; via: string };

/**
 * GET /api/crm/owner-suggestions?listing_id= — who probably owns this property, to link as its Landlord so the weekly owner update has someone to
 * address: the Property DB record for the same street address carries the county owner (and sometimes the CRM contact already tied to it). Matches that
 * owner against your contacts. Suggestions only: nothing is linked until a person taps "Link as Landlord". Empty when a Landlord/Owner is already linked.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id') ?? '';
  if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
  const db = adminClient();
  const { data: l } = await db.from('crm_listings').select('id, address, name, business_unit').eq('id', listingId).maybeSingle();
  if (!l) return notFound('Listing not found');
  const { data: links } = await db.from('crm_listing_contacts').select('role').eq('listing_id', listingId).limit(50);
  if ((links ?? []).some(x => /landlord|owner/i.test(String(x.role ?? '')))) return NextResponse.json({ candidates: [], alreadyLinked: true });

  const unit = String(l.business_unit ?? ctx.businessUnit ?? 'commercial');
  const key = normalizeAddress(String(l.address ?? '')) || normalizeAddress(String(l.name ?? ''));
  if (!key || !/^\d/.test(key)) return NextResponse.json({ candidates: [] });
  const cols = 'id, address, owner_name, owner_client_id';
  let { data: rows } = await db.from('crm_prospective_properties').select(cols).eq('business_unit', unit).eq('address_key', key).limit(5);
  if (!rows?.length) {
    const head = key.split(' ').slice(0, 2).join(' ').replace(/[%_]/g, '');
    const { data: loose } = await db.from('crm_prospective_properties').select(cols).eq('business_unit', unit).like('address_key', `${head}%`).limit(8);
    rows = (loose ?? []).filter(r => { const nk = normalizeAddress(String(r.address ?? '')); return nk === key || nk.startsWith(key) || key.startsWith(nk); });
  }
  const visible = (c: { business_unit: string | null; lead_hold: boolean | null }) => !(c.lead_hold && ctx.role !== 'super_admin') && (isAdminRole(ctx.role) || c.business_unit === ctx.businessUnit);
  const out: OwnerSuggestion[] = []; const seen = new Set<string>();
  const add = (c: { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null }, ownerName: string, via: string) => {
    if (seen.has(c.id)) return; seen.add(c.id);
    out.push({ contact_id: c.id, name: c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', email: c.email ?? null, ownerName, via });
  };
  for (const r of rows ?? []) {
    const ownerName = String(r.owner_name ?? '').trim();
    if (r.owner_client_id) {
      const { data: c } = await db.from('crm_clients').select('id, first_name, last_name, business_name, email, business_unit, lead_hold').eq('id', r.owner_client_id as string).maybeSingle();
      if (c && visible(c)) add(c, ownerName || 'the Property DB record', 'already tied to this address in the Property DB');
    }
    const clean = ownerName.replace(/[%,()"]/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length >= 4) {
      const { data: cs } = await db.from('crm_clients').select('id, first_name, last_name, business_name, email, business_unit, lead_hold').eq('business_unit', unit).or(`business_name.ilike.%${clean}%,last_name.ilike.%${clean}%`).limit(4);
      for (const c of cs ?? []) if (visible(c)) add(c, ownerName, 'matches the county owner name');
    }
  }
  return NextResponse.json({ candidates: out.slice(0, 4) });
}
