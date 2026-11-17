import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized } from '@/lib/crm-auth';
import { buildOverview } from '@/lib/listing-inquiries';
import { ownerCandidates, type OwnerSuggestion } from '@/lib/owner-candidates';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export type OwnerGap = {
  listing_id: string; listing: string; asked: number; targeted: number; deals: number;
  /** Landlord / owner contacts already linked but with no email, so the weekly update still has nobody to go to. */
  linkedNoEmail: { client_id: string; name: string }[];
  candidates: OwnerSuggestion[];
};

/**
 * GET /api/crm/owner-gaps — the properties that have tagged interest but no landlord / owner with an email linked, so their weekly owner update is addressed to the
 * agent. For each: who is linked but missing an email, and who probably owns it (county owner matched against your contacts). Suggestions only; linking happens
 * when a person taps (POST /api/crm/listing-contacts, the same call the property card uses). Same property visibility as the interest overview.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const db = adminClient();
  const rows = (await buildOverview(ctx)).filter(r => !r.hasOwnerEmail);
  if (!rows.length) return NextResponse.json({ rows: [], total: 0 });
  const { data: lst } = await db.from('crm_listings').select('id, name, address, business_unit').in('id', rows.map(r => r.listing_id));
  const meta = new Map((lst ?? []).map(l => [l.id as string, l]));
  const { data: links } = await db.from('crm_listing_contacts').select('listing_id, role, client_id, crm_clients(first_name, last_name, business_name, email)').in('listing_id', rows.map(r => r.listing_id)).limit(2000);
  const out: OwnerGap[] = [];
  for (const r of rows) {
    const l = meta.get(r.listing_id); if (!l) continue;
    const linkedNoEmail = (links ?? []).filter(x => x.listing_id === r.listing_id && /landlord|owner/i.test(String(x.role ?? ''))).map(x => {
      const c = (Array.isArray(x.crm_clients) ? x.crm_clients[0] : x.crm_clients) as { first_name?: string | null; last_name?: string | null; business_name?: string | null; email?: string | null } | null;
      return { client_id: x.client_id as string, name: c?.business_name || `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || 'Contact', email: c?.email ?? null };
    }).filter(c => !c.email).map(c => ({ client_id: c.client_id, name: c.name }));
    out.push({ listing_id: r.listing_id, listing: r.listing, asked: r.asked, targeted: r.targeted, deals: r.deals, linkedNoEmail, candidates: await ownerCandidates(db, ctx, l).catch(() => []) });
  }
  return NextResponse.json({ rows: out, total: out.length });
}
