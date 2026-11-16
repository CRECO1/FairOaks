import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, isAdminRole, hiddenDealIds } from '@/lib/crm-auth';
import { assertCanAccessListing } from '@/lib/listing-files-access';
import { canAccessLinked } from '@/lib/crm-linked-access';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/crm/listing-inquiries?listing_id=… — who asked about this property: contacts whose notes (or a logged call / meeting /
 * note) #-tagged it, e.g. "#1222Chulie", calls whose note tagged it from a caller who is not a contact yet, and deals whose
 * notes (summary, dated notes, meetings) tagged it.
 * Answers "who asked about this building?" even when no deal exists.
 *
 * Access: the caller must be able to open the listing, and a contact only appears if the caller could open that contact
 * (new-lead holds are the broker's alone; otherwise same workspace, admins see all) — the same rule as assertOwnsResource.
 */
export type InquiryItem = {
  key: string;                    // contact id, `call:<id>` for a caller who is not a contact, or `deal:<id>`
  contact_id: string | null;      // null = unknown caller or a deal
  deal_id?: string | null;        // set for a deal entry (openable)
  name: string; type: string | null;
  via: 'notes' | 'call' | 'meeting' | 'email' | 'note' | 'deal';
  last_at: string | null; snippet: string | null;
};

const prettyPhone = (n: string | null | undefined) => { const d = String(n ?? '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (n ?? '') || 'Unknown caller'; };

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const listingId = req.nextUrl.searchParams.get('listing_id') ?? '';
  if (!UUID.test(listingId)) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  if (!(await assertCanAccessListing(listingId, ctx))) return notFound('Listing not found');

  const db = adminClient();
  const tag = [listingId];
  const [notes, acts, calls] = await Promise.all([
    db.from('crm_clients').select('id, first_name, last_name, business_name, type, business_unit, lead_hold').contains('tagged_listing_ids', tag).limit(200),
    db.from('crm_client_activities').select('id, client_id, type, note, created_at').contains('tagged_listing_ids', tag).order('created_at', { ascending: false }).limit(300),
    db.from('crm_call_log').select('id, business_unit, contact_id, deal_id, direction, caller_name, from_number, to_number, started_at, notes, summary').contains('tagged_listing_ids', tag).order('started_at', { ascending: false }).limit(200),
  ]);
  if (notes.error || acts.error || calls.error) {
    console.error('[listing-inquiries]', notes.error ?? acts.error ?? calls.error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // Contacts that only show up through an activity.
  type ContactRow = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; type: string | null; business_unit: string | null; lead_hold: boolean | null };
  const contacts = new Map<string, ContactRow>();
  for (const c of (notes.data ?? []) as ContactRow[]) contacts.set(c.id, c);
  const missing = [...new Set([...(acts.data ?? []).map(a => a.client_id as string), ...(calls.data ?? []).map(c => c.contact_id as string | null).filter((x): x is string => !!x)])].filter(id => !contacts.has(id));
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
      key: c.id, contact_id: c.id, name: c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', type: c.type ?? null,
      via: t === 'call' || t === 'meeting' || t === 'email' ? t : 'note', last_at: a.created_at as string,
      snippet: String(a.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null,
    });
  }
  for (const c of notes.data as ContactRow[]) {  // tagged in the contact's own notes, no logged touch
    if (items.has(c.id) || !visible(c)) continue;
    items.set(c.id, { key: c.id, contact_id: c.id, name: c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', type: c.type ?? null, via: 'notes', last_at: null, snippet: null });
  }

  // Calls whose note tagged this property. A call from someone who is not a contact yet is exactly "the property they called on".
  // Same visibility as the Calling Log: your workspace (admins: any), and a call on a deal you can't see stays hidden.
  const dealCalls: { deal_id: string; at: string | null; snippet: string | null }[] = [];
  for (const call of calls.data ?? []) {
    if (!isAdminRole(ctx.role) && call.business_unit !== ctx.businessUnit) continue;
    if (call.deal_id && !(await canAccessLinked(ctx, { business_unit: call.business_unit as string, deal_id: call.deal_id as string }))) continue;
    const snippet = String(call.notes || call.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160) || null;
    // A call logged ON a deal belongs under that deal (below), not as a separate caller.
    if (call.deal_id) { dealCalls.push({ deal_id: call.deal_id as string, at: call.started_at as string | null, snippet }); continue; }
    const c = call.contact_id ? contacts.get(call.contact_id as string) : null;
    if (c) {
      if (!visible(c)) continue;
      const have = items.get(c.id);
      if (have && (have.last_at ?? '') >= String(call.started_at ?? '')) continue;   // the contact's own entry is newer
      items.set(c.id, { key: c.id, contact_id: c.id, name: c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact', type: c.type ?? null, via: 'call', last_at: call.started_at as string, snippet });
    } else {
      const num = call.direction === 'outbound' ? call.to_number : call.from_number;
      items.set(`call:${call.id}`, { key: `call:${call.id}`, contact_id: null, name: (call.caller_name as string | null) || prettyPhone(num as string | null), type: null, via: 'call', last_at: call.started_at as string, snippet });
    }
  }

  // Deals whose notes tagged this property. A deal is visible only if the caller could open it (agents: only deals they are on;
  // Restricted deals: owner / assigned / super_admin) and it is in their workspace.
  const [dealsTagged, dealNotes, dealMeets] = await Promise.all([
    db.from('crm_deals').select('id, client, property, business_unit, notes').contains('tagged_listing_ids', tag).limit(100),
    db.from('crm_deal_notes').select('deal_id, body, created_at').contains('tagged_listing_ids', tag).order('created_at', { ascending: false }).limit(200),
    db.from('crm_deal_meetings').select('deal_id, note, meeting_date, created_at').contains('tagged_listing_ids', tag).order('created_at', { ascending: false }).limit(200),
  ]);
  if (!dealsTagged.error && !dealNotes.error && !dealMeets.error) {
    const hidden = new Set(await hiddenDealIds(ctx));
    type DealRow = { id: string; client: string | null; property: string | null; business_unit: string | null };
    const deals = new Map<string, DealRow>();
    for (const d of (dealsTagged.data ?? []) as DealRow[]) deals.set(d.id, d);
    const missingDeals = [...new Set([...(dealNotes.data ?? []).map(n => n.deal_id as string), ...(dealMeets.data ?? []).map(m => m.deal_id as string), ...dealCalls.map(c => c.deal_id)])].filter(id => !deals.has(id));
    if (missingDeals.length) {
      const { data } = await db.from('crm_deals').select('id, client, property, business_unit').in('id', missingDeals);
      for (const d of (data ?? []) as DealRow[]) deals.set(d.id, d);
    }
    const latest = new Map<string, { at: string | null; snippet: string | null }>();
    for (const n of dealNotes.data ?? []) if (!latest.has(n.deal_id as string)) latest.set(n.deal_id as string, { at: n.created_at as string, snippet: String(n.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null });
    for (const m of dealMeets.data ?? []) {
      const at = (m.created_at as string) ?? null; const cur = latest.get(m.deal_id as string);
      if (!cur || (at ?? '') > (cur.at ?? '')) latest.set(m.deal_id as string, { at, snippet: String(m.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null });
    }
    for (const c of dealCalls) {
      const cur = latest.get(c.deal_id);
      if (!cur || (c.at ?? '') > (cur.at ?? '')) latest.set(c.deal_id, { at: c.at, snippet: c.snippet });
    }
    for (const d of deals.values()) {
      if (hidden.has(d.id)) continue;
      if (!isAdminRole(ctx.role) && d.business_unit !== ctx.businessUnit) continue;
      const l = latest.get(d.id);
      items.set(`deal:${d.id}`, { key: `deal:${d.id}`, contact_id: null, deal_id: d.id, name: [d.client, d.property].filter(Boolean).join(' — ') || 'Deal', type: 'Deal', via: 'deal', last_at: l?.at ?? null, snippet: l?.snippet ?? null });
    }
  }

  const list = [...items.values()].sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  return NextResponse.json({ items: list });
}
