/**
 * GET /api/cron/known-contact-summary — Mon–Sat, 13:05 and 14:05 UTC (= 8:05 am Central in both CDT and CST; the
 * run that lands inside business hours sends, the other finds nothing left to send). Rolls the after-hours
 * known-contact website activity into one morning email per owner. Secured with CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { sendKnownContactMorningSummary } from '@/lib/known-contact-alert';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await sendKnownContactMorningSummary(adminClient()));
  } catch (e) {
    console.error('[known-contact-summary]', e);
    return NextResponse.json({ error: 'Summary failed' }, { status: 500 });
  }
}
