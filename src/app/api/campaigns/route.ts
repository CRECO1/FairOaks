import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

export async function GET(req: NextRequest) {
  const supabase = adminClient();
  const unit = new URL(req.url).searchParams.get('unit');

  let campaignQuery = supabase
    .from('crm_campaigns')
    .select(`*, enrollment_count:crm_campaign_enrollments(count)`)
    .order('created_at', { ascending: false });
  if (unit) campaignQuery = campaignQuery.eq('business_unit', unit);

  const [{ data, error }, { data: sends }] = await Promise.all([
    campaignQuery,
    supabase
      .from('crm_campaign_sends')
      .select('campaign_id, sent_at')
      .eq('status', 'sent')
      .order('sent_at', { ascending: false }),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Build a map of campaign_id → latest sent_at
  const lastSentMap: Record<string, string> = {};
  for (const s of (sends ?? [])) {
    if (!lastSentMap[s.campaign_id]) {
      lastSentMap[s.campaign_id] = s.sent_at;
    }
  }

  const campaigns = (data ?? []).map((c: any) => ({
    ...c,
    enrollment_count: c.enrollment_count?.[0]?.count ?? 0,
    last_sent_at: lastSentMap[c.id] ?? null,
  }));
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description, type, frequency, send_date, send_time, status, email_subject, email_body, sms_body, created_by, sender_agent_id, business_unit } = body;

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

  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_campaigns').insert([{
    name, description, type, frequency,
    send_date: send_date || null,
    send_time: send_time || null,
    status: status ?? 'draft',
    email_subject: email_subject ?? null,
    email_body: email_body ?? null,
    sms_body: sms_body ?? null,
    created_by: created_by ?? null,
    sender_agent_id: sender_agent_id || null,
    business_unit: business_unit ?? 'residential',
  }]).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
