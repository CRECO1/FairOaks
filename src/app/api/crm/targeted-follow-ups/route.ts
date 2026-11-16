import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { listingAccessible } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export type TargetedFollowUp = { contact_id: string; name: string; first_name: string; email: string | null; listing_id: string; listing: string; days: number };

/**
 * GET /api/crm/targeted-follow-ups?days=30 — people we reached out to about a property (marked 🎯 targeted) who still have not written back
 * after `days` days (default 30). An agent sees them for the listings they list or are assigned to; an admin sees every property in their
 * workspace. A reply is any email received from them since they were marked; those contacts are moved to "asked" by the daily replies job instead.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 30));
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = adminClient();

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await db.from('crm_clients').select('id, first_name, last_name, business_name, email, targeted_listing_ids, targeted_at, business_unit, lead_hold')
      .not('targeted_listing_ids', 'eq', '{}').lte('targeted_at', cutoff).eq('business_unit', ctx.businessUnit ?? 'commercial').order('id').range(from, from + 999);
    if (error) return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const contacts = rows.filter(c => !(c.lead_hold && ctx.role !== 'super_admin'));
  if (!contacts.length) return NextResponse.json({ items: [], total: 0 });

  const listingIds = [...new Set(contacts.flatMap(c => (c.targeted_listing_ids as string[]) ?? []))];
  const { data: lst } = await db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').in('id', listingIds);
  const mine = new Map((lst ?? []).filter(l => listingAccessible(l as Record<string, unknown>, ctx)
    && (isAdminRole(ctx.role) || l.listing_agent_id === ctx.userId || ((l.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId))).map(l => [l.id as string, l]));

  // Anyone who has written back since being marked is not "no reply".
  const replied = new Set<string>();
  const ids = contacts.map(c => c.id as string);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: em } = await db.from('crm_deal_emails').select('client_id, email_date').eq('direction', 'received').in('client_id', ids.slice(i, i + 200)).limit(1000);
    for (const e of em ?? []) {
      const c = contacts.find(x => x.id === e.client_id);
      if (c && String(e.email_date ?? '') >= String(c.targeted_at ?? '').slice(0, 10)) replied.add(e.client_id as string);
    }
  }
  const out: TargetedFollowUp[] = [];
  for (const c of contacts) {
    if (replied.has(c.id as string)) continue;
    const lid = ((c.targeted_listing_ids as string[]) ?? []).find(id => mine.has(id));
    if (!lid) continue;
    const l = mine.get(lid)!;
    out.push({
      contact_id: c.id as string, name: (c.business_name as string) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', first_name: String(c.first_name ?? ''),
      email: (c.email as string | null) ?? null, listing_id: lid, listing: String(l.address ?? '').split(',')[0].trim() || String(l.name ?? 'Property'),
      days: Math.floor((Date.now() - Date.parse(String(c.targeted_at))) / 86_400_000),
    });
  }
  out.sort((a, b) => b.days - a.days);
  return NextResponse.json({ items: out.slice(0, 100), total: out.length });
}
