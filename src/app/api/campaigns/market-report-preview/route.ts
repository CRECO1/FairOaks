/**
 * GET /api/campaigns/market-report-preview?campaign=<id>
 *
 * Shows a CRM user exactly what a market-report campaign would send right now: the
 * campaign's stored subject and body with {{market_report}} filled from a fresh MLS
 * snapshot — the same rendering the campaign cron does at send time. Read-only: it
 * sends nothing, enrolls nothing and changes nothing. Recipient merge fields use a
 * sample greeting, and the unsubscribe link is disabled.
 *
 * Only campaigns that carry the market-report tokens can be previewed here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, notFound, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { usesMarketReport, getMarketReportMerge, applyMarketReport } from '@/lib/market-report-email';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();

  const id = req.nextUrl.searchParams.get('campaign') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound('Campaign not found');

  const { data: campaign } = await adminClient()
    .from('crm_campaigns')
    .select('id, name, status, email_subject, email_body, business_unit')
    .eq('id', id)
    .maybeSingle();
  if (!campaign || !usesMarketReport(campaign.email_subject, campaign.email_body)) return notFound('Campaign not found');
  if (!isAdminRole(ctx.role) && campaign.business_unit !== ctx.businessUnit) return notFound('Campaign not found');

  const report = await getMarketReportMerge();
  if (!report) {
    return new NextResponse('The MLS feed is unavailable right now, so the report can’t be built. A send would be held until it is.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const sample = (t: string) => applyMarketReport(t, report)
    .replaceAll('{{first_name}}', 'there')
    .replaceAll('{{unsubscribe_url}}', '#unsubscribe-disabled-in-preview');
  const subject = sample(campaign.email_subject ?? '');
  const banner =
    `<div style="font-family:Arial,sans-serif;font-size:13px;background:#FFF8E1;border-bottom:2px dashed #C77700;padding:12px 16px">` +
    `<b style="color:#C77700">PREVIEW — NOT SENT.</b> ${esc(campaign.name)} (status: ${esc(campaign.status)}). ` +
    `Figures are live from the MLS as of this moment; a send fills them again at send time.<br>` +
    `<b>Subject:</b> ${esc(subject)}</div>`;
  const body = sample(campaign.email_body ?? '');
  const html = body.includes('<body') ? body.replace(/<body([^>]*)>/, `<body$1>${banner}`) : banner + body;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}
