/**
 * Shared "an integration just failed" recorder, on the crm_integration_status
 * contract already used by the broker-crawl, lead-importer and tracking
 * watchdogs: alert on the way into trouble, again on worsening or hourly while
 * still broken, one note on recovery, silence when healthy.
 *
 * WHY. Lead notifications were sent with `.catch(() => console.error(...))`.
 * That is right about one thing — a Resend failure must never lose the lead,
 * which is already saved by then — but it means the alert simply evaporates.
 * Zack would have a new lead in the CRM and no ping, and nothing anywhere
 * would say so. Same silent-failure shape as the importer cron and the click
 * pipeline.
 *
 * THE CIRCULARITY, stated plainly: when the thing that failed IS email, the
 * alert about it may fail too. So the DURABLE part is the status row — it is
 * written first and unconditionally, and the email is a best-effort extra.
 * cron/tracking-health reads the row on its own schedule, so a stuck failure
 * still surfaces even if every alert send failed.
 */
import { Resend, type CreateEmailOptions } from 'resend';
import { adminClient } from '@/lib/supabase-admin';

const FROM_EMAIL  = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';
const ALERT_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@crecotx.com';
const REALERT_AFTER_MS = 60 * 60 * 1000;
const RANK: Record<string, number> = { ok: 0, degraded: 1, error: 2 };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Record a failed integration action. Never throws: a monitoring path must not
 * be able to break the request that called it.
 */
export async function recordIntegrationFailure(
  key: string,
  detail: string,
  opts: { severity?: 'degraded' | 'error'; subject?: string } = {},
): Promise<void> {
  const severity = opts.severity ?? 'error';
  try {
    const db = adminClient();
    const { data: prev } = await db.from('crm_integration_status')
      .select('last_status, last_alert_at').eq('id', key).maybeSingle();
    const prevStatus = (prev?.last_status as string | undefined) ?? 'ok';
    const lastAlertAt = prev?.last_alert_at ? new Date(prev.last_alert_at as string).getTime() : 0;
    const shouldAlert =
      prevStatus === 'ok' ||
      (RANK[severity] ?? 0) > (RANK[prevStatus] ?? 0) ||
      Date.now() - lastAlertAt > REALERT_AFTER_MS;

    console.error(`[integration:${key}] ${severity}: ${detail}`);

    // Durable first — this survives even when the alert email cannot be sent.
    await db.from('crm_integration_status').upsert({
      id: key, last_status: severity,
      ...(shouldAlert ? { last_alert_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    });

    if (!shouldAlert || !process.env.RESEND_API_KEY) return;
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: FROM_EMAIL, to: ALERT_EMAIL,
      subject: opts.subject ?? `⚠️ ${key} is failing`,
      html: `<div style="font-family:sans-serif;max-width:640px">
        <h2 style="color:#b00020;margin-bottom:4px">${esc(key)} — ${esc(severity)}</h2>
        <p style="color:#333">${esc(detail)}</p>
        <p style="color:#888;font-size:12px">Recorded ${esc(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))} CT.
        If this is about lead notifications, the lead itself was still saved to the CRM — only the alert email failed.</p>
      </div>`,
    }).catch(e => console.error(`[integration:${key}] alert email also failed:`, e));
  } catch (e) {
    console.error(`[integration:${key}] could not record failure:`, e);
  }
}

/** Clear a key back to healthy, with one recovery note if it had been failing. */
export async function recordIntegrationSuccess(key: string): Promise<void> {
  try {
    const db = adminClient();
    const { data: prev } = await db.from('crm_integration_status')
      .select('last_status').eq('id', key).maybeSingle();
    const prevStatus = (prev?.last_status as string | undefined) ?? 'ok';
    if (prevStatus === 'ok') {
      // Cheap path: only touch the timestamp, never send anything.
      await db.from('crm_integration_status').upsert({ id: key, last_status: 'ok', updated_at: new Date().toISOString() });
      return;
    }
    await db.from('crm_integration_status').upsert({
      id: key, last_status: 'ok', last_alert_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    if (!process.env.RESEND_API_KEY) return;
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: FROM_EMAIL, to: ALERT_EMAIL, subject: `✅ ${key} recovered`,
      html: `<div style="font-family:sans-serif;max-width:640px"><h2 style="color:#1a7f37">${esc(key)} is working again</h2></div>`,
    }).catch(() => {});
  } catch (e) {
    console.error(`[integration:${key}] could not record success:`, e);
  }
}

/**
 * Send a transactional email and record the result against a monitor key.
 *
 * This is the CORRECT replacement for the pattern that was copied across the
 * lead-notification routes:
 *
 *     resend.emails.send(...).then(() => recordIntegrationSuccess(KEY))
 *                            .catch(err => recordIntegrationFailure(KEY, ...))
 *
 * That pattern is subtly broken: `resend.emails.send()` RESOLVES with `{ error }`
 * on a 4xx/5xx (a daily/monthly cap 429, an unverified domain, an invalid
 * recipient) — it does not reject. So `.then()` ran on failed sends and the send
 * was recorded as a SUCCESS, leaving integration-health falsely green while the
 * alert never left. Only a thrown/network error hit `.catch()`. This helper
 * checks `error` and routes to the right recorder. It never throws — a failed
 * alert must not break the request that saved the lead.
 */
export async function sendMonitored(
  resend: Resend,
  payload: CreateEmailOptions,
  monitorKey: string,
  opts: { failSubject?: string; label?: string } = {},
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const label = opts.label ?? monitorKey;
  try {
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      const msg = `${(error as { name?: string }).name ?? 'error'}: ${(error as { message?: string }).message ?? String(error)}`;
      await recordIntegrationFailure(monitorKey, `${label} email failed — ${msg}.`, { subject: opts.failSubject });
      return { ok: false, error: msg };
    }
    await recordIntegrationSuccess(monitorKey);
    return { ok: true, id: (data as { id?: string } | null)?.id };
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    await recordIntegrationFailure(monitorKey, `${label} email threw — ${msg}.`, { subject: opts.failSubject });
    return { ok: false, error: msg };
  }
}

/** The key every lead-notification (email) path reports under. */
export const LEAD_NOTIFY_KEY = 'lead_notifications';

/** The key the lead-CAPTURE (DB write) path reports under — kept distinct from
 *  LEAD_NOTIFY_KEY so a lead that FAILED TO SAVE is tracked separately from a
 *  lead that saved but whose notification email failed. */
export const LEAD_WRITE_KEY = 'lead_capture_db';
