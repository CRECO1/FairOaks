import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { suggestListingTag, parseListingTagIds, listingTagToken, type TagListing } from '@/lib/listing-tags';
import { computeTagReview, listingsFor, type Source } from '@/lib/tag-review';
import { listingTagIdsForText } from '@/lib/listing-tags-server';
import { mirrorCallNote } from '@/lib/call-note-mirror';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Db = ReturnType<typeof adminClient>;
const MAX_BATCH = 500;

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
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const db = adminClient();
  const r = await computeTagReview(db, ctx);
  if (req.nextUrl.searchParams.get('summary') === '1') return NextResponse.json({ total: r.total });   // just the badge number
  return NextResponse.json({ items: r.items.slice(0, 1500), total: r.total, tenantsLeftOut: r.tenantsLeftOut, logLinesLeftOut: r.logLinesLeftOut, groups: r.groups });
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
