import type { SupabaseClient } from '@supabase/supabase-js';
import { isAdminRole, type CrmContext } from '@/lib/crm-auth';
import { listingAccessible } from '@/lib/listing-files-access';
import { buildInquiries } from '@/lib/listing-inquiries';

export type ReofferAsker = { contact_id: string; name: string; first: string; email: string | null; asked_at: string | null; snippet: string | null; skip: string | null; drafted: boolean };
export type ReofferAlt = { id: string; label: string; type: string | null; sq_ft: number | null; price: string | null; city: string | null };
export type Reoffer = {
  listing: { id: string; label: string; status: string; flyer_type: string | null; type: string | null };
  askers: ReofferAsker[]; alternatives: ReofferAlt[];
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const STATUS_LINE: Record<string, string> = { leased: 'has now been leased', sold: 'has now sold', pending: 'is now under contract, so it is likely no longer available' };
export const REOFFER_STATUSES = Object.keys(STATUS_LINE);
const labelOf = (l: { address?: string | null; name?: string | null }) => String(l.address ?? '').split(',')[0].trim() || String(l.name ?? 'the property');
const price = (l: { asking_price?: number | null; flyer_type?: string | null }) => {
  if (!l.asking_price || !l.flyer_type) return null;
  const n = Number(l.asking_price); if (!Number.isFinite(n) || n <= 0) return null;
  return /lease/i.test(l.flyer_type) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}/SF/yr` : /sale/i.test(l.flyer_type) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : null;
};

/**
 * When a property leases or sells, who asked about it (by a #tag) and which of OUR other active listings might suit them. Read-only: people with no email, an
 * unsubscribed or dead address, or a held lead are listed with the reason and left out. Alternatives are only our own active, non-restricted listings of the same
 * kind (lease vs sale) and asset type, nearest in size first: never another broker's space.
 */
export async function buildReoffer(db: SupabaseClient, ctx: CrmContext, listingId: string): Promise<Reoffer | null> {
  const { data: l } = await db.from('crm_listings').select('id, name, address, city, type, status, flyer_type, sq_ft, asking_price, business_unit, listing_agent_id, assigned_agent_ids, is_restricted').eq('id', listingId).maybeSingle();
  if (!l || !listingAccessible(l as Record<string, unknown>, ctx)) return null;
  if (!isAdminRole(ctx.role) && l.listing_agent_id !== ctx.userId && !((l.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId)) return null;
  const inq = await buildInquiries(ctx, listingId);
  if (!inq.ok) return null;
  const people = inq.items.filter(i => i.contact_id && i.via !== 'deal' && i.via !== 'task');
  const ids = [...new Set(people.map(i => i.contact_id as string))];
  const { data: cs } = ids.length ? await db.from('crm_clients').select('id, first_name, last_name, business_name, email, unsubscribed_at, lead_hold').in('id', ids) : { data: [] };
  const cmap = new Map((cs ?? []).map(c => [c.id as string, c]));
  const { data: dead } = await db.from('crm_dead_emails').select('email');
  const deadSet = new Set((dead ?? []).map(d => String(d.email ?? '').toLowerCase()));
  const { data: dr } = await db.from('crm_email_drafts').select('draft_key').eq('user_id', ctx.userId).like('draft_key', 'reoffer:%').limit(1000);
  const drafted = new Set((dr ?? []).map(d => String(d.draft_key)));

  const askers: ReofferAsker[] = people.map(i => {
    const c = cmap.get(i.contact_id as string);
    const email = String(c?.email ?? '').trim() || null;
    const skip = !c ? 'not found' : c.lead_hold ? 'new lead on hold' : !email ? 'no email on file' : c.unsubscribed_at ? 'unsubscribed' : deadSet.has(email.toLowerCase()) ? 'email address bounced' : null;
    return { contact_id: i.contact_id as string, name: i.name, first: String(c?.first_name ?? '').trim(), email, asked_at: i.last_at, snippet: i.snippet, skip, drafted: drafted.has(`reoffer:${i.contact_id}:${listingId}`) };
  });

  // Our other active listings of the same kind and asset type, closest in size first.
  const { data: alts } = await db.from('crm_listings').select('id, name, address, city, type, status, flyer_type, sq_ft, asking_price, business_unit, listing_agent_id, assigned_agent_ids, is_restricted')
    .eq('business_unit', l.business_unit).eq('status', 'active').neq('id', listingId).limit(200);
  const kind = (t: unknown) => (/lease/i.test(String(t ?? '')) ? 'lease' : /sale/i.test(String(t ?? '')) ? 'sale' : '');
  const alternatives = (alts ?? []).filter(a => !a.is_restricted && listingAccessible(a as Record<string, unknown>, ctx) && (!kind(l.flyer_type) || kind(a.flyer_type) === kind(l.flyer_type)))
    .filter(a => !!a.type && !!l.type && String(a.type).toLowerCase() === String(l.type).toLowerCase())
    .map(a => {
      const sf = Number(a.sq_ft) || 0, want_sf = Number(l.sq_ft) || 0;
      const gap = sf && want_sf ? Math.abs(Math.log(sf / want_sf)) : 2;   // unknown size sorts after known sizes
      const near = String(a.city ?? '').trim().toLowerCase() && String(a.city ?? '').trim().toLowerCase() === String(l.city ?? '').trim().toLowerCase() ? -0.3 : 0;
      return { a, score: gap + near };
    }).sort((x, y) => x.score - y.score).slice(0, 3)
    .map(({ a }) => ({ id: a.id as string, label: labelOf(a), type: (a.type as string | null) ?? null, sq_ft: a.sq_ft ? Number(a.sq_ft) : null, price: price(a), city: (a.city as string | null) ?? null }));
  return { listing: { id: l.id as string, label: labelOf(l), status: String(l.status ?? ''), flyer_type: (l.flyer_type as string | null) ?? null, type: (l.type as string | null) ?? null }, askers, alternatives };
}

/** The draft email body for one asker: what happened, a short list of our listings that may fit (only facts we hold), and the agent's own signature. */
export function reofferBody(first: string, r: Reoffer, signature: string): string {
  const line = STATUS_LINE[r.listing.status] ?? 'is no longer available';
  const alts = r.alternatives.map(a => `<li><b>${esc(a.label)}</b>${[a.type, a.sq_ft ? `${a.sq_ft.toLocaleString('en-US')} SF` : null, a.city, a.price].filter(Boolean).map(x => ` · ${esc(String(x))}`).join('')}</li>`).join('');
  return `<p>Hi ${esc(first || 'there')},</p><p>Thanks again for asking about ${esc(r.listing.label)}. I wanted to let you know it ${esc(line)}.</p>`
    + (alts ? `<p>A few of our current listings that may fit what you were looking for:</p><ul>${alts}</ul><p>You can see everything we have at <a href="https://www.crecotx.com/listings">crecotx.com/listings</a>.</p>` : `<p>You can see what we currently have at <a href="https://www.crecotx.com/listings">crecotx.com/listings</a>.</p>`)
    + `<p>If you tell me the size, budget and timing you are working with, I will keep an eye out and send you the right space as soon as it comes up.</p>${signature ? `<br>${signature}` : ''}`;
}

/**
 * Save re-offer emails as DRAFTS in the caller's own Drafts (their signature, their review): never sent from here. Idempotent per person per property: someone who
 * already has a re-offer draft for it is skipped, so a second tap never overwrites an edited draft.
 */
export async function saveReofferDrafts(db: SupabaseClient, ctx: CrmContext, r: Reoffer, contactIds: string[] | null): Promise<{ made: number; skipped: { name: string; why: string }[] }> {
  const { data: prof } = await db.from('crm_profiles').select('email_signature').eq('id', ctx.userId).maybeSingle();
  const sig = String((prof as { email_signature?: string | null } | null)?.email_signature ?? '');
  const pick = contactIds ? new Set(contactIds) : null;
  const out = { made: 0, skipped: [] as { name: string; why: string }[] };
  for (const a of r.askers) {
    if (pick && !pick.has(a.contact_id)) continue;
    if (a.skip || !a.email) { out.skipped.push({ name: a.name, why: a.skip ?? 'no email on file' }); continue; }
    if (a.drafted) { out.skipped.push({ name: a.name, why: 'already has a draft' }); continue; }
    const { error } = await db.from('crm_email_drafts').upsert({
      user_id: ctx.userId, draft_key: `reoffer:${a.contact_id}:${r.listing.id}`, subject: `Update on ${r.listing.label}`, to_emails: a.email, more_to: '', cc_emails: '', bcc_emails: '',
      body_html: reofferBody(a.first, r, sig), context: { kind: 'dock', label: `Re-offer: ${a.name}` }, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,draft_key' });
    if (error) out.skipped.push({ name: a.name, why: 'could not save' }); else out.made++;
  }
  return out;
}
