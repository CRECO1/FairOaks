import { NextRequest, NextResponse } from 'next/server';
import { runDueScheduledEmails } from '@/lib/scheduled-emails';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/cron/scheduled-emails — every 5 minutes: sends the emails agents scheduled with "Send later" whose time has come.
 * Secured by CRON_SECRET like the other crons.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const results = await runDueScheduledEmails();
  return NextResponse.json({ due: results.length, sent: results.filter(r => r.status === 'sent').length, retry: results.filter(r => r.status === 'retry').length, failed: results.filter(r => r.status === 'failed').length });
}
