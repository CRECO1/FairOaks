import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';

const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@fairoaksrealtygroup.com';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const { agent_name, agent_email, count, business_unit, selected } = await req.json();

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ success: true, message: 'No Resend key configured' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const crm = business_unit === 'commercial' ? 'Commercial CRM' : 'Residential CRM';
  const scope = selected ? `${count} selected contacts` : `all ${count} contacts`;
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });

  await resend.emails.send({
    from: 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>',
    to: NOTIFICATION_EMAIL,
    subject: `⚠️ Contact List Exported — ${esc(agent_name)} (${crm})`,
    html: `
      <div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#1a1a2e">Contact List Export Alert</h2>
        <p style="color:#666;margin-bottom:16px">An agent exported a contact list from the CRM.</p>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee;width:140px">Agent</td><td style="padding:8px 12px;border:1px solid #eee">${esc(agent_name)}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Email</td><td style="padding:8px 12px;border:1px solid #eee"><a href="mailto:${esc(agent_email)}">${esc(agent_email)}</a></td></tr>
          <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">CRM</td><td style="padding:8px 12px;border:1px solid #eee">${esc(crm)}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Exported</td><td style="padding:8px 12px;border:1px solid #eee">${esc(scope)}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:bold;background:#f9f9f9;border:1px solid #eee">Time</td><td style="padding:8px 12px;border:1px solid #eee">${esc(now)} CT</td></tr>
        </table>
        <p style="margin-top:16px"><a href="https://www.fairoaksrealtygroup.com/crm" style="background:#c9922c;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">View CRM →</a></p>
      </div>
    `,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
