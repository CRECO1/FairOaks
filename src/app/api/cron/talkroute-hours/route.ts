import { NextRequest, NextResponse } from 'next/server';
import { clearHoursOverride, getHoursOverride, isBusinessOpen, setHoursOverride, talkrouteConfigured } from '@/lib/talkroute';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/talkroute-hours — hourly (vercel.json).
 *
 * Talkroute's Basic plan doesn't include Hours of Operation or forwarding schedules,
 * but it does have the open/closed override. Outside business hours (Mon–Sat
 * 8:00–18:00 Central) we set the override to "closed → the bot's ring group"; inside
 * them we clear it so calls ring the team first. Idempotent; safe to run every hour.
 */
const BOT_RING_GROUP = process.env.TALKROUTE_BOT_RING_GROUP || '74980a59-5009-4531-bdd2-d4e05877cf08';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!talkrouteConfigured()) return NextResponse.json({ skipped: 'TALKROUTE_API_KEY not set' });
  try {
    const open = isBusinessOpen();
    const before = await getHoursOverride();
    if (open) { if (before?.status === 'closed') await clearHoursOverride(); }
    else if (before?.status !== 'closed' || String(before?.destination?.id) !== BOT_RING_GROUP) await setHoursOverride('closed', { type: 'ring_group', id: BOT_RING_GROUP });
    return NextResponse.json({ ok: true, open, before, after: await getHoursOverride() });
  } catch (e) {
    console.error('[cron/talkroute-hours]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
