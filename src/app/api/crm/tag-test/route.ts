import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { listingAccessible } from '@/lib/listing-files-access';
import { parseListingTagIds, suggestAllListingTags, listingTagLabel, type TagListing } from '@/lib/listing-tags';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/crm/tag-test { text } — admins: paste any text (a note, a call summary) and see which of our properties the tagger would attach, and how
 * (typed #tag, or an address named without a #). Reads only; nothing is saved and nobody is notified.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const b = await req.json().catch(() => null);
  const text = typeof b?.text === 'string' ? b.text.slice(0, 4000) : '';
  if (!text.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 });
  const { data } = await adminClient().from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').eq('business_unit', ctx.businessUnit ?? 'commercial').or('status.is.null,status.neq.merged');
  const listings = (data ?? []).filter(l => listingAccessible(l as Record<string, unknown>, ctx)) as (TagListing & Record<string, unknown>)[];
  const byId = new Map(listings.map(l => [l.id, l]));
  const out: { listing: string; how: string }[] = [];
  const seen = new Set<string>();
  for (const id of parseListingTagIds(text, listings)) { const l = byId.get(id); if (l && !seen.has(id)) { seen.add(id); out.push({ listing: listingTagLabel(l), how: 'a #tag in the text' }); } }
  for (const m of suggestAllListingTags(text, listings)) { if (!seen.has(m.listing.id)) { seen.add(m.listing.id); out.push({ listing: listingTagLabel(m.listing), how: 'an address named without a # (a call summary or lead import would tag this; a typed note shows the "Tag it" chip)' }); } }
  return NextResponse.json({ matches: out });
}
