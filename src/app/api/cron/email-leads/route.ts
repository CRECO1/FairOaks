/**
 * GET /api/cron/email-leads — triggers the Gmail lead importer every 15 minutes.
 *
 * This route used to be the quietest thing in the codebase: no console.error,
 * no alert, and a 200 with `{ok:false}` whenever the sync behind it failed.
 * Vercel does not alert on a 200, so the lead pipeline — the one job the CRM
 * exists to do — could be dead for weeks with nothing to notice it.
 *
 * It matters more now that a failed message is deliberately left UNPROCESSED so
 * the next run retries it. That is the right behaviour (it replaced silently
 * dropping the lead), but it means a persistent failure retries forever and
 * imports nothing, which without an alert looks exactly like "no new leads".
 *
 * Two things now raise an alarm:
 *   - the sync call itself failing (non-2xx, an `error` body, or a thrown fetch)
 *   - a run where FAILURE_THRESHOLD or more messages failed to import
 *
 * De-duplicated through crm_integration_status, the same table and shape the
 * broker-crawl watchdog uses: alert on the way into trouble, again only if it
 * worsens or an hour has passed, and once on recovery. A clean run writes a
 * timestamp and sends nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FROM_EMAIL   = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';
const ALERT_EMAIL  = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@crecotx.com';
const STATUS_KEY   = 'email_leads_sync';
/** A run with this many failed messages is degraded even if others succeeded. */
const FAILURE_THRESHOLD = 3;
/** While still broken, re-alert at most this often (leads are time-sensitive). */
const REALERT_AFTER_MS = 60 * 60 * 1000;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const RANK: Record<string, number> = { ok: 0, degraded: 1, error: 2 };

async function sendAlert(subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[cron/email-leads] RESEND_API_KEY unset — alert not sent:', subject);
    return;
  }
  try {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: FROM_EMAIL, to: ALERT_EMAIL, subject, html,
    });
    if (error) console.error('[cron/email-leads] Resend rejected the alert:', error);
  } catch (e) {
    console.error('[cron/email-leads] alert email failed:', e);
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.fairoaksrealtygroup.com';
  const syncSecret = process.env.INTERNAL_SYNC_SECRET ?? '';

  let status: 'ok' | 'degraded' | 'error' = 'ok';
  let detail = '';
  let data: Record<string, unknown> = {};
  let httpStatus = 0;

  try {
    const res = await fetch(`${base}/api/email-leads/sync`, {
      method: 'POST',
      headers: { 'x-internal-key': syncSecret },
    });
    httpStatus = res.status;
    data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      status = 'error';
      detail = `sync returned HTTP ${res.status}${data.error ? ` — ${String(data.error)}` : ''}`;
    } else if (Number(data.failed ?? 0) >= FAILURE_THRESHOLD) {
      status = 'degraded';
      detail = `${data.failed} message(s) failed to import this run (longest consecutive run: ${data.maxConsecutiveFailures ?? '?'}). They are NOT marked processed and will retry.`;
    }
  } catch (e) {
    status = 'error';
    detail = `could not reach the sync endpoint: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (status !== 'ok') {
    console.error(`[cron/email-leads] ${status}: ${detail}`, data.failureSamples ?? '');
  }

  // ── De-duplicated alerting ────────────────────────────────────────────────
  const db = adminClient();
  const { data: prev } = await db
    .from('crm_integration_status')
    .select('last_status, last_alert_at')
    .eq('id', STATUS_KEY)
    .maybeSingle();

  const prevStatus = (prev?.last_status as string | undefined) ?? 'ok';
  const lastAlertAt = prev?.last_alert_at ? new Date(prev.last_alert_at as string).getTime() : 0;
  const staleEnough = Date.now() - lastAlertAt > REALERT_AFTER_MS;
  const worsened = (RANK[status] ?? 0) > (RANK[prevStatus] ?? 0);

  let alerted = false;

  if (status !== 'ok' && (prevStatus === 'ok' || worsened || staleEnough)) {
    const samples = Array.isArray(data.failureSamples) ? (data.failureSamples as string[]) : [];
    await sendAlert(
      status === 'error'
        ? '🚨 Lead importer is failing'
        : '⚠️ Lead importer: messages are not importing',
      `<div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#b00020;margin-bottom:4px">Lead importer — ${esc(status)}</h2>
        <p style="color:#333">${esc(detail)}</p>
        ${samples.length ? `<p style="color:#555;margin-bottom:4px">Examples:</p>
          <ul style="color:#555">${samples.map(x => `<li>${esc(String(x))}</li>`).join('')}</ul>` : ''}
        <p style="color:#555">Imported this run: <strong>${esc(String(data.imported ?? 0))}</strong>.
           Nothing has been lost — failed messages stay unprocessed and retry every 15 minutes.</p>
        <p style="color:#888;font-size:12px">Checked ${esc(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))} CT · HTTP ${esc(String(httpStatus))}</p>
      </div>`,
    );
    alerted = true;
  } else if (status === 'ok' && prevStatus !== 'ok') {
    await sendAlert(
      '✅ Lead importer recovered',
      `<div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#1a7f37;margin-bottom:4px">Lead importer is healthy again</h2>
        <p style="color:#333">Imported this run: <strong>${esc(String(data.imported ?? 0))}</strong>.
           Anything that failed while it was down has been retried.</p>
      </div>`,
    );
    alerted = true;
  }

  await db.from('crm_integration_status').upsert({
    id: STATUS_KEY,
    last_status: status,
    ...(alerted ? { last_alert_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  });

  // Report the real outcome in the HTTP status too, so a failure is visible to
  // anything watching the endpoint rather than only to the alert.
  return NextResponse.json(
    { ok: status === 'ok', status, detail: detail || undefined, alerted, ...data },
    { status: status === 'error' ? 500 : 200 },
  );
}
