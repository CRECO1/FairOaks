import { NextRequest, NextResponse } from 'next/server';
import { getNumberDestination, isBusinessOpen, setNumberDestination, talkrouteConfigured } from '@/lib/talkroute';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/talkroute-hours — hourly (vercel.json).
 *
 * Talkroute's Basic plan gates Hours of Operation, forwarding schedules AND the
 * open/closed override, but re-pointing a number is an ordinary setting. So outside
 * business hours (Mon–Sat 8:00–18:00 Central) each Talkroute number sends calls
 * straight to the bot's ring group; inside them, back to its team ring group.
 * Idempotent; safe to run every hour.
 */
const BOT_RING_GROUP = process.env.TALKROUTE_BOT_RING_GROUP || '74980a59-5009-4531-bdd2-d4e05877cf08';
// Talkroute number id → the team ring group it uses during business hours.
const NUMBERS: Array<{ id: string; label: string; team: string }> = [
  { id: '105036', label: 'CRECO 210-817-3443', team: 'c24dc035-b8d0-11ee-9d13-246e96bdfb98' },
  { id: '142802', label: 'Fair Oaks 210-390-9997', team: '5063974a-381b-11f1-b25d-246e96bdfb98' },
];

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!talkrouteConfigured()) return NextResponse.json({ skipped: 'TALKROUTE_API_KEY not set' });
  const open = isBusinessOpen();
  const results: Record<string, unknown> = {};
  for (const n of NUMBERS) {
    try {
      const want = { type: 'ring_group' as const, id: open ? n.team : BOT_RING_GROUP };
      const before = await getNumberDestination(n.id);
      const same = before?.type === want.type && String(before?.id) === String(want.id);
      results[n.label] = same ? { unchanged: want.id === BOT_RING_GROUP ? 'bot' : 'team' } : { changed_to: want.id === BOT_RING_GROUP ? 'bot' : 'team', after: await setNumberDestination(n.id, want) };
    } catch (e) { results[n.label] = { error: e instanceof Error ? e.message : String(e) }; }
  }
  return NextResponse.json({ ok: true, open, results });
}
