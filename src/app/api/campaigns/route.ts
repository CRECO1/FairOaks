import { NextRequest, NextResponse, after } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { computeEngagement, fetchAll, tenantNoticeIds, type CampaignFunnel } from '@/lib/campaign-engagement';

type Engagement = Awaited<ReturnType<typeof computeEngagement>>;
// Fresh for 45s. Past that it is still served instantly for up to 10 minutes while a
// fresh one is computed in the background, so opening the CRM after a few minutes away
// no longer waits on the 2s+ engagement pass. The cache key carries each campaign's send
// count, so a new send is a different key and is never served stale.
const ENGAGEMENT_TTL_MS = 45_000;
const ENGAGEMENT_STALE_MS = 10 * 60_000;
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

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const supabase = adminClient();

  let campaignQuery = supabase
    .from('crm_campaigns')
    .select(`*, enrollment_count:crm_campaign_enrollments(count)`)
    .order('created_at', { ascending: false })
    .limit(500);
  if (isAdminRole(ctx.role)) {
    const unit = new URL(req.url).searchParams.get('unit');
    if (unit) campaignQuery = campaignQuery.eq('business_unit', unit);
  } else {
    campaignQuery = campaignQuery.eq('business_unit', ctx.businessUnit);
  }

  const { data, error } = await campaignQuery;
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
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
    const eng = await cachedEngagement(key, () => computeEngagement(supabase, engIn));
    funnels = eng.funnels;
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const recent = new Set(sentCampaigns.filter(c => (statsMap[c.id]?.lastSent ?? '') >= since).map(c => c.id as string));
    for (const p of eng.people.values()) {
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
  return NextResponse.json({ campaigns, engagement_totals: totals });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const { name, description, type, frequency, send_date, send_time, send_day_of_month, status, email_subject, email_body, sms_body, sender_agent_id, business_unit, listing_id, hold_risky_addresses } = body;

  if (!name || !type || !frequency) {
    return NextResponse.json({ error: 'name, type, and frequency are required' }, { status: 400 });
  }
  if (frequency === 'one-time' && !send_date) {
    return NextResponse.json({ error: 'Send date is required for one-time campaigns' }, { status: 400 });
  }
  if (type === 'email' && (!email_subject || !email_body)) {
    return NextResponse.json({ error: 'email_subject and email_body required for email campaigns' }, { status: 400 });
  }
  if (type === 'sms' && !sms_body) {
    return NextResponse.json({ error: 'sms_body required for sms campaigns' }, { status: 400 });
  }
  if (email_body && email_body.length > 100000) {
    return NextResponse.json({ error: 'Email body must be under 100,000 characters' }, { status: 400 });
  }
  if (email_subject && email_subject.length > 500) {
    return NextResponse.json({ error: 'Subject must be under 500 characters' }, { status: 400 });
  }
  // The builder keeps "no day set" as '' in its form state and posts it as-is.
  // This read `!= null`, and '' != null is TRUE, so an empty box went on to
  // parseInt('') → NaN → a 400 telling the agent the day had to be between 1 and
  // 31 when they had not set one at all. Every campaign saved without a
  // day-of-month failed to create. The PATCH route already excluded '' — the two
  // routes had drifted apart.
  if (send_day_of_month !== null && send_day_of_month !== undefined && send_day_of_month !== '') {
    const dom = parseInt(String(send_day_of_month), 10);
    if (isNaN(dom) || dom < 1 || dom > 31) {
      return NextResponse.json({ error: 'Day of month must be between 1 and 31.' }, { status: 400 });
    }
  }

  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_campaigns').insert([{
    name, description, type, frequency,
    send_date: send_date || null,
    send_time: send_time || null,
    send_day_of_month: send_day_of_month !== null && send_day_of_month !== undefined && send_day_of_month !== '' ? parseInt(String(send_day_of_month), 10) : null,
    status: status ?? 'draft',
    email_subject: email_subject ?? null,
    email_body: email_body ?? null,
    sms_body: sms_body ?? null,
    created_by: ctx.userId,
    sender_agent_id: sender_agent_id || null,
    hold_risky_addresses: hold_risky_addresses === true,
    // The property this campaign markets — feeds that listing's Prospects tab.
    listing_id: listing_id || null,
    business_unit: isAdminRole(ctx.role) ? (business_unit ?? ctx.businessUnit ?? 'residential') : (ctx.businessUnit ?? 'residential'),
  }]).select().single();

  if (error) return dbError('api/campaigns POST', error);
  return NextResponse.json({ campaign: data });
}
