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
  gmailConnected: boolean;
  anthropic: { status: 'ok' | 'low_credit' | 'error'; detail?: string };
}

export async function checkIntegrationHealth(): Promise<IntegrationHealth> {
  const supabase = adminClient();

  const [{ data: last }, { count }] = await Promise.all([
    supabase.from('crm_prospective_properties').select('created_at').eq('business_unit', 'commercial').order('created_at', { ascending: false }).limit(1),
    supabase.from('crm_prospective_properties').select('id', { count: 'exact', head: true }).eq('business_unit', 'commercial'),
  ]);
  const lastIngestAt: string | null = last?.[0]?.created_at ?? null;
  const hoursSince = lastIngestAt ? Math.round((Date.now() - new Date(lastIngestAt).getTime()) / 3.6e6) : null;

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
  } else if (hoursSince != null && hoursSince > 30) {
    status = 'warn'; note = `No new listings ingested in ${hoursSince}h (the crawl runs 4×/day).`;
  }

  return { status, note, lastIngestAt, hoursSince, propertyCount: count ?? null, gmailConnected, anthropic };
}
