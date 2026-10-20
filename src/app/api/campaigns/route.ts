import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, isSuperAdminRole, unauthorized, forbidden, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { buildCampaignList } from '@/lib/campaign-list';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  // The list, its send stats and engagement counts live in lib/campaign-list.ts so the
  // reply-scan cron can warm exactly what this builds.
  const out = await buildCampaignList(ctx, new URL(req.url).searchParams.get('unit'));
  if (!out.ok) return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  return NextResponse.json({ campaigns: out.campaigns, engagement_totals: out.engagement_totals });
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

  // Sending email campaigns is the broker's call alone: anyone can build and save one, only the broker can make it live.
  if (status === 'active' && !isSuperAdminRole(ctx.role)) return forbidden('Only the broker can activate (send) a campaign. Save it as a draft — the broker activates it.');

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
