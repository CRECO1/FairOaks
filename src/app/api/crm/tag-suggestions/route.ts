import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { listingAccessible } from '@/lib/listing-files-access';
import { suggestListingTag, suggestAllListingTags, parseListingTagIds, listingTagToken, listingTagLabel, type TagListing } from '@/lib/listing-tags';
import { listingTagIdsForText } from '@/lib/listing-tags-server';
import { mirrorCallNote } from '@/lib/call-note-mirror';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Source = 'contact' | 'activity' | 'call' | 'callsummary';
type Db = ReturnType<typeof adminClient>;
const MAX_BATCH = 500;
/** Notes that are OUTREACH LISTS ("Auto Brite – French Pl (1353 W French Pl) lease prospect — Roofing"), not someone asking about the property.
 *  Tagging those would make "asked about" mean "we targeted them", so the one-tap "Tag all" leaves them out (each can still be tagged by hand). */
const OUTREACH = /\blease prospect\b|\bsale prospect\b|outbound prospect|\bprospect\s*[—–-]|\bprospect for\b|\bprospect list\b|\boutreach\b|\bhit list\b|\benriched \d{4}-\d{2}-\d{2}|\bask for:|\btop target\b/i;
/** Notes that are a CURRENT TENANT's rent-roll line ("… | Unit: 3100 | Rent: $615/mo | Lease …"): they already lease from us, so they are neither inquiries nor outreach targets. Left out of the review altogether. */
const TENANT = /\|\s*unit:\s*\S/i;
const INQUIRY = /engaged:|crexi lead|loopnet lead|inquir|asked about|called about|requested info|viewed space/i;
const looksLikeOutreach = (t: string) => OUTREACH.test(t) && !INQUIRY.test(t);
/** A suggested answer for notes that are neither clearly safe nor outreach: the review shows it as a hint, a person still decides. */
const ASKISH = /\b(asked|asking|interested|wants?|wanted|looking (for|at|to)|inquir|requested?|available|availability|tour|toured|showing|lease rate|how much|call(ed)? (me|back)|returned (a )?call|follow(ed)? up|looked at|visited|came on the tour|found your listing|brochure|flyer|asking price|proposal|loi)\b/i;
/** Notes that are research about who owns the property (county records), a system message, or about the property's own landlord / owner: not someone asking about it. */
const RESEARCH = /\bowner of record\b|\bper bexar cad\b|\bcounty owner\b|\bprop(erty)? id\b\s*\d|\bmailing address\b.*\bsos file\b/i;
const SYSTEM = /^\s*✅?\s*task completed:/i;
const OWNERISH = /\blandlord contact\b|\bproperty manager\b|\bhandles (the )?[^.]{0,40}tenants\b|\bowner of the\b|\bowns\b/i;
type Verdict = 'inquiry' | 'two' | 'general' | 'owner' | 'research' | 'system';
function verdictFor(text: string, namedCount: number, ownerLinked = false): { verdict: Verdict; hint: string } {
  if (namedCount >= 2) return { verdict: 'two', hint: 'Names more than one property' };
  if (SYSTEM.test(text)) return { verdict: 'system', hint: 'System note (a completed task), not a person asking' };
  if (INQUIRY.test(text) && !RESEARCH.test(text)) return { verdict: 'inquiry', hint: 'Looks like an inquiry' };
  if (ownerLinked) return { verdict: 'owner', hint: "Linked to this property as its landlord / owner, so not an inquiry" };
  if (RESEARCH.test(text)) return { verdict: 'research', hint: 'Looks like owner research (county records)' };
  if (OWNERISH.test(text) && !ASKISH.test(text)) return { verdict: 'owner', hint: 'Looks like a landlord / owner / property contact' };
  if (ASKISH.test(text)) return { verdict: 'inquiry', hint: 'Looks like an inquiry' };
  return { verdict: 'general', hint: 'Looks like a general note' };
}
const looksLikeTenant = (t: string) => TENANT.test(t) && !INQUIRY.test(t);

/**
 * Old notes that name one of our properties without a '#' ("called about 1222 Chulie Dr").
 *  GET  — the review list, plus a per-property summary so a whole group can be approved at once.
 *  POST — turns notes into real tags: replaces just that address in each note with its #tag (so the sentence and the tag can't drift
 *         apart) and stores the tag. One row {source,row_id,listing_id}, or a batch {listing_id, items:[{source,row_id}]} (max 500).
 *         Every change reports the exact before/after text so it can be undone.
 *  PUT  — undo: puts the old text and tags back, but only on a note that still reads exactly as the tag left it.
 * Admins only, review-first: nothing changes until a person approves. Respects the same listing and contact access as the rest of
 * tagging (new-lead holds are the broker's alone).
 */
async function listingsFor(db: Db, ctx: CrmContext) {
  const { data } = await db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').eq('business_unit', ctx.businessUnit).or('status.is.null,status.neq.merged');
  return (data ?? []).filter(l => listingAccessible(l as Record<string, unknown>, ctx)) as (TagListing & Record<string, unknown>)[];
}

/** Every contact with a note. The database hands back at most 1,000 rows per request whatever .limit() says, so read it in pages. */
async function allClients(db: Db, unit: string | null) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await db.from('crm_clients').select('id, first_name, last_name, business_name, notes, tagged_listing_ids, targeted_listing_ids, lead_hold')
      .eq('business_unit', unit).not('notes', 'is', null).order('id').range(from, from + 999);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return { data: rows, error: null };
}

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const db = adminClient();
  const listings = await listingsFor(db, ctx);
  const lc = new Map(listings.map(l => [l.id, l]));
  const out: { source: Source; row_id: string; contact_id: string | null; contact: string; listing_id: string; listing: string; before: string; after: string; at: string | null; outreach: boolean; safe: boolean; verdict: string; hint: string; text: string }[] = [];

  const hold = (c: { lead_hold: boolean | null }) => !!c.lead_hold && ctx.role !== 'super_admin';
  const [clients, acts, calls] = await Promise.all([
    allClients(db, ctx.businessUnit),
    db.from('crm_client_activities').select('id, client_id, note, created_at, tagged_listing_ids').not('note', 'is', null).order('created_at', { ascending: false }).limit(1000),
    db.from('crm_call_log').select('id, contact_id, notes, started_at, tagged_listing_ids, caller_name, from_number').eq('business_unit', ctx.businessUnit).not('notes', 'is', null).order('started_at', { ascending: false }).limit(1000),
  ]);
  // "Not it" answers, shared by the whole team (before the table exists, or on any error, nothing is skipped).
  const skipped = new Set<string>();
  for (let from = 0; from < 20000; from += 1000) {
    const { data: sk, error: skErr } = await db.from('crm_tag_review_skips').select('source, row_id, listing_id').eq('business_unit', ctx.businessUnit ?? 'commercial').order('row_id').range(from, from + 999);
    if (skErr) break;
    for (const x of sk ?? []) skipped.add(`${x.source}:${x.row_id}:${x.listing_id}`);
    if ((sk?.length ?? 0) < 1000) break;
  }
  // Contacts linked to a property as its landlord / owner / seller / property manager: a note about them is not "someone asked about it".
  const ownerLinks = new Set<string>();
  {
    const { data: lcs } = await db.from('crm_listing_contacts').select('listing_id, client_id, role').in('listing_id', listings.map(l => l.id)).limit(5000);
    for (const r of lcs ?? []) if (/landlord|owner|seller|property mgr|property manager/i.test(String(r.role ?? ''))) ownerLinks.add(`${r.listing_id}:${r.client_id}`);
  }
  let tenantsLeftOut = 0;
  const nameOf = (c: { first_name: string | null; last_name: string | null; business_name: string | null }) => c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact';
  const cmap = new Map<string, { name: string; hold: boolean }>();
  function pushRow(source: Source, rowId: string, contactId: string | null, who: string, text: string, at: string | null, targeted: string[] = []) {
    const sg = suggestListingTag(text, listings);
    if (!sg) return;
    if (skipped.has(`${source}:${rowId}:${sg.listing.id}`)) return;
    if (looksLikeTenant(text)) { tenantsLeftOut++; return; }
    if (targeted.includes(sg.listing.id) && looksLikeOutreach(text)) return;   // already marked as targeted: done
    const l = lc.get(sg.listing.id)!;
    out.push({ source, row_id: rowId, contact_id: contactId, contact: who, listing_id: l.id, listing: listingTagLabel(l), before: text.slice(Math.max(0, sg.start - 40), sg.end + 40), after: `${text.slice(Math.max(0, sg.start - 40), sg.start)}#${listingTagToken(l)}${text.slice(sg.end, sg.end + 40)}`, at, outreach: looksLikeOutreach(text), safe: INQUIRY.test(text) && !looksLikeOutreach(text), text: text.length > 700 ? text.slice(0, 700) + '…' : text, ...verdictFor(text, suggestAllListingTags(text, listings).length, !!contactId && ownerLinks.has(`${sg.listing.id}:${contactId}`)) });
  }
  for (const c of clients.data ?? []) {
    cmap.set(c.id as string, { name: nameOf(c as never), hold: hold(c as never) });
    if (hold(c as never)) continue;
    pushRow('contact', c.id as string, c.id as string, nameOf(c as never), c.notes as string, null, (c.targeted_listing_ids as string[] | null) ?? []);
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
  // Old phone-bot / voicemail call SUMMARIES that name one of our properties but were never tagged (new ones are tagged as they are saved).
  // Tagging one stores the tag on the call only; the AI-written summary text is never rewritten.
  const callRows: Record<string, unknown>[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await db.from('crm_call_log').select('id, contact_id, summary, ai_meta, started_at, caller_name')
      .eq('business_unit', ctx.businessUnit).not('summary', 'is', null).eq('tagged_listing_ids', '{}').order('started_at', { ascending: false }).range(from, from + 999);
    if (error) break;
    callRows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  for (const k of callRows) {
    const c = k.contact_id ? cmap.get(k.contact_id as string) : null;
    if (c?.hold) continue;
    const text = String(k.summary ?? '');
    const prop = String((k.ai_meta as { property?: string | null } | null)?.property ?? '');
    const hit = suggestAllListingTags(text, listings)[0] ?? (prop ? suggestAllListingTags(prop, listings)[0] : undefined);
    if (!hit || skipped.has(`callsummary:${k.id}:${hit.listing.id}`)) continue;
    const l = lc.get(hit.listing.id); if (!l) continue;
    const snippet = (text.length > 150 ? text.slice(0, 150) + '…' : text).replace(/\s+/g, ' ');
    out.push({ source: 'callsummary', row_id: k.id as string, contact_id: (k.contact_id as string | null) ?? null, contact: c?.name ?? (k.caller_name as string | null) ?? 'Unknown caller', listing_id: l.id, listing: listingTagLabel(l),
      before: snippet, after: `${snippet}  → counts on ${listingTagLabel(l)}`, at: k.started_at as string, outreach: false, safe: ASKISH.test(text) || INQUIRY.test(text), verdict: 'inquiry', hint: 'Phone call summary', text: text.length > 700 ? text.slice(0, 700) + '…' : text });
  }
  if (req.nextUrl.searchParams.get('summary') === '1') return NextResponse.json({ total: out.length });   // just the badge number
  // Per-property summary, biggest first, so a whole property can be approved in one go.
  const groups = new Map<string, { listing_id: string; listing: string; n: number; outreach: number; bySource: Record<Source, number> }>();
  for (const i of out) {
    const g = groups.get(i.listing_id) ?? { listing_id: i.listing_id, listing: i.listing, n: 0, outreach: 0, bySource: { contact: 0, activity: 0, call: 0, callsummary: 0 } };
    g.n++; if (i.outreach) g.outreach++; g.bySource[i.source]++; groups.set(i.listing_id, g);
  }
  return NextResponse.json({ items: out.slice(0, 1500), total: out.length, tenantsLeftOut, groups: [...groups.values()].sort((a, b) => (b.n - b.outreach) - (a.n - a.outreach) || b.n - a.n) });
}

type Applied = { source: Source; row_id: string; listing_id: string; ok: boolean; reason?: string; before?: string; after?: string; tags_before?: string[] };

/** Turn ONE note into a tagged note. Returns what was there before, for undo. */
async function applyOne(db: Db, ctx: CrmContext, listings: (TagListing & Record<string, unknown>)[], source: Source, rowId: string, listingId: string): Promise<Applied> {
  const fail = (reason: string): Applied => ({ source, row_id: rowId, listing_id: listingId, ok: false, reason });
  if (source === 'callsummary') {
    const { data: crow } = await db.from('crm_call_log').select('id, business_unit, contact_id, summary, tagged_listing_ids').eq('id', rowId).maybeSingle();
    if (!crow || crow.business_unit !== ctx.businessUnit) return fail('not found');
    if (crow.contact_id) { const { data: c } = await db.from('crm_clients').select('lead_hold').eq('id', crow.contact_id as string).maybeSingle(); if (c?.lead_hold && ctx.role !== 'super_admin') return fail('not found'); }
    const lst = listings.filter(l => l.id === listingId)[0];
    if (!lst) return fail('not found');
    const ids = parseListingTagIds(`#${listingTagToken(lst)}`, listings);
    const before = ((crow.tagged_listing_ids as string[] | null) ?? []);
    const { error: ce } = await db.from('crm_call_log').update({ tagged_listing_ids: [...new Set([...before, ...ids])] }).eq('id', rowId);
    if (ce) return fail('could not save');
    const txt = String(crow.summary ?? '');
    return { source, row_id: rowId, listing_id: listingId, ok: true, before: txt, after: txt, tags_before: before };
  }
  const table = source === 'contact' ? 'crm_clients' : source === 'activity' ? 'crm_client_activities' : 'crm_call_log';
  const col = source === 'activity' ? 'note' : 'notes';
  const { data: row } = await db.from(table).select(source === 'contact' ? 'id, notes, business_unit, lead_hold, tagged_listing_ids' : source === 'activity' ? 'id, note, client_id, tagged_listing_ids' : 'id, notes, business_unit, contact_id, tagged_listing_ids').eq('id', rowId).maybeSingle();
  if (!row) return fail('not found');
  const r = row as unknown as Record<string, unknown>;
  if (source === 'activity') {
    const { data: c } = await db.from('crm_clients').select('business_unit, lead_hold').eq('id', r.client_id as string).maybeSingle();
    if (!c || c.business_unit !== ctx.businessUnit || (c.lead_hold && ctx.role !== 'super_admin')) return fail('not found');
  } else if (r.business_unit !== ctx.businessUnit || (source === 'contact' && r.lead_hold && ctx.role !== 'super_admin')) return fail('not found');

  const text = String(r[col] ?? '');
  const sg = suggestListingTag(text, listings.filter(l => l.id === listingId));
  if (!sg) return fail('that address is no longer in the note');
  const next = `${text.slice(0, sg.start)}#${listingTagToken(sg.listing)}${text.slice(sg.end)}`;
  const tags = await listingTagIdsForText(db, ctx, ctx.businessUnit ?? 'commercial', next);
  const { error } = await db.from(table).update({ [col]: next, tagged_listing_ids: tags }).eq('id', rowId);
  if (error) return fail('could not save');
  if (source === 'call') await mirrorCallNote(db, rowId, ctx.userId).catch(() => 'skipped');
  return { source, row_id: rowId, listing_id: listingId, ok: true, before: text, after: next, tags_before: (r.tagged_listing_ids as string[] | null) ?? [] };
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const b = await req.json().catch(() => null);
  const listingId = String(b?.listing_id ?? '');
  if (!UUID.test(listingId)) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
  const raw: { source: Source; row_id: string }[] = Array.isArray(b?.items) ? b.items : [{ source: b?.source, row_id: b?.row_id }];
  const items = raw.filter(i => ['contact', 'activity', 'call', 'callsummary'].includes(i?.source) && UUID.test(String(i?.row_id ?? ''))).slice(0, MAX_BATCH);
  if (!items.length) return NextResponse.json({ error: 'source and row_id required' }, { status: 400 });
  const db = adminClient();
  const listings = await listingsFor(db, ctx);
  if (!listings.some(l => l.id === listingId)) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  // "Not it": remembered for the whole team, so nobody reviews the same note twice. Writes nothing to the note itself.
  if (b?.mode === 'skip') {
    const rows = items.map(i => ({ source: i.source, row_id: i.row_id, listing_id: listingId, business_unit: ctx.businessUnit ?? 'commercial', skipped_by: ctx.userId }));
    const { error } = await db.from('crm_tag_review_skips').upsert(rows, { onConflict: 'source,row_id,listing_id' });
    if (error) return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    return NextResponse.json({ ok: true, done: rows.length, skipped: rows.map(r => ({ source: r.source, row_id: r.row_id, listing_id: r.listing_id })) });
  }
  // Outreach lists: record "we targeted these people for this property" WITHOUT touching their notes and without counting them as inquiries.
  if (b?.mode === 'targeted') {
    const ids = items.filter(i => i.source === 'contact').map(i => i.row_id);
    const { data: rows } = ids.length ? await db.from('crm_clients').select('id, business_unit, lead_hold, targeted_listing_ids').in('id', ids) : { data: [] };
    const added: { row_id: string; listing_id: string }[] = [];
    for (const r of rows ?? []) {
      if (r.business_unit !== ctx.businessUnit || (r.lead_hold && ctx.role !== 'super_admin')) continue;
      const cur = (r.targeted_listing_ids as string[] | null) ?? [];
      if (cur.includes(listingId)) continue;
      const { error } = await db.from('crm_clients').update({ targeted_listing_ids: [...cur, listingId], targeted_at: new Date().toISOString() }).eq('id', r.id as string);
      if (!error) added.push({ row_id: r.id as string, listing_id: listingId });
    }
    return NextResponse.json({ ok: true, done: added.length, failed: ids.length - added.length, added });
  }
  const results: Applied[] = [];
  for (const i of items) results.push(await applyOne(db, ctx, listings, i.source, i.row_id, listingId));
  const done = results.filter(r => r.ok);
  if (!Array.isArray(b?.items)) {       // single-row callers (the one-by-one review) keep the simple answer
    return done.length ? NextResponse.json({ ok: true, undo: done }) : NextResponse.json({ error: results[0]?.reason === 'that address is no longer in the note' ? 'That address is no longer in the note' : 'Not found' }, { status: results[0]?.reason === 'not found' ? 404 : 409 });
  }
  return NextResponse.json({ ok: true, done: done.length, failed: results.length - done.length, undo: done });
}

export async function PUT(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const b = await req.json().catch(() => null);
  const undo: Applied[] = Array.isArray(b?.undo) ? b.undo.slice(0, MAX_BATCH) : [];
  const db = adminClient();
  if (Array.isArray(b?.unskip)) {       // undo of "Not it"
    let restored = 0;
    for (const u of (b.unskip as { source: Source; row_id: string; listing_id: string }[]).slice(0, MAX_BATCH)) {
      if (!['contact', 'activity', 'call', 'callsummary'].includes(u?.source) || !UUID.test(String(u?.row_id ?? '')) || !UUID.test(String(u?.listing_id ?? ''))) continue;
      const { error } = await db.from('crm_tag_review_skips').delete().eq('source', u.source).eq('row_id', u.row_id).eq('listing_id', u.listing_id).eq('business_unit', ctx.businessUnit ?? 'commercial');
      if (!error) restored++;
    }
    return NextResponse.json({ ok: true, restored, skipped: 0 });
  }
  if (Array.isArray(b?.untarget)) {       // undo of "mark as targeted": take that property back off those contacts
    let restored = 0;
    for (const u of (b.untarget as { row_id: string; listing_id: string }[]).slice(0, MAX_BATCH)) {
      if (!UUID.test(String(u?.row_id ?? '')) || !UUID.test(String(u?.listing_id ?? ''))) continue;
      const { data: r } = await db.from('crm_clients').select('id, business_unit, targeted_listing_ids').eq('id', u.row_id).maybeSingle();
      if (!r || r.business_unit !== ctx.businessUnit) continue;
      const { error } = await db.from('crm_clients').update({ targeted_listing_ids: ((r.targeted_listing_ids as string[] | null) ?? []).filter(x => x !== u.listing_id) }).eq('id', u.row_id);
      if (!error) restored++;
    }
    return NextResponse.json({ ok: true, restored, skipped: 0 });
  }
  let restored = 0, skipped = 0;
  for (const u of undo) {
    if (!['contact', 'activity', 'call', 'callsummary'].includes(u?.source) || !UUID.test(String(u?.row_id ?? '')) || typeof u.before !== 'string' || typeof u.after !== 'string') { skipped++; continue; }
    if (u.source === 'callsummary') {      // tags only: the summary text was never changed, so there is nothing else to put back
      const { data: cr } = await db.from('crm_call_log').select('id, business_unit').eq('id', u.row_id).maybeSingle();
      if (!cr || cr.business_unit !== ctx.businessUnit) { skipped++; continue; }
      const tg = Array.isArray(u.tags_before) ? u.tags_before.filter((x: unknown): x is string => typeof x === 'string' && UUID.test(x)) : [];
      const { error: ue } = await db.from('crm_call_log').update({ tagged_listing_ids: tg }).eq('id', u.row_id);
      if (ue) skipped++; else restored++;
      continue;
    }
    const table = u.source === 'contact' ? 'crm_clients' : u.source === 'activity' ? 'crm_client_activities' : 'crm_call_log';
    const col = u.source === 'activity' ? 'note' : 'notes';
    const { data: row } = await db.from(table).select(`id, ${col}, ${u.source === 'activity' ? 'client_id' : 'business_unit'}`).eq('id', u.row_id).maybeSingle();
    const r = row as unknown as Record<string, unknown> | null;
    // Only a note that still reads exactly as the tag left it (someone may have edited it since), in this workspace.
    if (!r || String(r[col] ?? '') !== u.after) { skipped++; continue; }
    if (u.source !== 'activity' && r.business_unit !== ctx.businessUnit) { skipped++; continue; }
    if (u.source === 'activity') {
      const { data: c } = await db.from('crm_clients').select('business_unit').eq('id', r.client_id as string).maybeSingle();
      if (!c || c.business_unit !== ctx.businessUnit) { skipped++; continue; }
    }
    const tags = Array.isArray(u.tags_before) ? u.tags_before.filter((x: unknown): x is string => typeof x === 'string' && UUID.test(x)) : [];
    const { error } = await db.from(table).update({ [col]: u.before, tagged_listing_ids: tags }).eq('id', u.row_id);
    if (error) { skipped++; continue; }
    if (u.source === 'call') await mirrorCallNote(db, u.row_id, ctx.userId).catch(() => 'skipped');
    restored++;
  }
  return NextResponse.json({ ok: true, restored, skipped });
}
