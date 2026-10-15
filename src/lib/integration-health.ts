import { findBrokerConnection, gmailRefreshKey, BROKER_GMAIL_EMAIL } from './broker-ingest/gmail';
import { adminClient } from '@/lib/supabase-admin';
import Anthropic from '@anthropic-ai/sdk';

// Shared health snapshot of the integrations the broker crawl depends on (Gmail inbox,
// Anthropic extraction, recency of the last ingest). Used by the admin dashboard route
// and the scheduled alert cron so both judge health identically.
export interface IntegrationHealth {
  status: 'ok' | 'warn' | 'error';
  note: string;
  lastIngestAt: string | null;
  hoursSince: number | null;
  propertyCount: number | null;
  lastRunAt: string | null;
  gmailConnected: boolean;
  /** Why the broker mailbox isn't usable, when it isn't (no connection / wrong mailbox / refresh rejected). */
  gmailProblem?: 'no_connection' | 'wrong_mailbox' | 'refresh_failed' | 'lookup_failed' | null;
  anthropic: { status: 'ok' | 'low_credit' | 'error'; detail?: string };
}

// Broker-ingest cadence — MUST mirror the broker-ingest entries in vercel.json (UTC):
//   Mon–Fri 14:00 + 22:00 UTC (9am + 5pm CDT), Sat–Sun 17:00 UTC (noon CDT).
export const CRAWL_SCHEDULE_TEXT = '2×/day Mon–Fri, 1×/day Sat–Sun';
const SLOT_HOURS_UTC = { weekday: [14, 22], weekend: [17] };
const RUN_GRACE_MS = 90 * 60_000; // allow a late cron + the pipeline's own run time
export const CRAWL_HEARTBEAT_KEY = 'broker_ingest_run';
// Written by the cron when a run FAILS. Kept apart from the heartbeat so a failure is never
// mistaken for a successful run's timestamp.
export const CRAWL_ERROR_KEY = 'broker_ingest_last_error';

/** Most recent scheduled crawl slot that is at least RUN_GRACE_MS in the past. */
export function lastExpectedRun(now = Date.now()): Date {
  const cutoff = now - RUN_GRACE_MS;
  for (let back = 0; back <= 3; back++) {
    const day = new Date(cutoff - back * 86_400_000);
    const dow = day.getUTCDay();
    const hours = dow === 0 || dow === 6 ? SLOT_HOURS_UTC.weekend : SLOT_HOURS_UTC.weekday;
    for (const h of [...hours].reverse()) {
      const slot = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h);
      if (slot <= cutoff) return new Date(slot);
    }
  }
  return new Date(cutoff);
}

export async function checkIntegrationHealth(): Promise<IntegrationHealth> {
  const supabase = adminClient();

  const [{ data: last }, { count }] = await Promise.all([
    supabase.from('crm_prospective_properties').select('created_at').eq('business_unit', 'commercial').order('created_at', { ascending: false }).limit(1),
    supabase.from('crm_prospective_properties').select('id', { count: 'exact', head: true }).eq('business_unit', 'commercial'),
  ]);
  const lastIngestAt: string | null = last?.[0]?.created_at ?? null;
  const hoursSince = lastIngestAt ? Math.round((Date.now() - new Date(lastIngestAt).getTime()) / 3.6e6) : null;

  // Heartbeat written by /api/cron/broker-ingest after each successful run (even a run that
  // finds nothing new). A quiet MLS is fine; a missed/failed scheduled run is not.
  const { data: statusRows, error: statusErr } = await supabase.from('crm_integration_status')
    .select('id, last_status, updated_at').in('id', [CRAWL_HEARTBEAT_KEY, CRAWL_ERROR_KEY]);
  // A failed read used to look identical to "no heartbeat" — say so instead.
  if (statusErr) console.error('[integration-health] could not read crm_integration_status:', statusErr.message);
  const beat = statusRows?.find(r => r.id === CRAWL_HEARTBEAT_KEY);
  const lastErr = statusRows?.find(r => r.id === CRAWL_ERROR_KEY);
  const lastRunAt: string | null = beat?.updated_at ?? null;
  const lastFailedAt: string | null = lastErr?.updated_at ?? null;
  const expected = lastExpectedRun();

  // The BROKER mailbox, found the same way the cron finds it (by Gmail address, any CRM login) —
  // so the watchdog and the crawl cannot disagree about whether it is connected.
  const found = await findBrokerConnection();
  const gmailConnected = !!found.conn;
  let gmailProblem: IntegrationHealth['gmailProblem'] = null;
  if (!found.conn) gmailProblem = found.error ? 'lookup_failed' : found.otherMailboxes.length ? 'wrong_mailbox' : 'no_connection';
  else {
    // The refresh cron / crawl record a rejected refresh token here.
    const { data: rf } = await supabase.from('crm_integration_status').select('last_status').eq('id', gmailRefreshKey(found.conn.id)).maybeSingle();
    if (rf?.last_status === 'error') gmailProblem = 'refresh_failed';
  }

  // A 1-token probe — Claude powers extraction, so an exhausted balance is exactly what
  // silently kills the crawl. This surfaces it. (Anthropic doesn't expose the remaining
  // prepaid balance to the API, so we can only detect the failure, not forecast it.)
  let anthropic: IntegrationHealth['anthropic'] = { status: 'ok' };
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    await client.messages.create({ model: process.env.BROKER_INGEST_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: '.' }] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    anthropic = { status: /credit|balance/i.test(msg) ? 'low_credit' : 'error', detail: msg.slice(0, 160) };
  }

  let status: IntegrationHealth['status'] = 'ok';
  let note = 'Running normally.';
  if (gmailProblem === 'wrong_mailbox') {
    status = 'error'; note = `Gmail is connected for the broker user as ${found.otherMailboxes.join(', ')}, not ${BROKER_GMAIL_EMAIL} — the crawl only reads ${BROKER_GMAIL_EMAIL}. Connect that Google account in the CRM sidebar.`;
  } else if (gmailProblem === 'no_connection') {
    status = 'error'; note = `No Gmail connection for ${BROKER_GMAIL_EMAIL} — the crawl cannot read the Property DB folder. Connect that Google account in the CRM sidebar (any CRM login works).`;
  } else if (gmailProblem === 'lookup_failed') {
    status = 'warn'; note = `Could not look up the broker Gmail connection: ${found.error}`;
  } else if (gmailProblem === 'refresh_failed') {
    status = 'error'; note = `Google is rejecting the stored refresh token for ${BROKER_GMAIL_EMAIL} — reconnect Gmail in the CRM sidebar. If this repeats about weekly, the Google OAuth app is still in "Testing" mode (7-day refresh tokens).`;
  } else if (anthropic.status === 'low_credit') {
    status = 'error'; note = 'Anthropic API credits are exhausted — listing extraction is failing. Add credits at console.anthropic.com → Billing.';
  } else if (anthropic.status === 'error') {
    status = 'warn'; note = `Anthropic API error: ${anthropic.detail ?? 'unknown'}`;
  } else if (lastFailedAt && (!lastRunAt || new Date(lastFailedAt) > new Date(lastRunAt))) {
    // The newest outcome is a failure (the cron wrote it). The failure email has the detail.
    status = 'warn'; note = `The last Property DB crawl FAILED (${lastFailedAt.slice(0, 16).replace('T', ' ')} UTC) and nothing has succeeded since — see the "auto-crawl is failing" email or the Vercel logs for /api/cron/broker-ingest.`;
  } else if (!lastRunAt) {
    // Never recorded a successful run — a silent failure used to look identical to "not started yet".
    status = 'warn'; note = 'The Property DB crawl has no successful run on record — check /api/cron/broker-ingest in the Vercel logs (a run that is killed at the time limit never writes its heartbeat).';
  } else if (new Date(lastRunAt) < expected) {
    const ago = Math.round((Date.now() - new Date(lastRunAt).getTime()) / 3.6e6);
    status = 'warn'; note = `The Property DB crawl missed its scheduled run (expected by ${expected.toISOString().slice(0, 16).replace('T', ' ')} UTC; last successful run ${ago}h ago). Schedule: ${CRAWL_SCHEDULE_TEXT}.`;
  }

  return { status, note, lastIngestAt, hoursSince, propertyCount: count ?? null, lastRunAt, gmailConnected, gmailProblem, anthropic };
}
