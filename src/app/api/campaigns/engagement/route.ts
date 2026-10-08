import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { computeEngagement, fetchAll, tenantNoticeIds } from '@/lib/campaign-engagement';
import { gmailReplies } from '@/lib/campaign-replies';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The call list: everyone who engaged with a campaign (or, with no
 * campaign_id, with any campaign in the workspace over the last 90 days),
 * hottest and not-yet-contacted first. See lib/campaign-engagement.ts for what
 * counts as engagement and why opens don't.
 *
 * Email replies come from Gmail: the caller's own connected inboxes plus the
 * campaign sender's (an admin or the sender themselves only — an agent never
 * gets another agent's inbox searched for them). Only the fact and date of a
 * reply leave Gmail, never the content.
 */

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const db = adminClient();
  const campaignId = req.nextUrl.searchParams.get('campaign_id');
  const admin = isAdminRole(ctx.role);

  let q = db.from('crm_campaigns').select('id, name, email_body, business_unit, sender_agent_id, created_by').eq('type', 'email');
  if (campaignId) q = q.eq('id', campaignId);
  else {
    const unit = admin ? (req.nextUrl.searchParams.get('unit') ?? ctx.businessUnit) : ctx.businessUnit;
    if (unit) q = q.eq('business_unit', unit);
  }
  const { data: campaigns, error } = await q.limit(500);
  if (error) return dbError('api/campaigns/engagement', error);
  const visible = (campaigns ?? []).filter(c => admin || c.business_unit === ctx.businessUnit);
  if (campaignId && !visible.length) return notFound('Campaign not found');

  // Workspace-wide view: campaigns that sent in the last 90 days.
  let inScope = visible;
  if (!campaignId) {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const recent = new Set<string>();
    for (let i = 0; i < visible.length; i += 80) {
      const rows = await fetchAll<{ campaign_id: string }>((a, b) => db.from('crm_campaign_sends').select('campaign_id')
        .in('campaign_id', visible.slice(i, i + 80).map(c => c.id)).eq('status', 'sent').gte('sent_at', since).range(a, b));
      for (const r of rows) recent.add(r.campaign_id);
    }
    inScope = visible.filter(c => recent.has(c.id));
  }
  // Tenant notices (trash, noise, door locks) are never on the call list.
  const notices = await tenantNoticeIds(db, inScope.map(c => c.id));
  inScope = inScope.filter(c => !notices.has(c.id));
  if (!inScope.length) return NextResponse.json({ people: [], campaigns: [], replies_checked: [] });

  // ── Gmail replies (lib/campaign-replies.ts) ───────────────────────────────
  const { extra, emailedAt, repliesChecked } = await gmailReplies(db, ctx.userId, admin, inScope);

  const { people } = await computeEngagement(db, inScope.map(c => ({ id: c.id, email_body: c.email_body })), extra, emailedAt);

  // Contact details for the list.
  const ids = [...people.keys()];
  const contacts = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db.from('crm_clients')
      .select('id, first_name, last_name, business_name, email, phone, cell_phone, agent_id, unsubscribed_at')
      .in('id', ids.slice(i, i + 150));
    for (const c of data ?? []) contacts.set(c.id, c);
  }
  const names = new Map(inScope.map(c => [c.id, c.name as string]));
  const list = [...people.values()]
    .map(p => ({ ...p, contact: contacts.get(p.client_id) ?? null, campaigns: p.campaign_ids.map(id => ({ id, name: names.get(id) ?? 'Campaign' })) }))
    .filter(p => p.contact)
    .sort((a, b) =>
      Number(!!a.contacted_at) - Number(!!b.contacted_at)
      || Number(b.tier === 'hot') - Number(a.tier === 'hot')
      || b.last_signal_at.localeCompare(a.last_signal_at));

  return NextResponse.json({
    people: list,
    campaigns: inScope.map(c => ({ id: c.id, name: c.name })),
    replies_checked: repliesChecked,
  });
}
