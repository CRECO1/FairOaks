import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const supabase = adminClient();
  const unit = new URL(req.url).searchParams.get('unit');

  let campaignQuery = supabase
    .from('crm_campaigns')
    .select(`*, enrollment_count:crm_campaign_enrollments(count)`)
    .order('created_at', { ascending: false })
    .limit(500);
  if (unit) campaignQuery = campaignQuery.eq('business_unit', unit);

  const [{ data, error }, { data: sends }] = await Promise.all([
    campaignQuery,
    supabase
      .from('crm_campaign_sends')
      .select('campaign_id, sent_at, opened_at, tracking_id, status, type')
      .order('sent_at', { ascending: false }),
  ]);

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  // Build per-campaign stats: last_sent_at, send_count, open_rate
  const statsMap: Record<string, { lastSent: string | null; sentCount: number; openedCount: number; trackedCount: number }> = {};
  for (const s of (sends ?? [])) {
    if (!statsMap[s.campaign_id]) statsMap[s.campaign_id] = { lastSent: null, sentCount: 0, openedCount: 0, trackedCount: 0 };
    const st = statsMap[s.campaign_id];
    if (!st.lastSent) st.lastSent = s.sent_at;
    if (s.status === 'sent' && s.type === 'email') {
      st.sentCount++;
      if (s.tracking_id) st.trackedCount++;
      if (s.opened_at) st.openedCount++;
    }
  }

  const campaigns = (data ?? []).map((c: any) => {
    const st = statsMap[c.id];
    const openRate = st && st.trackedCount > 0 ? Math.round((st.openedCount / st.trackedCount) * 100) : null;
    return {
      ...c,
      enrollment_count: c.enrollment_count?.[0]?.count ?? 0,
      last_sent_at: st?.lastSent ?? null,
      send_count: st?.sentCount ?? 0,
      open_rate: openRate,
    };
  });
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const body = await req.json();
  const { name, description, type, frequency, send_date, send_time, send_day_of_month, status, email_subject, email_body, sms_body, created_by, sender_agent_id, business_unit } = body;

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
  if (send_day_of_month != null) {
    const dom = parseInt(String(send_day_of_month), 10);
    if (isNaN(dom) || dom < 1 || dom > 31) {
      return NextResponse.json({ error: 'send_day_of_month must be between 1 and 31' }, { status: 400 });
    }
  }

  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_campaigns').insert([{
    name, description, type, frequency,
    send_date: send_date || null,
    send_time: send_time || null,
    send_day_of_month: send_day_of_month ? parseInt(send_day_of_month, 10) : null,
    status: status ?? 'draft',
    email_subject: email_subject ?? null,
    email_body: email_body ?? null,
    sms_body: sms_body ?? null,
    created_by: created_by ?? null,
    sender_agent_id: sender_agent_id || null,
    business_unit: business_unit ?? 'residential',
  }]).select().single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ campaign: data });
}
