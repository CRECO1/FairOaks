/**
 * GET /api/cron/integration-health
 *
 * Proactive watchdog for the broker crawl's dependencies (Gmail inbox, Anthropic
 * extraction, ingest recency). Runs several times a day, independent of the crawl,
 * and emails an alert the moment something degrades — catching failures the crawl's
 * own alert can miss (a disconnected inbox scans 0 emails and never trips it).
 *
 * De-duplicated via crm_integration_status: alerts on the transition into trouble
 * (or when it worsens warn→error), then at most once/day while still down, plus a
 * one-time "recovered" note. Secured with CRON_SECRET like every other cron.
 *
 * NOTE: Anthropic does not expose the remaining prepaid balance to the API, so this
 * can only detect a failure — not forecast it. The true "warn before it runs dry" is
 * Anthropic console → Billing → auto-reload + low-balance email notifications.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';
import { checkIntegrationHealth, type IntegrationHealth } from '@/lib/integration-health';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';
const ALERT_EMAIL = process.env.BROKER_INGEST_ALERT_EMAIL ?? 'zack@crecotx.com';
const KEY = 'broker_crawl';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function email(subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM_EMAIL, to: ALERT_EMAIL, subject, html });
    if (error) console.error('integration-health: Resend rejected alert:', error);
  } catch (e) { console.error('integration-health: alert email failed:', e); }
}

function alertHtml(h: IntegrationHealth) {
  const creditsOut = h.anthropic.status === 'low_credit';
  return `
    <div style="font-family:sans-serif;max-width:600px">
      <h2 style="color:#b00020;margin-bottom:4px">⚠️ CRM integration needs attention</h2>
      <p style="color:#333">${esc(h.note)}</p>
      ${creditsOut ? `<p style="color:#333"><strong>New broker listings are not being added</strong> until this is resolved.</p>
        <p style="color:#555">Add credits at <a href="https://console.anthropic.com/settings/billing">Anthropic Plans &amp; Billing</a>. To avoid this in future, enable <strong>Auto-reload</strong> and <strong>low-balance email notifications</strong> on the same page.</p>` : ''}
      ${!h.gmailConnected ? `<p style="color:#555">Reconnect Gmail in the CRM so the crawl can read the Property DB folder.</p>` : ''}
      <p style="color:#999;font-size:12px">Fair Oaks CRM · integration watchdog · last ingest ${h.hoursSince != null ? `${h.hoursSince}h ago` : 'unknown'} · ${h.propertyCount ?? '?'} listings</p>
    </div>`;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const h = await checkIntegrationHealth();
  const degraded = h.status !== 'ok';
  const supabase = adminClient();
  const { data: prev } = await supabase.from('crm_integration_status').select('last_status, last_alert_at').eq('id', KEY).maybeSingle();
  const lastStatus = prev?.last_status ?? 'ok';
  const hoursSinceAlert = prev?.last_alert_at ? (Date.now() - new Date(prev.last_alert_at).getTime()) / 3.6e6 : Infinity;

  let alerted = false;
  let newAlertAt: string | null = prev?.last_alert_at ?? null;

  if (degraded) {
    const worsened = lastStatus === 'ok' || (lastStatus === 'warn' && h.status === 'error');
    if (worsened || hoursSinceAlert >= 20) {
      await email('⚠️ CRM integration alert — Property DB crawl', alertHtml(h));
      alerted = true; newAlertAt = new Date().toISOString();
    }
  } else if (lastStatus !== 'ok') {
    await email('✅ CRM integrations recovered', `<div style="font-family:sans-serif;max-width:600px"><h2 style="color:#15803d">✅ Back to normal</h2><p style="color:#333">The Property DB crawl's dependencies are healthy again${h.hoursSince != null ? ` — last ingest ${h.hoursSince}h ago` : ''}.</p></div>`);
    alerted = true; newAlertAt = null;
  } else {
    newAlertAt = null;
  }

  await supabase.from('crm_integration_status').upsert({ id: KEY, last_status: h.status, last_alert_at: newAlertAt, updated_at: new Date().toISOString() });
  return NextResponse.json({ status: h.status, note: h.note, alerted });
}
