import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { listingAccessible } from '@/lib/listing-files-access';
import { buildInquiries, taggedListingIds } from '@/lib/listing-inquiries';
import { adminClient } from '@/lib/supabase-admin';
import { heatFor } from '@/lib/follow-up-heat';

export const dynamic = 'force-dynamic';

export type FollowUp = { contact_id: string; name: string; listing_id: string; listing: string; days: number; snippet: string | null; heat: 'hot' | 'warm' | 'cool'; score: number; reasons: string[] };

/**
 * GET /api/crm/listing-follow-ups — people who asked about a property (a #tag) a week or more ago and have had nothing logged since, best-first: ranked by how likely they are to
 * be worth a call (asked more than once, toured, asked about price, wrote back, a broker with a client, how recent), with the reasons.
 * An agent sees them for the listings they list or are assigned to; an admin sees every property in their workspace. Each entry comes from
 * the same function as the property's own "Asked about" list (same access rules), so nothing appears here that the list would hide.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const db = adminClient();
  const ids = await taggedListingIds();
  if (!ids.length) return NextResponse.json({ items: [], total: 0 });
  const { data } = await db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').in('id', ids);
  const mine = (data ?? []).filter(l => listingAccessible(l as Record<string, unknown>, ctx)
    && (isAdminRole(ctx.role) || l.listing_agent_id === ctx.userId || ((l.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId)));
  const out: FollowUp[] = [];
  await Promise.all(mine.map(async l => {
    const r = await buildInquiries(ctx, l.id as string);
    if (!r.ok) return;
    const label = String(l.address ?? '').split(',')[0].trim() || String(l.name ?? 'Property');
    for (const it of r.items) {
      if (!it.needs_follow_up || !it.contact_id || !it.last_at) continue;
      const days = Math.floor((Date.now() - Date.parse(it.last_at)) / 86_400_000);
      const h = heatFor({ asks: it.asks ?? 1, signals: it.signals ?? [], days, wroteBack: !!it.wrote_back });
      out.push({ contact_id: it.contact_id, name: it.name, listing_id: l.id as string, listing: label, days, snippet: it.snippet, heat: h.label, score: h.score, reasons: h.reasons });
    }
  }));
  // Someone who asked twice and toured last week comes before a one-off from months ago; ties go to whoever has waited longest.
  out.sort((a, b) => b.score - a.score || b.days - a.days);
  return NextResponse.json({ items: out.slice(0, 50), total: out.length });
}
