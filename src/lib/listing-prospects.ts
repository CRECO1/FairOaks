import type { SupabaseClient } from '@supabase/supabase-js';

// Email Prospects for a property: everyone the property's campaigns have emailed
// (campaign projects carry listing_id), with opens / clicks per person and an open
// rate per campaign. Read-only and live — it's built from crm_campaign_sends and the
// Resend webhook's email_tracking_events, so it keeps itself current as campaigns send.

// PostgREST caps a response at 1000 rows; page through anything that can grow.
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await q(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
const chunks = <T,>(a: T[], n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

type Send = { campaign_id: string; client_id: string; status: string; sent_at: string | null; opened_at: string | null; open_count: number | null };
type Client = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; phone: string | null; cell_phone: string | null; tags: string[] | null; unsubscribed_at: string | null; notes: string | null };

// Who to ask for on a call. Researched contacts carry a first notes line like
// "📞 ASK FOR: Robert Godines — Owner & Founder · 13 locations (…) · …"; surface the
// name/position and the location count, and leave the rest on the contact card.
function askFor(notes: string | null): { askFor: string; locations: string } {
  const first = (notes ?? '').split('\n')[0];
  if (!first.startsWith('📞 ASK FOR:')) return { askFor: '', locations: '' };
  const parts = first.slice('📞 ASK FOR:'.length).split(' · ').map(s => s.trim());
  const loc = parts.find(s => /^\d+ locations?\b/.test(s)) ?? '';
  return { askFor: parts[0].replace(/\s*\[Verified[^\]]*\]\s*$/, ''), locations: loc.match(/^\d+ locations/)?.[0] ?? '' };
}

async function categoryTags(db: SupabaseClient): Promise<Set<string>> {
  // The tenant-category smart lists ("Elkhorn — Medical", …) define the categories.
  const { data } = await db.from('crm_smart_lists').select('filters');
  return new Set((data ?? []).map(r => (r.filters as { tag?: string } | null)?.tag).filter((t): t is string => !!t));
}

/**
 * The campaigns that market a property: those naming it directly (crm_campaigns.listing_id),
 * plus campaigns with no listing of their own whose project names it. A campaign
 * pointed at another property never shows here just because of its project.
 */
export async function campaignsForListing(db: SupabaseClient, listingId: string) {
  const { data: projects } = await db.from('crm_campaign_projects').select('id').eq('listing_id', listingId);
  const projectIds = (projects ?? []).map(p => p.id);
  const [{ data: direct }, { data: viaProject }] = await Promise.all([
    db.from('crm_campaigns').select('id, name, status, created_at').eq('listing_id', listingId),
    projectIds.length
      ? db.from('crm_campaigns').select('id, name, status, created_at').in('project_id', projectIds).is('listing_id', null)
      : Promise.resolve({ data: [] as { id: string; name: string; status: string; created_at: string }[] }),
  ]);
  return [...(direct ?? []), ...(viaProject ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function listingProspects(db: SupabaseClient, listingId: string) {
  const campaigns = await campaignsForListing(db, listingId);
  const campIds = campaigns.map(c => c.id);
  if (!campIds.length) return { campaigns: [], prospects: [] };

  const sends = await all<Send>((a, b) => db.from('crm_campaign_sends')
    .select('campaign_id, client_id, status, sent_at, opened_at, open_count')
    .in('campaign_id', campIds).eq('type', 'email').range(a, b));
  const clicks = await all<{ campaign_id: string; client_id: string; occurred_at: string }>((a, b) => db.from('email_tracking_events')
    .select('campaign_id, client_id, occurred_at').in('campaign_id', campIds).eq('event_type', 'click').range(a, b));

  const clientIds = [...new Set(sends.map(s => s.client_id).filter(Boolean))];
  const clients = new Map<string, Client>();
  for (const ids of chunks(clientIds)) {
    const { data } = await db.from('crm_clients')
      .select('id, first_name, last_name, business_name, email, phone, cell_phone, tags, unsubscribed_at, notes').in('id', ids);
    for (const c of (data ?? []) as Client[]) clients.set(c.id, c);
  }
  const cats = await categoryTags(db);

  // Per campaign.
  const byCamp = campaigns.map(c => {
    const s = sends.filter(x => x.campaign_id === c.id && x.status === 'sent');
    const opened = s.filter(x => x.opened_at).length;
    const clickers = new Set(clicks.filter(k => k.campaign_id === c.id).map(k => k.client_id)).size;
    const last = s.reduce<string | null>((m, x) => (x.sent_at && (!m || x.sent_at > m) ? x.sent_at : m), null);
    return { id: c.id, name: c.name, status: c.status, sent: s.length, opened, clickers, openRate: s.length ? opened / s.length : 0, lastSent: last };
  }).filter(c => c.sent > 0 || c.status === 'active');

  // Per person.
  const people = new Map<string, { sends: number; opens: number; openedEmails: number; firstOpen: string | null; lastOpen: string | null; lastSent: string | null; clicks: number; lastClick: string | null; campaigns: Set<string> }>();
  for (const s of sends) {
    if (s.status !== 'sent' || !s.client_id) continue;
    const p = people.get(s.client_id) ?? { sends: 0, opens: 0, openedEmails: 0, firstOpen: null, lastOpen: null, lastSent: null, clicks: 0, lastClick: null, campaigns: new Set<string>() };
    p.sends++; p.campaigns.add(s.campaign_id);
    if (s.sent_at && (!p.lastSent || s.sent_at > p.lastSent)) p.lastSent = s.sent_at;
    if (s.opened_at) {
      p.openedEmails++; p.opens += Math.max(1, s.open_count ?? 1);
      if (!p.firstOpen || s.opened_at < p.firstOpen) p.firstOpen = s.opened_at;
      if (!p.lastOpen || s.opened_at > p.lastOpen) p.lastOpen = s.opened_at;
    }
    people.set(s.client_id, p);
  }
  for (const k of clicks) {
    const p = people.get(k.client_id); if (!p) continue;
    p.clicks++; if (!p.lastClick || k.occurred_at > p.lastClick) p.lastClick = k.occurred_at;
  }

  // Umbrella tags (the property's own "Elkhorn Point" lists) sit on most of the list,
  // so they say nothing about the business — keep only tags that actually segment it.
  const tagCount = new Map<string, number>();
  for (const id of people.keys()) for (const t of clients.get(id)?.tags ?? []) if (cats.has(t)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const { data: listing } = await db.from('crm_listings').select('name, business_unit').eq('id', listingId).maybeSingle();
  const own = String(listing?.name ?? '').toLowerCase().split(/\s+[—–-]\s+/)[0].trim();   // "Elkhorn Point"
  const umbrella = new Set([...tagCount].filter(([t, n]) => n > people.size * 0.4 || (own && t.toLowerCase().startsWith(own))).map(([t]) => t));

  const emailedRows = [...people.entries()].map(([id, p]) => {
    const c = clients.get(id);
    const tags = c?.tags ?? [];
    return {
      client_id: id,
      name: `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim(),
      business: c?.business_name ?? '',
      email: c?.email ?? '',
      phone: c?.phone || c?.cell_phone || '',
      category: tags.filter(t => cats.has(t) && !umbrella.has(t)).join(', '),
      ...askFor(c?.notes ?? null),
      emailsSent: p.sends, emailsOpened: p.openedEmails, opens: p.opens,
      firstOpen: p.firstOpen, lastOpen: p.lastOpen, lastSent: p.lastSent,
      clicks: p.clicks, lastClick: p.lastClick,
      unsubscribed: !!c?.unsubscribed_at, dead: tags.includes('Dead Email'),
      notEmailed: false,
    };
  }).sort((a, b) => (b.lastOpen ?? '').localeCompare(a.lastOpen ?? '') || b.opens - a.opens);

  // "Not emailed yet": contacts built for THIS property (their lead source names it — "Elkhorn Back Pad Prospect List",
  // "Elkhorn Point Expansion Prospect List", …) that no campaign has emailed. They never appear above because that list is
  // built from sends, but they're exactly who to call cold. Skipped for properties whose name has no usable first word
  // (e.g. "523 Seventh St") so we never match on something generic.
  const word = own.split(/\s+/)[0] ?? '';
  const cold: typeof emailedRows = [];
  if (/^[a-z]{5,}$/.test(word)) {
    const extra = await all<Client>((a, b) => db.from('crm_clients')
      .select('id, first_name, last_name, business_name, email, phone, cell_phone, tags, unsubscribed_at, notes')
      .eq('business_unit', listing?.business_unit ?? 'commercial').ilike('lead_source', `%${word}%`).order('id').range(a, b));
    for (const c of extra) {
      if (people.has(c.id)) continue;
      const tags = c.tags ?? [];
      cold.push({
        client_id: c.id,
        name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(),
        business: c.business_name ?? '',
        email: c.email ?? '',
        phone: c.phone || c.cell_phone || '',
        category: tags.filter(t => cats.has(t) && !umbrella.has(t)).join(', '),
        ...askFor(c.notes ?? null),
        emailsSent: 0, emailsOpened: 0, opens: 0, firstOpen: null, lastOpen: null, lastSent: null, clicks: 0, lastClick: null,
        unsubscribed: !!c.unsubscribed_at, dead: tags.includes('Dead Email'),
        notEmailed: true,
      });
    }
    // Callable first (phone on file), then by business name.
    cold.sort((a, b) => Number(!!b.phone) - Number(!!a.phone) || (a.business || a.name).localeCompare(b.business || b.name));
  }

  return { campaigns: byCamp, prospects: [...emailedRows, ...cold] };
}
