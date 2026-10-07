import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { syncTalkroute, syncTexts, talkrouteConfigured } from '@/lib/talkroute';
import { dbError } from '@/lib/crm-auth';
import { tidyCallLog } from '@/lib/call-routing';
import { sendMissedCallTexts } from '@/lib/missed-call-text';
import { sendInstantMissedAlerts } from '@/lib/call-sla';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/talkroute-sync — every 15 minutes (vercel.json).
 *
 * Pulls the last two days of Talkroute call records and voicemails into
 * crm_call_log. Idempotent: rows are keyed by Talkroute's own ids, and anything an
 * agent has done to a row (handled, notes, contact link) is left alone. The
 * webhook gets calls in faster; this is what makes the log complete.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!talkrouteConfigured()) return NextResponse.json({ skipped: 'TALKROUTE_API_KEY not set' });
  try {
    const db = adminClient();
    const r = await syncTalkroute(db, { sinceHours: 48, maxPages: 5 });
    let texts: Record<string, unknown> = {};
    try { texts = await syncTexts(db, { sinceHours: 48 }); } catch (e) { texts = { error: e instanceof Error ? e.message : String(e) }; }
    // Owners, due times, contact links, junk and already-returned call-backs (lib/call-routing).
    let tidy: Record<string, unknown> = {};
    try { tidy = await tidyCallLog(db); } catch (e) { tidy = { error: e instanceof Error ? e.message : String(e) }; }
    // Instant "missed call — call back now" email to the owner (lib/call-sla.ts).
    let instant: Record<string, unknown> = {};
    try { instant = await sendInstantMissedAlerts(db, { minAgeSec: 30 }); } catch (e) { instant = { error: e instanceof Error ? e.message : String(e) }; }
    // "Sorry we missed you" texts (off unless MISSED_CALL_TEXTBACK is set — lib/missed-call-text.ts).
    let textback: Record<string, unknown> = {};
    try { textback = await sendMissedCallTexts(db); } catch (e) { textback = { error: e instanceof Error ? e.message : String(e) }; }
    return NextResponse.json({ ok: true, ...r, texts, tidy, textback, instant });
  } catch (e) {
    console.error('[cron/talkroute-sync]', e);
    return dbError('cron/talkroute-sync', e);
  }
}
