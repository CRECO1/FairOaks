/**
 * GET /api/crm/property-performance?days=30                → one compact row per property you can see
 * GET /api/crm/property-performance?days=30&listing_id=<id> → full detail for one property
 *
 * What each property's web pages are doing — real visitors, actions, inquiries, deals — from the
 * first-party tracker, with the same real-visitor definition as the Lead Attribution funnel.
 * Access follows the property itself (assertCanAccessListing / the listings list rules): anyone
 * who can open a property card can see how its pages perform. Aggregate site traffic stays owner-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { loadPropertyPerformance, type PerfListing } from '@/lib/property-performance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = 'id, name, address, web_paths, lead_keywords, business_unit, status, is_restricted, listing_agent_id, assigned_agent_ids';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const dRaw = Number(req.nextUrl.searchParams.get('days') ?? 30);
  const days = [7, 30, 90].includes(dRaw) ? dRaw : 30;
  const listingId = req.nextUrl.searchParams.get('listing_id');
  const db = adminClient();

  try {
    if (listingId) {
      if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');
      const { data } = await db.from('crm_listings').select(COLS).eq('id', listingId).maybeSingle();
      if (!data) return notFound('Listing not found');
      const perf = (await loadPropertyPerformance(db, [data as PerfListing], days, days <= 90)).get(listingId);
      return NextResponse.json({ days, listing: { id: data.id, name: data.name, web_paths: data.web_paths ?? [] }, perf });
    }

    const admin = isAdminRole(ctx.role);
    const unit = admin ? (req.nextUrl.searchParams.get('unit') ?? ctx.businessUnit ?? 'commercial') : (ctx.businessUnit ?? 'commercial');
    const { data } = await db.from('crm_listings').select(COLS).eq('business_unit', unit).limit(200);
    const visible = (data ?? []).filter((l: Record<string, unknown>) =>
      admin || !l.is_restricted || l.listing_agent_id === ctx.userId
      || (Array.isArray(l.assigned_agent_ids) && (l.assigned_agent_ids as string[]).includes(ctx.userId)));
    const perf = await loadPropertyPerformance(db, visible as unknown as PerfListing[], days, true);
    const rows = [...perf.values()].map(p => ({
      listingId: p.listingId, name: p.name, matched: p.tokens.length > 0,
      views: p.current.views, visitors: p.current.visitors, real: p.current.real, acted: p.current.acted,
      inquiries: p.current.inquiries, previousReal: p.previous?.real ?? null,
    })).sort((a, b) => b.real - a.real || b.inquiries - a.inquiries);
    return NextResponse.json({ days, rows });
  } catch (e) {
    console.error('[property-performance]', e);
    return NextResponse.json({ error: 'Could not load property performance.' }, { status: 500 });
  }
}
