/**
 * GET /api/cron/market-report — daily. Moved here from crecotx.com (2026-11-18) so the public site holds no CRM database key.
 *
 * Fully-automated quarterly market-report send. Does nothing unless the commercial CRM campaign named "Quarterly Market Report"
 * is armed. Content + schedule live on that ONE campaign: edit its subject/body in the campaign editor, then set its Send Date.
 * On/after that date this emails the CURRENT "Market Report"-tagged commercial contacts (new signups are included automatically),
 * then CLEARS the send date so it never repeats. Idempotent: the date is cleared with a conditional update BEFORE sending.
 * `?dry=1` reports the recipient count without claiming or sending. Auth: CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { safeEqual } from '@/lib/secret-compare';
import { adminClient } from '@/lib/supabase-admin';
import { unsubscribeUrlFor } from '@/lib/email-tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CAMPAIGN_NAME = 'Quarterly Market Report';

interface Recipient { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string; unsubscribe_token: string | null }

function applyMerge(template: string, c: Recipient): string {
  // Commercial contacts are often companies with no person name — fall back to the business, then a plain greeting.
  const greeting = (c.first_name || '').trim() || (c.business_name || '').trim() || 'there';
  return template
    .replaceAll('{{first_name}}', greeting)
    .replaceAll('{{last_name}}', c.last_name || '')
    .replaceAll('{{full_name}}', `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || (c.business_name || 'there'))
    .replaceAll('{{email}}', c.email || '')
    .replaceAll('{{client_type}}', 'Broker')
    .replaceAll('{{brokerage}}', 'CRECO')
    .replaceAll('{{agent_name}}', 'Zachary Stovall')
    .replaceAll('{{agent_email}}', 'info@crecotx.com')
    .replaceAll('{{agent_phone}}', '210-817-3443')
    .replaceAll('{{unsubscribe_url}}', unsubscribeUrlFor('commercial', c.unsubscribe_token ?? ''));
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !safeEqual(req.headers.get('authorization'), `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const supabase = adminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: camps, error: campErr } = await supabase.from('crm_campaigns')
    .select('id, email_subject, email_body, send_date').eq('business_unit', 'commercial').eq('name', CAMPAIGN_NAME).limit(1);
  if (campErr) return NextResponse.json({ ok: false, error: 'campaign lookup failed' }, { status: 500 });
  const campaign = camps?.[0];
  if (!campaign) return NextResponse.json({ ok: true, armed: false, reason: 'no "Quarterly Market Report" campaign found' });
  if (!campaign.send_date || campaign.send_date > today) return NextResponse.json({ ok: true, armed: false, send_date: campaign.send_date, today });

  const { data: recips } = await supabase.from('crm_clients')
    .select('id, first_name, last_name, business_name, email, unsubscribe_token')
    .eq('business_unit', 'commercial').contains('tags', ['Market Report']).is('unsubscribed_at', null).not('email', 'is', null);
  const list = (recips ?? []).filter((c): c is Recipient => !!c.email && c.email.includes('@'));
  if (dry) return NextResponse.json({ ok: true, dry: true, armed: true, would_send: list.length, send_date: campaign.send_date, subject: campaign.email_subject });

  // Claim the send by clearing the date — only if still armed for THIS date, so a concurrent/re-run no-ops.
  const { data: claimed } = await supabase.from('crm_campaigns').update({ send_date: null }).eq('id', campaign.id).eq('send_date', campaign.send_date).select('id');
  if (!claimed?.length) return NextResponse.json({ ok: true, armed: false, reason: 'already sent / claimed by a concurrent run' });

  const resend = new Resend((process.env.RESEND_API_KEY_COMMERCIAL ?? '').replace(/[\r\n\s]+$/, ''));
  let sent = 0;
  const errors: { email: string; error: string }[] = [];
  for (const c of list) {
    try {
      const html = applyMerge(campaign.email_body || '', c);
      const subject = applyMerge(campaign.email_subject || 'CRECO — Texas Commercial Market Report', c);
      const result = await resend.emails.send({ from: 'CRECO <noreply@crecotx.com>', to: c.email, subject, html, replyTo: 'zack@crecotx.com' });
      sent++;
      // Best-effort send log. crm_campaign_sends.enrollment_id is NOT NULL, so a passive enrollment is created per recipient.
      try {
        const { data: ex } = await supabase.from('crm_campaign_enrollments').select('id').eq('campaign_id', campaign.id).eq('client_id', c.id).limit(1);
        const enrollmentId = ex?.[0]?.id ?? (await supabase.from('crm_campaign_enrollments').insert([{ campaign_id: campaign.id, client_id: c.id, active: false }]).select('id')).data?.[0]?.id;
        if (enrollmentId) {
          await supabase.from('crm_campaign_sends').insert([{ campaign_id: campaign.id, client_id: c.id, enrollment_id: enrollmentId, type: 'email', status: 'sent', subject, provider_id: result.data?.id ?? null }]);
        }
      } catch { /* logging never blocks the send */ }
    } catch (e) {
      errors.push({ email: c.email, error: (e as Error).message?.slice(0, 140) ?? 'send failed' });
    }
  }
  return NextResponse.json({ ok: true, sent, total: list.length, errors, sent_for_date: campaign.send_date });
}
