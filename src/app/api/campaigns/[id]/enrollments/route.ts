import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, dbError } from '@/lib/crm-auth';
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
  const { data, error } = await supabase
    .from('crm_campaign_enrollments')
    .select(`*, client:crm_clients(id, first_name, last_name, business_name, email, phone, cell_phone, type, unsubscribed_at)`)
    .eq('campaign_id', id)
    .order('enrolled_at', { ascending: false });
  if (error) return dbError('api/campaigns/[id]/enrollments', error);
  return NextResponse.json({ enrollments: data ?? [] });
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
