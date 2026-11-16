import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crm/lead-tag-health — admins: of the leads that arrived in the last 7 days (email, website, webhook, platform imports),
 * how many got a property tag at import and which ones named no property. If "untagged" climbs, the matching missed a new email format.
 * New-lead holds are the broker's alone, so for anyone but a super_admin they are left out of the numbers.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await adminClient().from('crm_clients')
    .select('id, first_name, last_name, business_name, lead_source, notes, tagged_listing_ids, created_at, lead_hold')
    .eq('business_unit', ctx.businessUnit ?? 'commercial').gte('created_at', since).not('lead_source', 'is', null).neq('lead_source', '')
    .overlaps('tags', ['auto-imported', 'direct-inquiry', 'New Lead', 'Website Lead']).order('created_at', { ascending: false }).limit(300);
  if (error) return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  const rows = (data ?? []).filter(c => !(c.lead_hold && ctx.role !== 'super_admin'));
  const untagged = rows.filter(c => !((c.tagged_listing_ids as string[] | null) ?? []).length);
  return NextResponse.json({
    total: rows.length, tagged: rows.length - untagged.length, untagged: untagged.length,
    items: untagged.slice(0, 25).map(c => ({
      id: c.id, name: (c.business_name as string) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Lead', source: c.lead_source, at: c.created_at,
      snippet: String(c.notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) || null,
    })),
  });
}
