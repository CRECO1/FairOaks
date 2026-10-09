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
  anthropic: { status: 'ok' | 'low_credit' | 'error'; detail?: string };
}

// Broker-ingest cadence — MUST mirror the broker-ingest entries in vercel.json (UTC):
//   Mon–Fri 14:00 + 22:00 UTC (9am + 5pm CDT), Sat–Sun 17:00 UTC (noon CDT).
export const CRAWL_SCHEDULE_TEXT = '2×/day Mon–Fri, 1×/day Sat–Sun';
const SLOT_HOURS_UTC = { weekday: [14, 22], weekend: [17] };
const RUN_GRACE_MS = 90 * 60_000; // allow a late cron + the pipeline's own run time
export const CRAWL_HEARTBEAT_KEY = 'broker_ingest_run';

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
  const { data: beat } = await supabase.from('crm_integration_status').select('updated_at').eq('id', CRAWL_HEARTBEAT_KEY).maybeSingle();
  const lastRunAt: string | null = beat?.updated_at ?? null;
  const expected = lastExpectedRun();

  const { data: gmail } = await supabase.from('gmail_connections').select('gmail_email').limit(1);
  const gmailConnected = !!(gmail && gmail.length);

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
  if (!gmailConnected) {
    status = 'error'; note = 'Gmail is not connected — the crawl cannot read the Property DB folder.';
  } else if (anthropic.status === 'low_credit') {
    status = 'error'; note = 'Anthropic API credits are exhausted — listing extraction is failing. Add credits at console.anthropic.com → Billing.';
  } else if (anthropic.status === 'error') {
    status = 'warn'; note = `Anthropic API error: ${anthropic.detail ?? 'unknown'}`;
  } else if (lastRunAt && new Date(lastRunAt) < expected) {
    const ago = Math.round((Date.now() - new Date(lastRunAt).getTime()) / 3.6e6);
    status = 'warn'; note = `The Property DB crawl missed its scheduled run (expected by ${expected.toISOString().slice(0, 16).replace('T', ' ')} UTC; last successful run ${ago}h ago). Schedule: ${CRAWL_SCHEDULE_TEXT}.`;
  }

  return { status, note, lastIngestAt, hoursSince, propertyCount: count ?? null, lastRunAt, gmailConnected, anthropic };
}
