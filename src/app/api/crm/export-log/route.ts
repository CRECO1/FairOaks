import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { recordIntegrationFailure, recordIntegrationSuccess } from '@/lib/integration-alert';
import { getCrmContext, isSuperAdminRole, unauthorized, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';

/** Exports get their own watchdog key — conflating them with lead alerts made a
 *  failed security notice look like a failed lead notice. */
const EXPORT_ALERT_KEY = 'export_alerts';

const NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@crecotx.com';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Records a contact export taken from the browser.
 *
 * The two server export routes (contacts/export, commissions/export) already
 * write their own audit row with a count they compute themselves, so they need
 * nothing from here. This covers the one path they cannot see: the CRM builds
 * that CSV in the browser from contacts it has already loaded, so no request
 * reaches the server as the file is written.
 *
 * What changed, and what is still true:
 *  - getCrmUser() was called WITHOUT `req`, so it only ever tried the cookie
 *    session and skipped the bearer token the CRM actually sends. Every call
 *    would have 401'd. Nothing called this route, so nothing noticed.
 *  - The count is no longer taken from the client. The caller sends the scope
 *    (ids, or the whole unit) and the server counts the rows itself.
 *  - It writes an audit_logs row, not just an email. The email can fail; the
 *    row is what makes the export reviewable afterwards.
 *
 * Honest limit: this is still initiated by the browser, so it is a record of an
 * export rather than a gate on one. That is acceptable here because exporting
 * is owner-only — the button is owner-gated, the client function re-checks, and
 * both server routes refuse anyone else and log the refusal. Someone able to
 * skip this call is the account owner exporting their own data.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);          // `req` — reads the bearer token
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) return forbidden('Exporting is limited to the account owner.');

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const business_unit = typeof body.business_unit === 'string' ? body.business_unit : (ctx.businessUnit ?? 'commercial');
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter(x => typeof x === 'string') as string[] : null;
  const selected = !!ids?.length;

  const supabase = adminClient();

  // Server-computed. A client-supplied number is exactly what an export log
  // must not rely on.
  let q = supabase.from('crm_clients').select('id', { count: 'exact', head: true }).eq('business_unit', business_unit);
  if (ids?.length) q = q.in('id', ids);
  const { count: serverCount } = await q;
  const count = serverCount ?? 0;

  const { data: profile } = await supabase
    .from('crm_profiles')
    .select('first_name, last_name, email')
    .eq('id', ctx.userId)
    .single();
  const agent_name  = profile ? `${profile.first_name} ${profile.last_name}`.trim() : 'Unknown';
  const agent_email = profile?.email ?? '';

  // Durable first: the email is best-effort, the audit row is not.
  await writeAuditLog({
    actorId: ctx.userId,
    action: 'export_contacts',
    targetType: 'crm_clients',
    metadata: { unit: business_unit, count, selected, via: 'browser-csv' },
    req,
  }).catch(e => console.error('[export-log] audit write failed', e));

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
  }).then(() => recordIntegrationSuccess(EXPORT_ALERT_KEY))
      .catch(err => recordIntegrationFailure(EXPORT_ALERT_KEY,
        `A contact-export alert failed to send: ${err?.message ?? err}. The export WAS recorded in audit_logs — only the notification did not arrive.`,
        { subject: '⚠️ An export alert did not send' }));

  return NextResponse.json({ success: true });
}
