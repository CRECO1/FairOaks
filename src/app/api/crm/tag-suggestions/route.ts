import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { listingAccessible } from '@/lib/listing-files-access';
import { suggestListingTag, listingTagToken, listingTagLabel, type TagListing } from '@/lib/listing-tags';
import { listingTagIdsForText } from '@/lib/listing-tags-server';
import { mirrorCallNote } from '@/lib/call-note-mirror';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Source = 'contact' | 'activity' | 'call';

/**
 * Old notes that name one of our properties without a '#' ("called about 1222 Chulie Dr"). GET lists them for review; POST turns ONE
 * of them into a real tag: it replaces just that address in the note with its #tag (so the sentence and the tag can't drift apart) and
 * stores the tag. Admins only, review-first: nothing changes until a person approves each one. Respects the same listing and
 * contact access as the rest of tagging (new-lead holds are the broker's alone).
 */
async function listingsFor(db: ReturnType<typeof adminClient>, ctx: CrmContext) {
  const { data } = await db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').eq('business_unit', ctx.businessUnit);
  return (data ?? []).filter(l => listingAccessible(l as Record<string, unknown>, ctx)) as (TagListing & Record<string, unknown>)[];
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const db = adminClient();
  const listings = await listingsFor(db, ctx);
  const lc = new Map(listings.map(l => [l.id, l]));
  const out: { source: Source; row_id: string; contact_id: string | null; contact: string; listing_id: string; listing: string; before: string; after: string; at: string | null }[] = [];

  const hold = (c: { lead_hold: boolean | null }) => !!c.lead_hold && ctx.role !== 'super_admin';
  const [clients, acts, calls] = await Promise.all([
    db.from('crm_clients').select('id, first_name, last_name, business_name, notes, tagged_listing_ids, lead_hold').eq('business_unit', ctx.businessUnit).not('notes', 'is', null).limit(6000),
    db.from('crm_client_activities').select('id, client_id, note, created_at, tagged_listing_ids').not('note', 'is', null).order('created_at', { ascending: false }).limit(3000),
    db.from('crm_call_log').select('id, contact_id, notes, started_at, tagged_listing_ids, caller_name, from_number').eq('business_unit', ctx.businessUnit).not('notes', 'is', null).order('started_at', { ascending: false }).limit(2000),
  ]);
  const nameOf = (c: { first_name: string | null; last_name: string | null; business_name: string | null }) => c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact';
  const cmap = new Map<string, { name: string; hold: boolean }>();
  for (const c of clients.data ?? []) {
    cmap.set(c.id as string, { name: nameOf(c as never), hold: hold(c as never) });
    if (hold(c as never)) continue;
    pushRow('contact', c.id as string, c.id as string, nameOf(c as never), c.notes as string, null);
  }
  function pushRow(source: Source, rowId: string, contactId: string | null, who: string, text: string, at: string | null) {
    const sg = suggestListingTag(text, listings);
    if (!sg) return;
    const l = lc.get(sg.listing.id)!;
    out.push({ source, row_id: rowId, contact_id: contactId, contact: who, listing_id: l.id, listing: listingTagLabel(l), before: text.slice(Math.max(0, sg.start - 40), sg.end + 40), after: `${text.slice(Math.max(0, sg.start - 40), sg.start)}#${listingTagToken(l)}${text.slice(sg.end, sg.end + 40)}`, at });
  }
  for (const a of acts.data ?? []) {
    const c = cmap.get(a.client_id as string);
    if (!c || c.hold) continue;
    pushRow('activity', a.id as string, a.client_id as string, c.name, a.note as string, a.created_at as string);
  }
  for (const k of calls.data ?? []) {
    const c = k.contact_id ? cmap.get(k.contact_id as string) : null;
    if (c?.hold) continue;
    pushRow('call', k.id as string, (k.contact_id as string | null) ?? null, c?.name ?? (k.caller_name as string | null) ?? 'Unknown caller', k.notes as string, k.started_at as string);
  }
  return NextResponse.json({ items: out.slice(0, 300), total: out.length });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const b = await req.json().catch(() => null);
  const source = b?.source as Source; const rowId = String(b?.row_id ?? ''); const listingId = String(b?.listing_id ?? '');
  if (!['contact', 'activity', 'call'].includes(source) || !UUID.test(rowId) || !UUID.test(listingId)) return NextResponse.json({ error: 'source, row_id and listing_id required' }, { status: 400 });
  const db = adminClient();
  const listings = await listingsFor(db, ctx);
  if (!listings.some(l => l.id === listingId)) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  const table = source === 'contact' ? 'crm_clients' : source === 'activity' ? 'crm_client_activities' : 'crm_call_log';
  const col = source === 'activity' ? 'note' : 'notes';
  const { data: row } = await db.from(table).select(source === 'contact' ? `id, notes, business_unit, lead_hold` : source === 'activity' ? 'id, note, client_id' : 'id, notes, business_unit, contact_id').eq('id', rowId).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const r = row as unknown as Record<string, unknown>;
  // Same workspace + hold rules as the list.
  if (source === 'activity') {
    const { data: c } = await db.from('crm_clients').select('business_unit, lead_hold').eq('id', r.client_id as string).maybeSingle();
    if (!c || c.business_unit !== ctx.businessUnit || (c.lead_hold && ctx.role !== 'super_admin')) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } else if (r.business_unit !== ctx.businessUnit || (source === 'contact' && r.lead_hold && ctx.role !== 'super_admin')) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const text = String(r[col] ?? '');
  const only = listings.filter(l => l.id === listingId);
  const sg = suggestListingTag(text, only);
  if (!sg) return NextResponse.json({ error: 'That address is no longer in the note' }, { status: 409 });
  const next = `${text.slice(0, sg.start)}#${listingTagToken(sg.listing)}${text.slice(sg.end)}`;
  const tags = await listingTagIdsForText(db, ctx, ctx.businessUnit ?? 'commercial', next);
  const { error } = await db.from(table).update({ [col]: next, tagged_listing_ids: tags }).eq('id', rowId);
  if (error) return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  if (source === 'call') await mirrorCallNote(db, rowId, ctx.userId).catch(() => 'skipped');
  return NextResponse.json({ ok: true });
}
