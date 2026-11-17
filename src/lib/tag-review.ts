import type { SupabaseClient } from '@supabase/supabase-js';
import { isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { listingAccessible } from '@/lib/listing-files-access';
import { suggestListingTag, suggestAllListingTags, listingTagToken, listingTagLabel, type TagListing } from '@/lib/listing-tags';
import { INQUIRY, ASKISH, looksLikeOutreach, looksLikeTenant, isPlainLogLine, verdictFor } from '@/lib/tag-review-hints';

export type Source = 'contact' | 'activity' | 'call' | 'callsummary';
type Db = SupabaseClient;

export type ReviewItem = { source: Source; row_id: string; contact_id: string | null; contact: string; listing_id: string; listing: string; before: string; after: string; at: string | null; outreach: boolean; safe: boolean; verdict: string; hint: string; text: string };
export type ReviewGroup = { listing_id: string; listing: string; n: number; outreach: number; bySource: Record<Source, number> };

export async function listingsFor(db: Db, ctx: CrmContext) {
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

/**
 * Every old note that names one of our properties without a '#', as the "Tag old notes" review shows it (and as the morning alert counts it).
 * Read-only. Respects the caller's listing and contact access (new-lead holds are the broker's alone). Skips: current-tenant rent-roll lines, the CRM's own
 * log lines, answers already given ("Not it"), and outreach contacts already marked as targeted.
 */
export async function computeTagReview(db: Db, ctx: CrmContext) {
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
  let logLinesLeftOut = 0;
  const nameOf = (c: { first_name: string | null; last_name: string | null; business_name: string | null }) => c.business_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Contact';
  const cmap = new Map<string, { name: string; hold: boolean }>();
  function pushRow(source: Source, rowId: string, contactId: string | null, who: string, text: string, at: string | null, targeted: string[] = []) {
    const sg = suggestListingTag(text, listings);
    if (!sg) return;
    if (skipped.has(`${source}:${rowId}:${sg.listing.id}`)) return;
    if (looksLikeTenant(text)) { tenantsLeftOut++; return; }
    if (isPlainLogLine(text)) { logLinesLeftOut++; return; }   // the CRM's own log lines (stage moved, task completed…) never need a person's eyes
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
  // Per-property summary, biggest first, so a whole property can be approved in one go.
  const groups = new Map<string, { listing_id: string; listing: string; n: number; outreach: number; bySource: Record<Source, number> }>();
  for (const i of out) {
    const g = groups.get(i.listing_id) ?? { listing_id: i.listing_id, listing: i.listing, n: 0, outreach: 0, bySource: { contact: 0, activity: 0, call: 0, callsummary: 0 } };
    g.n++; if (i.outreach) g.outreach++; g.bySource[i.source]++; groups.set(i.listing_id, g);
  }
  return { items: out, total: out.length, tenantsLeftOut, logLinesLeftOut, groups: [...groups.values()].sort((a, b) => (b.n - b.outreach) - (a.n - a.outreach) || b.n - a.n) };
}
