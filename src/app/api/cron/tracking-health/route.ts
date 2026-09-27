/**
 * GET /api/cron/tracking-health — watchdog for email open/click tracking.
 *
 * WHY THIS EXISTS. The Elkhorn campaign of 2026-09-25 produced 15 real clicks.
 * Resend recorded every one of them. The CRM recorded none, and nobody noticed
 * for a day. The campaign ingestion branch of the Resend webhook shipped at
 * 21:09 UTC, 6h24m AFTER the 14:45 send, and until it did every campaign event
 * hit the handler, matched no e-sign signer, and was answered 200 {ok:true} —
 * so Resend treated the drop as a success and never retried. Clicks cluster in
 * the first hours after a send, so the whole click history of that campaign
 * fell in the blind window and is unrecoverable: Resend's /events endpoint
 * returns nothing historical.
 *
 * Opens kept arriving after the deploy, which is what made it invisible —
 * "tracking" looked alive because opens were landing. The lesson is that opens
 * working tells you nothing about clicks, so this checks clicks directly and
 * against an external source of truth rather than against our own optimism.
 *
 * FOUR CHECKS, cheapest first:
 *
 *  1. CONFIG — Resend still reports click_tracking enabled on the domain. This
 *     is the dashboard toggle; if anyone turns it off, links stop being
 *     rewritten and clicks become structurally impossible.
 *
 *  2. TRACKING HOST — https://track.crecotx.com still resolves and answers.
 *     The rewritten links point here; if the CNAME or its certificate breaks,
 *     every click dies at the recipient and we would otherwise see only a
 *     quiet decline.
 *
 *  3. RECONCILIATION (the one that would have caught this) — for recent sends,
 *     ask Resend what IT thinks happened, then compare with what we stored. If
 *     Resend reports clicks on messages where we hold no click row, ingestion
 *     is broken. This is an external oracle: it does not care whether our
 *     webhook, our handler or our database is at fault, only that the truth
 *     and our copy of it disagree.
 *
 *  4. OPENS WITHOUT CLICKS — a campaign with real open volume and zero clicks
 *     well after the send. Weaker (a campaign genuinely can go unclicked), so
 *     it only ever reports 'degraded', never 'error'.
 *
 * Checks 1, 2 and 4 need no Resend reads beyond one domains call; check 3
 * samples a bounded number of messages so a big send cannot turn this into a
 * hundreds-of-requests job.
 *
 * Alerting reuses the importer cron's pattern exactly: crm_integration_status
 * for de-duplication, alert on the way into trouble / on worsening / hourly
 * while still broken, one note on recovery, silence when healthy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FROM_EMAIL  = process.env.FROM_EMAIL ?? 'noreply@fairoaksrealtygroup.com';
const ALERT_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL ?? 'info@crecotx.com';
const STATUS_KEY  = 'email_tracking';
const TRACK_HOST  = process.env.RESEND_TRACK_HOST ?? 'track.crecotx.com';
const TRACKED_DOMAIN = 'crecotx.com';

/** Look back this far for sends to reconcile. */
const LOOKBACK_DAYS = 7;
/** Never ask Resend about more than this many messages in one run. */
const SAMPLE_LIMIT = 40;
/** Give clicks this long to arrive before judging a campaign. */
const GRACE_HOURS = 12;
/** Opens on a campaign with zero clicks past the grace window = suspicious. */
const OPENS_WITHOUT_CLICKS = 15;
/**
 * Campaign event ingestion went live with commit 3abf6f7. Everything sent
 * before this is known to be missing its clicks and cannot be recovered, so
 * reconciling it would raise a true but permanently unactionable alarm every
 * hour until it aged out. The watchdog is for catching NEW breakage; this is
 * the line between "already known and lost" and "something just broke".
 */
const INGESTION_LIVE_SINCE = '2026-09-25T21:09:00Z';
const REALERT_AFTER_MS = 60 * 60 * 1000;

const RANK: Record<string, number> = { ok: 0, degraded: 1, error: 2 };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Cloudflare fronts api.resend.com and 403s (error 1010) clients it does not
 * recognise — a bare library user-agent gets blocked. A blocked request must
 * never be read as "no clicks", so every call here sends a UA and failures are
 * surfaced rather than counted as zero.
 */
async function resendGet(path: string, key: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  try {
    const res = await fetch(`https://api.resend.com${path}`, {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'creco-crm-tracking-health/1.0' },
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

async function sendAlert(subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[cron/tracking-health] RESEND_API_KEY unset — alert not sent:', subject);
    return;
  }
  try {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: FROM_EMAIL, to: ALERT_EMAIL, subject, html,
    });
    if (error) console.error('[cron/tracking-health] Resend rejected the alert:', error);
  } catch (e) {
    console.error('[cron/tracking-health] alert email failed:', e);
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = (process.env.RESEND_API_KEY_COMMERCIAL ?? '').replace(/[\r\n\s]+$/, '');
  const db = adminClient();
  const problems: string[] = [];
  const notes: string[] = [];
  // Held on an object, not a bare `let`: control-flow analysis narrows a local
  // to its initial 'ok' because it cannot see the closure below reassign it,
  // and every later `status === 'error'` then fails to compile.
  const health: { status: 'ok' | 'degraded' | 'error' } = { status: 'ok' };
  const bump = (s: 'degraded' | 'error') => { if (RANK[s] > RANK[health.status]) health.status = s; };

  // ── 1. Is click tracking still switched on? ───────────────────────────────
  let clickTrackingOn: boolean | null = null;
  if (!key) {
    problems.push('RESEND_API_KEY_COMMERCIAL is not set — cannot verify tracking configuration.');
    bump('error');
  } else {
    const d = await resendGet('/domains', key);
    if (!d.ok) {
      notes.push(`Could not read Resend domains (HTTP ${d.status}) — configuration unverified this run.`);
      bump('degraded');
    } else {
      const list = (d.body?.data as Array<Record<string, unknown>> | undefined) ?? [];
      const dom = list.find(x => x.name === TRACKED_DOMAIN);
      if (!dom) {
        problems.push(`${TRACKED_DOMAIN} is no longer present on the Resend account.`);
        bump('error');
      } else {
        clickTrackingOn = dom.click_tracking === true;
        if (!clickTrackingOn) {
          problems.push(`Click tracking is DISABLED for ${TRACKED_DOMAIN} in Resend. Outbound links are not being rewritten, so no click can ever be recorded. Re-enable it under Domains → ${TRACKED_DOMAIN} → Click tracking.`);
          bump('error');
        }
        if (dom.status !== 'verified') {
          problems.push(`${TRACKED_DOMAIN} is in status "${String(dom.status)}" rather than verified.`);
          bump('error');
        }
      }
    }
  }

  // ── 2. Does the link-rewriting host still answer? ─────────────────────────
  // Rewritten links point at TRACK_HOST. Any HTTP answer proves DNS and TLS are
  // alive; the path is meaningless so the status code itself does not matter.
  try {
    const res = await fetch(`https://${TRACK_HOST}/`, {
      method: 'GET', redirect: 'manual',
      headers: { 'User-Agent': 'creco-crm-tracking-health/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    notes.push(`${TRACK_HOST} answered HTTP ${res.status}.`);
  } catch (e) {
    problems.push(`${TRACK_HOST} did not respond (${e instanceof Error ? e.message : String(e)}). Rewritten links in already-delivered email are dead until this resolves.`);
    bump('error');
  }

  // ── 3. Reconcile Resend's record against ours ─────────────────────────────
  const lookback = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const since = lookback > INGESTION_LIVE_SINCE ? lookback : INGESTION_LIVE_SINCE;
  const graceCutoff = new Date(Date.now() - GRACE_HOURS * 3600_000).toISOString();

  const { data: sends } = await db
    .from('crm_campaign_sends')
    .select('id, campaign_id, provider_id, sent_at')
    .gte('sent_at', since)
    .lte('sent_at', graceCutoff)
    .not('provider_id', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(SAMPLE_LIMIT);

  const sample = sends ?? [];
  let resendClicks = 0, ourClicks = 0, checked = 0, apiErrors = 0;

  if (sample.length && key) {
    const campaignIds = [...new Set(sample.map(s => s.campaign_id).filter(Boolean))] as string[];
    const { data: clickRows } = await db
      .from('email_tracking_events')
      .select('campaign_id')
      .eq('event_type', 'click')
      .in('campaign_id', campaignIds.length ? campaignIds : ['00000000-0000-0000-0000-000000000000']);
    ourClicks = (clickRows ?? []).length;

    for (const s of sample) {
      const r = await resendGet(`/emails/${s.provider_id}`, key);
      if (!r.ok) { apiErrors++; continue; }
      checked++;
      if (r.body?.last_event === 'clicked') resendClicks++;
    }

    // The exact shape of the Elkhorn failure: the provider saw clicks, we hold
    // none. An external oracle disagreeing with us is never a false positive.
    if (resendClicks > 0 && ourClicks === 0) {
      problems.push(`Resend reports ${resendClicks} clicked message(s) in the last ${LOOKBACK_DAYS} days but the CRM holds ZERO click events for those campaigns. Clicks are being recorded upstream and lost on ingestion — check the Resend webhook subscription includes email.clicked and that /api/webhooks/resend is returning 2xx.`);
      bump('error');
    }
    if (apiErrors && !checked) {
      notes.push(`All ${apiErrors} Resend lookups failed — reconciliation did not run this time (a blocked or rate-limited API reads as unknown, never as "no clicks").`);
      bump('degraded');
    }
  }

  // ── 4. Real open volume, no clicks at all ─────────────────────────────────
  const { data: openAgg } = await db
    .from('crm_campaign_sends')
    .select('campaign_id, opened_at, sent_at')
    .gte('sent_at', since)
    .lte('sent_at', graceCutoff)
    .not('opened_at', 'is', null)
    .limit(1000);

  const opensByCampaign = new Map<string, number>();
  for (const r of openAgg ?? []) {
    if (!r.campaign_id) continue;
    opensByCampaign.set(r.campaign_id, (opensByCampaign.get(r.campaign_id) ?? 0) + 1);
  }
  const suspicious: string[] = [];
  for (const [cid, opens] of opensByCampaign) {
    if (opens < OPENS_WITHOUT_CLICKS) continue;
    const { count } = await db
      .from('email_tracking_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'click').eq('campaign_id', cid);
    if (!count) suspicious.push(`${cid} (${opens} opens, 0 clicks)`);
  }
  if (suspicious.length) {
    problems.push(`Campaign(s) with real open volume and no clicks at all more than ${GRACE_HOURS}h after sending: ${suspicious.join('; ')}. Possible, but it is what a broken click pipeline looks like.`);
    bump('degraded');
  }

  // ── 5. Backstop for lead-notification failures ───────────────────────────
  // recordIntegrationFailure() already tries to email the moment a lead alert
  // fails, but when the thing that broke IS email that alert can fail too. The
  // status row is written unconditionally, so reading it here means a stuck
  // failure still surfaces on this cron's own schedule.
  const { data: notifyRow } = await db
    .from('crm_integration_status')
    .select('last_status, updated_at').eq('id', 'lead_notifications').maybeSingle();
  if (notifyRow && notifyRow.last_status && notifyRow.last_status !== 'ok') {
    problems.push(`Lead notification emails are failing (state "${notifyRow.last_status}" as of ${String(notifyRow.updated_at).slice(0, 19)}). New leads are still being SAVED — only the alert to ${ALERT_EMAIL} is not arriving.`);
    bump('error');
  }

  // Export alerts share the same backstop: the row is written even when the
  // notification email cannot be sent.
  const { data: exportRow } = await db
    .from('crm_integration_status')
    .select('last_status, updated_at').eq('id', 'export_alerts').maybeSingle();
  if (exportRow && exportRow.last_status && exportRow.last_status !== 'ok') {
    problems.push(`Contact-export alerts are failing (state "${exportRow.last_status}" as of ${String(exportRow.updated_at).slice(0, 19)}). Exports are still recorded in audit_logs — only the notification is not arriving.`);
    bump('error');
  }

  const detail = problems.join(' | ');
  if (health.status !== 'ok') console.error(`[cron/tracking-health] ${health.status}: ${detail}`, notes);

  // ── De-duplicated alerting (same contract as the importer cron) ───────────
  const { data: prev } = await db
    .from('crm_integration_status')
    .select('last_status, last_alert_at').eq('id', STATUS_KEY).maybeSingle();
  const prevStatus = (prev?.last_status as string | undefined) ?? 'ok';
  const lastAlertAt = prev?.last_alert_at ? new Date(prev.last_alert_at as string).getTime() : 0;
  const staleEnough = Date.now() - lastAlertAt > REALERT_AFTER_MS;
  const worsened = (RANK[health.status] ?? 0) > (RANK[prevStatus] ?? 0);
  let alerted = false;

  if (health.status !== 'ok' && (prevStatus === 'ok' || worsened || staleEnough)) {
    await sendAlert(
      health.status === 'error' ? '🚨 Email click tracking looks broken' : '⚠️ Email tracking needs a look',
      `<div style="font-family:sans-serif;max-width:640px">
         <h2 style="color:#b00020;margin-bottom:4px">Email tracking — ${esc(health.status)}</h2>
         <ul style="color:#333">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
         ${notes.length ? `<p style="color:#777;font-size:13px">${notes.map(esc).join('<br>')}</p>` : ''}
         <p style="color:#555;font-size:13px">Reconciled ${checked} recent message(s): Resend reported ${resendClicks} clicked, the CRM holds ${ourClicks} click event(s) for those campaigns.</p>
         <p style="color:#888;font-size:12px">Clicks are not replayable — Resend keeps no historical event feed — so anything missed while this is broken is lost for good.</p>
       </div>`,
    );
    alerted = true;
  } else if (health.status === 'ok' && prevStatus !== 'ok') {
    await sendAlert('✅ Email tracking recovered',
      `<div style="font-family:sans-serif;max-width:640px">
         <h2 style="color:#1a7f37">Email tracking is healthy again</h2>
         <p style="color:#555">Reconciled ${checked} recent message(s); Resend and the CRM agree.</p>
       </div>`);
    alerted = true;
  }

  await db.from('crm_integration_status').upsert({
    id: STATUS_KEY,
    last_status: health.status,
    ...(alerted ? { last_alert_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json(
    { ok: health.status === 'ok', status: health.status, clickTrackingOn, checked, resendClicks, ourClicks,
      problems: problems.length ? problems : undefined, notes, alerted },
    { status: health.status === 'error' ? 500 : 200 },
  );
}
