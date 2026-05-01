import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

export async function GET() {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_campaigns')
    .select(`*, enrollment_count:crm_campaign_enrollments(count)`)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Flatten count
  const campaigns = (data ?? []).map((c: any) => ({
    ...c,
    enrollment_count: c.enrollment_count?.[0]?.count ?? 0,
  }));
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description, type, frequency, status, email_subject, email_body, sms_body, created_by } = body;

  if (!name || !type || !frequency) {
    return NextResponse.json({ error: 'name, type, frequency required' }, { status: 400 });
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
    status: status ?? 'draft',
    email_subject: email_subject ?? null,
    email_body: email_body ?? null,
    sms_body: sms_body ?? null,
    created_by: created_by ?? null,
  }]).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
