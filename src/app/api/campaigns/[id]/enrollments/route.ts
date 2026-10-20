import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, isSuperAdminRole, unauthorized, forbidden, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { chicagoLocalToUTC } from '@/lib/chicago-time';

function computeNextSend(frequency: string, sendDate?: string | null, sendTime?: string | null): string {
  if (frequency === 'one-time' && sendDate) {
    const time = sendTime || '08:00';
    // Convert Chicago local time → UTC using Intl (handles CDT/CST automatically — no library needed)
    return chicagoLocalToUTC(sendDate, time);
  }
  // A recurring campaign with a future Send Date starts then (e.g. the monthly market
  // report's first issue); without one, the first send is one period out.
  if (sendDate) {
    const first = chicagoLocalToUTC(sendDate, sendTime || '08:00');
    if (Date.parse(first) > Date.now()) return first;
  }
  const now = new Date();
  switch (frequency) {
    case 'monthly':     now.setMonth(now.getMonth() + 1); break;
    case 'quarterly':   now.setMonth(now.getMonth() + 3); break;
    case 'semi-annual': now.setMonth(now.getMonth() + 6); break;
    case 'annual':      now.setFullYear(now.getFullYear() + 1); break;
  }
  return now.toISOString();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  if (!(await assertOwnsResource('crm_campaigns', id, ctx))) return notFound('Campaign not found');
  const supabase = adminClient();
  // Paged: PostgREST stops at 1,000 rows, so a campaign with more enrollments than that showed only
  // its first 1,000 (the Enrolled tab, the preview and the pre-send checks all read this list).
  // `id` breaks created-at ties so pages can't overlap or skip.
  const rows: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('crm_campaign_enrollments')
      .select(`*, client:crm_clients(id, first_name, last_name, business_name, email, phone, cell_phone, type, unsubscribed_at)`)
      .eq('campaign_id', id)
      .order('enrolled_at', { ascending: false }).order('id')
      .range(from, from + 999);
    if (error) return dbError('api/campaigns/[id]/enrollments', error);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return NextResponse.json({ enrollments: rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  if (!(await assertOwnsResource('crm_campaigns', id, ctx))) return notFound('Campaign not found');
  const { client_ids } = await req.json();
  if (!client_ids?.length) return NextResponse.json({ error: 'client_ids required' }, { status: 400 });

  const supabase = adminClient();
  // Get campaign details including send_date and send_time for one-time campaigns
  const { data: campaign } = await supabase.from('crm_campaigns').select('frequency, status, send_date, send_time, org_id').eq('id', id).single();
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  // Adding people to a LIVE campaign schedules real sends to them — broker only. Drafts and paused campaigns take recipients freely.
  if (campaign.status === 'active' && !isSuperAdminRole(ctx.role)) return forbidden('This campaign is live — only the broker can add recipients to it.');

  const next_send_at = campaign.status === 'active'
    ? computeNextSend(campaign.frequency, campaign.send_date, campaign.send_time)
    : null;

  const rows = (client_ids as string[]).map((client_id) => ({
    campaign_id: id,
    client_id,
    enrolled_by: ctx.userId,
    next_send_at,
    active: true,
    org_id: campaign.org_id,
  }));

  const { data, error } = await supabase
    .from('crm_campaign_enrollments')
    .upsert(rows, { onConflict: 'campaign_id,client_id', ignoreDuplicates: false })
    .select();

  if (error) return dbError('api/campaigns/[id]/enrollments', error);
  return NextResponse.json({ enrolled: data?.length ?? 0 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  if (!(await assertOwnsResource('crm_campaigns', id, ctx))) return notFound('Campaign not found');
  const { client_id } = await req.json();
  const supabase = adminClient();
  const { error } = await supabase
    .from('crm_campaign_enrollments')
    .update({ active: false })
    .eq('campaign_id', id)
    .eq('client_id', client_id);
  if (error) return dbError('api/campaigns/[id]/enrollments', error);
  return NextResponse.json({ success: true });
}
