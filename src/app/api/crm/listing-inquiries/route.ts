import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/crm/listing-inquiries?listing_id=… — the contacts whose notes (or a logged call / meeting / note) #-tagged this
 * property, e.g. "#1222Chulie". Answers "who asked about this building?" even when no deal exists.
 *
 * Access: the caller must be able to open the listing, and a contact only appears if the caller could open that contact
 * (new-lead holds are the broker's alone; otherwise same workspace, admins see all) — the same rule as assertOwnsResource.
 */
export type InquiryItem = {
  contact_id: string; name: string; type: string | null;
  via: 'notes' | 'call' | 'meeting' | 'email' | 'note';
  last_at: string | null; snippet: string | null;
};

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id') ?? '';
  if (!UUID.test(listingId)) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');

  const db = adminClient();
  const tag = [listingId];
  const [notes, acts] = await Promise.all([
    db.from('crm_clients').select('id, first_name, last_name, business_name, type, business_unit, lead_hold').contains('tagged_listing_ids', tag).limit(200),
    db.from('crm_client_activities').select('id, client_id, type, note, created_at').contains('tagged_listing_ids', tag).order('created_at', { ascending: false }).limit(300),
  ]);
  if (notes.error || acts.error) {
    console.error('[listing-inquiries]', notes.error ?? acts.error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // Contacts that only show up through an activity.
  type ContactRow = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; type: string | null; business_unit: string | null; lead_hold: boolean | null };
  const contacts = new Map<string, ContactRow>();
  for (const c of (notes.data ?? []) as ContactRow[]) contacts.set(c.id, c);
  const missing = [...new Set((acts.data ?? []).map(a => a.client_id as string))].filter(id => !contacts.has(id));
  if (missing.length) {
    const { data } = await db.from('crm_clients').select('id, first_name, last_name, business_name, type, business_unit, lead_hold').in('id', missing);
    for (const c of (data ?? []) as ContactRow[]) contacts.set(c.id, c);
  }

  const visible = (c: ContactRow) => {
    if (c.lead_hold && ctx.role !== 'super_admin') return false;
    return isAdminRole(ctx.role) || c.business_unit === ctx.businessUnit;
  };

  const items = new Map<string, InquiryItem>();
  for (const a of acts.data ?? []) {            // newest first: the first activity per contact is the latest
    const c = contacts.get(a.client_id as string);
    if (!c || !visible(c) || items.has(c.id)) continue;
    const t = String(a.type);
    items.set(c.id, {
      contact_id: c.id, name: c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', type: c.type ?? null,
      via: t === 'call' || t === 'meeting' || t === 'email' ? t : 'note', last_at: a.created_at as string,
      snippet: String(a.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null,
    });
  }
  for (const c of notes.data as ContactRow[]) {  // tagged in the contact's own notes, no logged touch
    if (items.has(c.id) || !visible(c)) continue;
    items.set(c.id, { contact_id: c.id, name: c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', type: c.type ?? null, via: 'notes', last_at: null, snippet: null });
  }

  const list = [...items.values()].sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  return NextResponse.json({ items: list });
}
