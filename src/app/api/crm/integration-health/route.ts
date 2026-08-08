import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import Anthropic from '@anthropic-ai/sdk';

// Admin-only snapshot of the integrations the CRM silently depends on, so a
// failure (crawl not producing, Gmail disconnected, Anthropic credits out)
// surfaces on the dashboard instead of dying quietly like it did on 2026-08-07.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const caller = await getCrmAdmin(req);
  if (!caller) return unauthorized();
  const supabase = adminClient();

  // Broker crawl: last ingest + total count (derived, no run-log table needed).
  const [{ data: last }, { count }] = await Promise.all([
    supabase.from('crm_prospective_properties').select('created_at')
      .eq('business_unit', 'commercial').order('created_at', { ascending: false }).limit(1),
    supabase.from('crm_prospective_properties').select('id', { count: 'exact', head: true })
      .eq('business_unit', 'commercial'),
  ]);
  const lastIngestAt: string | null = last?.[0]?.created_at ?? null;
  const hoursSince = lastIngestAt ? Math.round((Date.now() - new Date(lastIngestAt).getTime()) / 3.6e6) : null;

  // Gmail: the crawl reads listing emails from the connected inbox.
  const { data: gmail } = await supabase.from('gmail_connections').select('gmail_email').limit(1);
  const gmailConnected = !!(gmail && gmail.length);

  // Anthropic: a 1-token probe. Extraction is Claude-powered, so an exhausted
  // balance is exactly what silently killed the crawl — this makes it visible.
  let anthropic: { status: 'ok' | 'low_credit' | 'error'; detail?: string } = { status: 'ok' };
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    await client.messages.create({
      model: process.env.BROKER_INGEST_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    anthropic = { status: /credit|balance/i.test(msg) ? 'low_credit' : 'error', detail: msg.slice(0, 160) };
  }

  // Roll up the crawl's overall health from its dependencies.
  let status: 'ok' | 'warn' | 'error' = 'ok';
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

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    brokerCrawl: { status, note, lastIngestAt, hoursSince, propertyCount: count ?? null },
    gmail: { connected: gmailConnected },
    anthropic,
  });
}
