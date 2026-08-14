import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, unauthorized } from '@/lib/crm-auth';
import { checkIntegrationHealth } from '@/lib/integration-health';

// Admin-only snapshot of the integrations the CRM silently depends on, so a
// failure (crawl not producing, Gmail disconnected, Anthropic credits out)
// surfaces on the dashboard instead of dying quietly like it did on 2026-08-07.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const caller = await getCrmAdmin(req);
  if (!caller) return unauthorized();
  const h = await checkIntegrationHealth();
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    brokerCrawl: { status: h.status, note: h.note, lastIngestAt: h.lastIngestAt, hoursSince: h.hoursSince, propertyCount: h.propertyCount },
    gmail: { connected: h.gmailConnected },
    anthropic: h.anthropic,
  });
}
