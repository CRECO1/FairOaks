import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const ADMIN_SECRET = process.env.INTERNAL_SYNC_SECRET;

/**
 * POST /api/crm/social/clear-ratelimit?secret=xxx
 * Clears OAuth rate limit keys from Redis.
 */
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return NextResponse.json({ error: 'Redis not configured' }, { status: 500 });
  }

  const redis = new Redis({ url, token });

  let cursor = 0;
  const deleted: string[] = [];

  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: 'rl:oauth:*', count: 100 });
    cursor = Number(nextCursor);
    if (keys.length > 0) {
      await redis.del(...keys);
      deleted.push(...keys);
    }
  } while (cursor !== 0);

  return NextResponse.json({ success: true, cleared: deleted.length, keys: deleted });
}
