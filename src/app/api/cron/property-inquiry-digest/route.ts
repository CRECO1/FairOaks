import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { sendPushToProfiles } from '@/lib/push';
import { computeInquiryDigest } from '@/lib/inquiry-digest';
import { recordJobRun } from '@/lib/job-runs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/property-inquiry-digest — weekdays ~9 AM CT. One phone alert per listing agent (text built by lib/inquiry-digest.ts, which the
 * admin "Preview today's alert" button also uses). Only devices that switched on the "Property inquiries" alert get it (off by default).
 * Secured by CRON_SECRET. Every run is written to the job log.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = adminClient();
  try {
    const { listings, messages } = await computeInquiryDigest(db);
    let sent = 0;
    for (const m of messages) {
      const r = await sendPushToProfiles([m.profileId], { title: m.title, body: m.body, url: m.url, tag: 'property-inquiries', category: 'inquiries' }, { db });
      sent += r.sent;
    }
    await recordJobRun(db, 'property-inquiry-digest', true, messages.length ? `${messages.length} agent${messages.length === 1 ? '' : 's'} had new inquiries on ${listings} propert${listings === 1 ? 'y' : 'ies'}; ${sent} device alert${sent === 1 ? '' : 's'} sent` : 'No new tagged inquiries since the last run; nothing sent', { agents: messages.length, listings, sent });
    return NextResponse.json({ listings, agents: messages.length, sent });
  } catch (e) {
    await recordJobRun(db, 'property-inquiry-digest', false, `Failed: ${(e as Error).message}`.slice(0, 300));
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
