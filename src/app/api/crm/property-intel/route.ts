import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, assertOwnsResource } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { normalizeAddress } from '@/lib/broker-ingest/upsert';
import { parseCountyAppraisal } from '@/lib/county-notes';
import { lookupBexar } from '@/lib/county-live';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crm/property-intel?deal_id=…
 *
 * What the CRM already knows about a deal's property, for the deal card's Property Intel tab — free, no outside call:
 *   • the Property DB record at the same street address (county appraisal: owner, market value, parcel, acres… that the county job filled in)
 *   • our own listing, when the deal is tied to one
 *   • the county's own public parcel record, looked up live by street address (Bexar County for now)
 * `attomConfigured` says whether the paid ATTOM lookup can work at all (its key is not set today), so the tab only offers it when it can.
 * The deal is checked the same way every deal read is (workspace + the agent must be on it).
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const dealId = req.nextUrl.searchParams.get('deal_id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return NextResponse.json({ error: 'deal_id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');

  const db = adminClient();
  const { data: deal } = await db.from('crm_deals').select('property, listing_id, business_unit').eq('id', dealId).maybeSingle();
  if (!deal) return notFound('Deal not found');
  const unit = (deal.business_unit as string) || 'commercial';
  const attomConfigured = !!process.env.ATTOM_API_KEY;

  // 1) The same street address in the Property DB. Exact key first; otherwise the same street number + first street word.
  const key = normalizeAddress(deal.property as string | null);
  let match: Record<string, unknown> | null = null; let others = 0;
  if (key && /^\d/.test(key)) {
    const cols = 'id,name,address,city,state,zip,asset_type,size_sf,year_built,zoning,lot_size_acres,parcel_apn,owner_name,owner_client_id,listing_company,listing_agent_name,vacancy_status,asking_rate,notes';
    const { data: exact } = await db.from('crm_prospective_properties').select(cols).eq('business_unit', unit).eq('address_key', key).limit(3);
    let rows = (exact ?? []) as unknown as Record<string, unknown>[];
    if (!rows.length) {
      const head = key.split(' ').slice(0, 2).join(' ');
      const { data: loose } = await db.from('crm_prospective_properties').select(cols).eq('business_unit', unit).like('address_key', `${head.replace(/[%_]/g, '')}%`).limit(5);
      rows = ((loose ?? []) as unknown as Record<string, unknown>[]).filter(r => { const k = String(r.address ?? ''); const nk = normalizeAddress(k); return nk === key || nk.startsWith(key) || key.startsWith(nk); });
    }
    if (rows.length) {
      // Prefer the row that carries the county appraisal.
      rows.sort((a, b) => Number(!!parseCountyAppraisal(String(b.notes ?? ''))) - Number(!!parseCountyAppraisal(String(a.notes ?? ''))));
      const { notes, ...rest } = rows[0];
      match = { ...rest, county: parseCountyAppraisal(String(notes ?? '')) };
      others = rows.length - 1;
    }
  }

  // 2) Our own listing, when the deal is tied to one.
  let listing: Record<string, unknown> | null = null;
  if (deal.listing_id) {
    const { data: l } = await db.from('crm_listings').select('id,name,address,city,state,zip,type,status,sq_ft,asking_price,zoning,year_built,lot_size').eq('id', deal.listing_id as string).eq('business_unit', unit).maybeSingle();
    listing = (l as Record<string, unknown> | null) ?? null;
  }

  // 3) No county appraisal on file for it yet: ask the county's own free public records (Bexar) — owner, parcel, legal. Only for a real street address.
  const hasCounty = !!(match && (match as { county?: unknown }).county);
  const live = hasCounty ? null : await lookupBexar(String(deal.property ?? ''));

  return NextResponse.json({ address: deal.property ?? '', match, otherMatches: others, listing, live, attomConfigured });
}
