import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound } from '@/lib/crm-auth';
import { assertCanSeeRentRoll } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';
import { buildLeasingActivity, type TenantRow } from '@/lib/leasing-activity';
import { toXlsx, summarize } from '@/lib/leasing-activity-xlsx';
import { listingProspects } from '@/lib/listing-prospects';

// Leasing Activity report for a property — the owner/developer's weekly sheet as a
// living document. GET → JSON for the property-card tab; GET ?format=xlsx → the sheet
// in the owner's own layout (Headwall template: green/gold bands, same 14 columns),
// plus a Marketing Activity sheet. POST { listing_id, report_fund } edits the header.

async function load(listingId: string) {
  const db = adminClient();
  const [{ data: listing }, { data: rows }] = await Promise.all([
    db.from('crm_listings').select('id, name, report_fund, listing_agent_id, co_agent_id').eq('id', listingId).single(),
    db.from('crm_property_tenants').select('*').eq('listing_id', listingId),
  ]);
  const agentIds = [listing?.listing_agent_id, listing?.co_agent_id].filter(Boolean) as string[];
  const { data: agents } = agentIds.length
    ? await db.from('crm_profiles').select('id, first_name, last_name').in('id', agentIds)
    : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
  const agent = agentIds.map(id => agents?.find(a => a.id === id)).filter(Boolean)
    .map(a => `${a!.first_name ?? ''} ${a!.last_name ?? ''}`.trim()).join(' / ');
  return { db, listing, sections: buildLeasingActivity((rows ?? []) as TenantRow[]), agent };
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id');
  if (!listingId) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanSeeRentRoll(listingId, ctx))) return notFound('Listing not found');
  const { db, listing, sections, agent } = await load(listingId);
  if (!listing) return notFound('Listing not found');
  const marketing = await listingProspects(db, listingId);
  const header = { property: listing.name as string, fund: (listing.report_fund as string | null) ?? '', agent };

  if (req.nextUrl.searchParams.get('format') !== 'xlsx') {
    return NextResponse.json({ header, sections, marketing: summarize(marketing) });
  }
  const buf = await toXlsx(header, sections, marketing);
  const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).replace(/-/g, '');
  const file = `${stamp} Leasing Activity Report - ${header.property}`.replace(/[^\w .-]+/g, '-') + '.xlsx';
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const listingId = String(body.listing_id ?? '');
  if (!listingId || !(await assertCanSeeRentRoll(listingId, ctx))) return notFound('Listing not found');
  const fund = typeof body.report_fund === 'string' ? body.report_fund.trim().slice(0, 80) || null : null;
  const { error } = await adminClient().from('crm_listings').update({ report_fund: fund }).eq('id', listingId);
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
  return NextResponse.json({ ok: true, report_fund: fund });
}

