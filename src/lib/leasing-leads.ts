import type { SupabaseClient } from '@supabase/supabase-js';
import { computeEngagement, fetchAll } from '@/lib/campaign-engagement';
import { gmailReplies } from '@/lib/campaign-replies';
import { LEASING_STATUSES } from '@/lib/leasing-activity';

// Leads flow into a property's Leasing Activity report on their own, so the weekly
// owner report never depends on someone remembering to type a prospect in:
//   • Website inquiries — a contact whose site / landing page / page path matches the
//     listing's lead_keywords (elkhornpoint.com, 8923-dietz-elkhorn, …)
//   • Email replies + calls / texts — the Marketing call list's own detection
//     (lib/campaign-replies + lib/campaign-engagement) on the listing's campaigns
//   • Deals at the property — status follows the deal stage forward; Lost → Passed
// Each lead lands once as a prospect row (crm_property_tenants, is_backup) linked to
// its contact; after that it's the agents' row to work. Runs when the report is
// opened or downloaded, at most every 10 minutes.

type Status = typeof LEASING_STATUSES[number];
const rank = (s?: string | null) => Math.max(0, LEASING_STATUSES.indexOf((s ?? 'Prospect') as Status));
const STAGE: Record<string, Status> = { Prospect: 'Prospect', Active: 'Touring', 'In Contract': 'Lease Out', Closed: 'Signed', Won: 'Signed', Lost: 'Passed' };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'America/Chicago' });
const ymd = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

interface Lead { clientId: string; source: 'Website inquiry' | 'Email reply' | 'Call / text' | 'Deal'; at: string; label: string; dealId?: string; stage?: string }

export async function syncLeasingLeads(db: SupabaseClient, listingId: string, viewer: { userId: string; admin: boolean },
  opts: { force?: boolean; dryRun?: boolean } = {}): Promise<{ added: number; advanced: number; skipped?: boolean; planned?: string[] }> {
  const { force = false, dryRun = false } = opts;
  const planned: string[] = [];
  const { data: listing } = await db.from('crm_listings')
    .select('id, business_unit, lead_keywords, leads_synced_at').eq('id', listingId).single();
  if (!listing) return { added: 0, advanced: 0 };
  if (!force && listing.leads_synced_at && Date.now() - new Date(listing.leads_synced_at).getTime() < 10 * 60_000) return { added: 0, advanced: 0, skipped: true };
  if (!dryRun) await db.from('crm_listings').update({ leads_synced_at: new Date().toISOString() }).eq('id', listingId);

  const leads: Lead[] = [];

  // 1. Website inquiries.
  const kws = ((listing.lead_keywords as string[] | null) ?? []).filter(Boolean);
  if (kws.length) {
    const ors = kws.flatMap(k => { const v = `*${k.replace(/[,()*]/g, '')}*`; return [`lead_site.ilike.${v}`, `landing_page.ilike.${v}`, `page_path.ilike.${v}`]; }).join(',');
    const { data } = await db.from('crm_clients').select('id, created_at, lead_source').or(ors).limit(500);
    for (const c of data ?? []) leads.push({ clientId: c.id, source: 'Website inquiry', at: c.created_at, label: c.lead_source ? `website (${String(c.lead_source).slice(0, 60)})` : 'website inquiry' });
  }

  // 2. Email replies + calls / texts on the listing's campaigns.
  const { data: projects } = await db.from('crm_campaign_projects').select('id').eq('listing_id', listingId);
  const projectIds = (projects ?? []).map(p => p.id);
  if (projectIds.length) {
    const { data: camps } = await db.from('crm_campaigns').select('id, email_body, sender_agent_id').in('project_id', projectIds).eq('type', 'email');
    const inScope = camps ?? [];
    if (inScope.length) {
      const { extra, emailedAt } = await gmailReplies(db, viewer.userId, viewer.admin, inScope).catch(() => ({ extra: new Map(), emailedAt: new Map() }));
      const { people } = await computeEngagement(db, inScope.map(c => ({ id: c.id, email_body: c.email_body })), extra, emailedAt);
      for (const p of people.values()) {
        for (const s of p.signals) {
          if (s.kind === 'reply') leads.push({ clientId: p.client_id, source: 'Email reply', at: s.at, label: 'replied to an email' });
          if (s.kind === 'call') leads.push({ clientId: p.client_id, source: 'Call / text', at: s.at, label: 'called / texted the office' });
        }
      }
    }
  }

  // 3. Deals at the property.
  const { data: deals } = await db.from('crm_deals').select('id, client_id, stage, created_at, last_touch').eq('listing_id', listingId);
  for (const d of deals ?? []) if (d.client_id) leads.push({ clientId: d.client_id, source: 'Deal', at: d.last_touch ?? d.created_at, label: `deal (${d.stage})`, dealId: d.id, stage: d.stage });

  if (!leads.length) return { added: 0, advanced: 0, planned };

  // Existing prospect rows — a contact lands on the report once.
  const existing = await fetchAll<{ id: string; contact_id: string | null; lead_ref: string | null; leasing_status: string | null }>((a, b) =>
    db.from('crm_property_tenants').select('id, contact_id, lead_ref, leasing_status').eq('listing_id', listingId).eq('is_backup', true).range(a, b));
  const byContact = new Map(existing.filter(r => r.contact_id).map(r => [r.contact_id!, r]));

  // Earliest signal per contact decides the source; a deal always wins (it carries a stage).
  const best = new Map<string, Lead>();
  for (const l of leads.sort((a, b) => a.at.localeCompare(b.at))) {
    const cur = best.get(l.clientId);
    if (!cur || (l.source === 'Deal' && cur.source !== 'Deal')) best.set(l.clientId, l);
  }

  const ids = [...best.keys()];
  const contacts = new Map<string, { business_name: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; cell_phone: string | null; tags: string[] | null }>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db.from('crm_clients').select('id, business_name, first_name, last_name, email, phone, cell_phone, tags').in('id', ids.slice(i, i + 150));
    for (const c of data ?? []) contacts.set(c.id, c);
  }
  const { data: lists } = await db.from('crm_smart_lists').select('filters');
  const categoryTags = new Set((lists ?? []).map(r => (r.filters as { tag?: string } | null)?.tag).filter((t): t is string => !!t && !/^elkhorn point/i.test(t)));

  let added = 0, advanced = 0;
  for (const [clientId, l] of best) {
    const c = contacts.get(clientId);
    const row = byContact.get(clientId);
    const dealStatus = l.stage ? STAGE[l.stage] : undefined;
    if (row) {
      // Deals move a prospect forward (never backward); a lost deal marks it Passed.
      if (dealStatus && (dealStatus === 'Passed' ? row.leasing_status !== 'Passed' : rank(dealStatus) > rank(row.leasing_status))) {
        planned.push(`advance ${row.id} → ${dealStatus}`);
        if (!dryRun) await db.from('crm_property_tenants').update({ leasing_status: dealStatus, lead_ref: `deal:${l.dealId}`, activity_date: ymd(l.at), updated_at: new Date().toISOString() }).eq('id', row.id);
        advanced++;
      }
      continue;
    }
    const name = `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim();
    planned.push(`add ${c?.business_name || name || c?.email} — ${l.source} ${day(l.at)} (${l.label})`);
    if (!dryRun) await db.from('crm_property_tenants').insert({
      listing_id: listingId, business_unit: listing.business_unit ?? 'commercial', is_backup: true,
      contact_id: clientId, tenant_name: c?.business_name || name || c?.email || 'New lead', contact_name: name || null,
      email: c?.email ?? null, phone: c?.phone || c?.cell_phone || null,
      tenant_use: (c?.tags ?? []).filter(t => categoryTags.has(t)).join(', ') || null,
      leasing_status: dealStatus ?? 'Prospect', activity_date: ymd(l.at),
      lead_source: l.source, lead_ref: l.dealId ? `deal:${l.dealId}` : `contact:${clientId}`,
      notes: `New lead ${day(l.at)} — ${l.label}`,
    });
    added++;
  }
  return { added, advanced, planned };
}
