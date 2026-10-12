import { adminClient } from '@/lib/supabase-admin';
import { isAdminRole } from '@/lib/crm-auth';
import { computeEngagement, fetchAll, tenantNoticeIds, type CampaignFunnel } from '@/lib/campaign-engagement';
import { cachedCompute, hashKey } from '@/lib/engagement-cache';
import { after } from 'next/server';

// What this list needs from an engagement pass: per-campaign funnels, and for each engaged
// person which campaigns and whether anyone has contacted them yet (for the totals).
type Engagement = {
  funnels: [string, CampaignFunnel][];
  people: [string, { campaign_ids: string[]; contacted_at: string | null }][];
};
// Fresh for 45s. Past that it is still served instantly for up to 3 minutes while a fresh
// one is fetched in the background. Behind this per-instance cache is the persistent one
// (lib/engagement-cache.ts), so a cold instance also answers from a stored row instead of
// recomputing the 1s+ engagement pass. The cache key carries each campaign's send count,
// so a new send is a different key and is never served stale.
const ENGAGEMENT_TTL_MS = 45_000;
const ENGAGEMENT_STALE_MS = 3 * 60_000;
const engagementCache = new Map<string, { at: number; value: Promise<Engagement>; refreshing?: boolean }>();
function cachedEngagement(key: string, compute: () => Promise<Engagement>): Promise<Engagement> {
  const hit = engagementCache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < ENGAGEMENT_TTL_MS) return hit.value;
  if (hit && age < ENGAGEMENT_STALE_MS) {
    if (!hit.refreshing) {
      hit.refreshing = true;
      after(async () => {
        try {
          const fresh = await compute();
          engagementCache.set(key, { at: Date.now(), value: Promise.resolve(fresh) });
        } catch {
          hit.refreshing = false; // keep serving the stale value; retry on a later load
        }
      });
    }
    return hit.value;
  }
  const value = compute();
  engagementCache.set(key, { at: Date.now(), value });
  // A failed computation must not be served again — drop it so the next load retries.
  value.catch(() => { if (engagementCache.get(key)?.value === value) engagementCache.delete(key); });
  if (engagementCache.size > 12) { const oldest = [...engagementCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) engagementCache.delete(oldest[0]); }
  return value;
}

export async function buildCampaignList(
  ctx: { userId: string; role: string | null; businessUnit: string | null },
  unitParam: string | null,
  /** The warm-up cron: recompute and store, ignoring any cached copy. */
  opts: { force?: boolean } = {},
): Promise<{ ok: true; campaigns: unknown[]; engagement_totals: { engaged: number; to_call: number } } | { ok: false }> {
  const supabase = adminClient();

  let campaignQuery = supabase
    .from('crm_campaigns')
    .select(`*, enrollment_count:crm_campaign_enrollments(count)`)
    .order('created_at', { ascending: false })
    .limit(500);
  if (isAdminRole(ctx.role)) {
    if (unitParam) campaignQuery = campaignQuery.eq('business_unit', unitParam);
  } else {
    campaignQuery = campaignQuery.eq('business_unit', ctx.businessUnit);
  }

  const { data, error } = await campaignQuery;
  if (error) { console.error("[api] db error:", error); return { ok: false }; }
  const rows = (data ?? []) as any[];
  const ids = rows.map(c => c.id as string);

  // Paged: PostgREST stops at 1000 rows, and this table passed that in Oct 2026 —
  // every stat on this page was quietly computed from a truncated list.
  const sends: { campaign_id: string; sent_at: string; opened_at: string | null; tracking_id: string | null; status: string; type: string }[] = [];
  // The send stats and the tenant-notice check are independent reads — run them together
  // (they used to run back to back, ~0.9s of the response).
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += 80) parts.push(ids.slice(i, i + 80));
  const [sendParts, noticeSet] = await Promise.all([
    Promise.all(parts.map(part => fetchAll<typeof sends[number]>((a, b) => supabase
      .from('crm_campaign_sends')
      .select('campaign_id, sent_at, opened_at, tracking_id, status, type')
      .in('campaign_id', part)
      .order('sent_at', { ascending: false })
      .range(a, b)))),
    tenantNoticeIds(supabase, ids).catch(() => null),
  ]);
  for (const part of sendParts) sends.push(...part);

  // Build per-campaign stats: last_sent_at, send_count, open_rate
  const statsMap: Record<string, { lastSent: string | null; sentCount: number; openedCount: number; trackedCount: number }> = {};
  for (const s of sends) {
    if (!statsMap[s.campaign_id]) statsMap[s.campaign_id] = { lastSent: null, sentCount: 0, openedCount: 0, trackedCount: 0 };
    const st = statsMap[s.campaign_id];
    if (!st.lastSent) st.lastSent = s.sent_at;
    if (s.status === 'sent' && s.type === 'email') {
      st.sentCount++;
      if (s.tracking_id) st.trackedCount++;
      if (s.opened_at) st.openedCount++;
    }
  }

  // Engaged people per campaign (human clicks, owner-report views, calls in) and
  // how many of them nobody has contacted yet — lib/campaign-engagement.ts. Only
  // campaigns that have sent are worth the queries.
  const sentCampaigns = rows.filter(c => statsMap[c.id]?.sentCount);
  let funnels = new Map<string, CampaignFunnel>();
  let notices = new Set<string>();
  // Unique people (a person engaged by two campaigns is one call), over the same
  // 90-day window as the workspace call list, so the card and the list agree.
  const totals = { engaged: 0, to_call: 0 };
  try {
    // Notices to our own tenants aren't prospecting — no call list for them.
    notices = noticeSet ?? await tenantNoticeIds(supabase, sentCampaigns.map(c => c.id));
    const engIn = sentCampaigns.filter(c => !notices.has(c.id)).map(c => ({ id: c.id, email_body: c.email_body }));
    // Engagement math is the slow part (2s+). It only changes when a send, click or call lands,
    // so reuse a result up to 45s old — and share one in-flight computation between the
    // simultaneous loads a tab refresh or a second open tab can produce.
    const key = engIn.map(c => `${c.id}:${statsMap[c.id]?.sentCount ?? 0}`).sort().join(',');
    const load = async () => (await cachedCompute<Engagement>(supabase, `list|${hashKey(key)}`, async () => {
      const e = await computeEngagement(supabase, engIn);
      return {
        funnels: [...e.funnels],
        people: [...e.people].map(([id, p]) => [id, { campaign_ids: p.campaign_ids, contacted_at: p.contacted_at }] as [string, { campaign_ids: string[]; contacted_at: string | null }]),
      };
    }, { freshMs: 3 * 60_000, staleMs: 15 * 60_000, force: opts.force })).value;
    const eng = opts.force ? await load() : await cachedEngagement(key, load);
    funnels = new Map(eng.funnels);
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const recent = new Set(sentCampaigns.filter(c => (statsMap[c.id]?.lastSent ?? '') >= since).map(c => c.id as string));
    for (const [, p] of eng.people) {
      if (!p.campaign_ids.some(id => recent.has(id))) continue;
      totals.engaged++;
      if (!p.contacted_at) totals.to_call++;
    }
  } catch (e) {
    // The list must still load if the engagement read fails.
    console.error('[api/campaigns] engagement failed', e);
  }

  // The list never ships email HTML (it was 540KB of a 606KB response and no list view
  // renders it). The CRM fetches a body by id when a campaign is opened, previewed or
  // edited; `has_body` / `uses_market_report` are what the list itself needs.
  const campaigns = rows.map(({ email_body, ...c }: any) => {
    const st = statsMap[c.id];
    const f = funnels.get(c.id);
    const openRate = st && st.trackedCount > 0 ? Math.round((st.openedCount / st.trackedCount) * 100) : null;
    return {
      ...c,
      has_body: !!email_body,
      uses_market_report: /\{\{(market_report|report_month|report_headline)\}\}/.test(`${c.email_subject ?? ''}${email_body ?? ''}`),
      enrollment_count: c.enrollment_count?.[0]?.count ?? 0,
      last_sent_at: st?.lastSent ?? null,
      send_count: st?.sentCount ?? 0,
      open_rate: openRate,
      // Human clickers only — mail-scanner link checks are filtered out.
      click_count: f?.clickers ?? 0,
      click_rate: f?.click_rate ?? null,
      engaged_count: f?.engaged ?? 0,
      responded_count: f?.responded ?? 0,
      to_call_count: f?.to_call ?? 0,
      scanner_clickers: f?.scanner_clickers ?? 0,
      is_tenant_notice: notices.has(c.id),
    };
  });
  return { ok: true, campaigns, engagement_totals: totals };
}

