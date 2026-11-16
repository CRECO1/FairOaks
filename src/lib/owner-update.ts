import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrmContext } from '@/lib/crm-auth';
import { buildInquiries, buildTargeted, buildFunnel } from '@/lib/listing-inquiries';

export type OwnerUpdate = { listingId: string; property: string; to: string; recipients: number; subject: string; bodyHtml: string; interest: { asked: number; askedWeek: number; followedUp: number; targeted: number; deals: number } };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The owner's weekly update for one property, as an email DRAFT body (counts only, never names): how many people asked, how many got a follow-up, how many
 * businesses we reached out to, deals. The recipient is the property's landlord / owner contact(s). Returns null when there is nothing to say. Nothing is
 * ever sent from here: callers save it to the agent's Drafts for review. `ctx` is the agent the draft belongs to (their access rules and signature apply).
 */
export async function buildOwnerUpdate(db: SupabaseClient, ctx: CrmContext, listingId: string): Promise<OwnerUpdate | null> {
  const { data: l } = await db.from('crm_listings').select('id, name, address').eq('id', listingId).maybeSingle();
  if (!l) return null;
  const property = String(l.address ?? '').split(',')[0].trim() || String(l.name ?? 'your property');
  const inq = await buildInquiries(ctx, listingId); if (!inq.ok) return null;
  const tg = await buildTargeted(ctx, listingId);
  const f = await buildFunnel(ctx, listingId, inq.items, tg.total);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const people = inq.items.filter(i => i.via !== 'deal' && i.via !== 'task');
  const interest = { asked: f.asked, askedWeek: people.filter(i => i.last_at && Date.parse(i.last_at) >= weekAgo).length, followedUp: f.followedUp, targeted: f.targeted, deals: f.deals };
  if (interest.asked + interest.targeted + interest.deals === 0) return null;

  const { data: lc } = await db.from('crm_listing_contacts').select('role, crm_clients(first_name, email)').eq('listing_id', listingId).limit(50);
  const owners = (lc ?? []).filter(r => /landlord|owner/i.test(String(r.role ?? ''))).map(r => (Array.isArray(r.crm_clients) ? r.crm_clients[0] : r.crm_clients) as { first_name?: string | null; email?: string | null } | null).filter(c => c?.email);
  const emails = [...new Set(owners.map(c => String(c!.email).trim().toLowerCase()))];
  const first = String(owners[0]?.first_name ?? '').trim();

  const li: string[] = [];
  if (interest.asked) li.push(`${interest.asked} ${interest.asked === 1 ? 'person has' : 'people have'} asked about the space${interest.askedWeek ? ` (${interest.askedWeek} in the last week)` : ''}${interest.followedUp ? `, and ${interest.followedUp} ${interest.followedUp === 1 ? 'has' : 'have'} had a follow-up from us` : ''}.`);
  if (interest.targeted) li.push(`We have reached out directly to ${interest.targeted} ${interest.targeted === 1 ? 'business' : 'businesses'} that look like a fit.`);
  if (interest.deals) li.push(`${interest.deals} ${interest.deals === 1 ? 'deal is' : 'deals are'} in progress.`);

  const { data: prof } = await db.from('crm_profiles').select('email_signature').eq('id', ctx.userId).maybeSingle();
  const sig = String((prof as { email_signature?: string | null } | null)?.email_signature ?? '');
  const bodyHtml = `<p>Hi ${esc(first || 'there')},</p><p>A quick update on ${esc(property)}:</p><ul>${li.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>I'll keep following up with each of them and send the full leasing report when you want it. Happy to talk it through any time.</p>${sig ? `<br>${sig}` : ''}`;
  return { listingId, property, to: emails.join(', '), recipients: emails.length, subject: `Weekly update: ${property}`, bodyHtml, interest };
}

/** Save an owner update as a draft for `userId` (idempotent per property per week). Returns the draft key. */
export async function saveOwnerUpdateDraft(db: SupabaseClient, userId: string, u: OwnerUpdate): Promise<string> {
  const d = new Date(); const jan1 = new Date(d.getFullYear(), 0, 1); const wk = Math.ceil((((d.getTime() - jan1.getTime()) / 86_400_000) + jan1.getDay() + 1) / 7);
  const key = `ownerupdate:${u.listingId}:${d.getFullYear()}-W${wk}`;
  const { error } = await db.from('crm_email_drafts').upsert({
    user_id: userId, draft_key: key, subject: u.subject, to_emails: u.to, more_to: '', cc_emails: '', bcc_emails: '', body_html: u.bodyHtml,
    context: { kind: 'dock', label: `Owner update: ${u.property}` }, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,draft_key' });
  if (error) throw new Error(error.message);
  return key;
}
