/**
 * Rate limiting via Upstash Redis + @upstash/ratelimit
 *
 * Fails OPEN if KV env vars are not configured — so the app still works
 * in local dev without Redis, and a missing env var won't break production.
 *
 * Usage:
 *   const { success, limit, remaining } = await rateLimit(req, 'leads');
 *   if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest } from 'next/server';

// ─── Limiters ────────────────────────────────────────────────────────────────
// Each key defines a sliding-window budget appropriate for that endpoint.

const LIMITS = {
  // Public lead form — 5 submissions per IP per 10 minutes
  leads:       { requests: 5,  window: '10 m' },
  // Unsubscribe — 10 per IP per hour (someone clicking multiple links)
  unsubscribe: { requests: 10, window: '1 h'  },
  // Email open pixel — 60 per IP per minute (legit email clients retry)
  track:       { requests: 60, window: '1 m'  },
  // Quiz lead — 10 per IP per 10 minutes
  quiz:        { requests: 10, window: '10 m' },
  // Webhook — 30 per IP per minute (Zapier/Make can burst)
  webhook:     { requests: 30, window: '1 m'  },
  // ATTOM property intel — paid external API, limit aggressive lookups
  attom:       { requests: 30, window: '1 m'  },
  // Agent application form — 3 per IP per hour
  'agent-apply': { requests: 3, window: '1 h' },
  // OAuth initiation — 100 per IP per hour (prevents redirect-loop abuse)
  oauth:         { requests: 100, window: '1 h' },
  // AI caption generation — 10 per IP per hour (OpenAI/Anthropic cost control)
  caption:       { requests: 10, window: '1 h' },
} as const;

type LimiterKey = keyof typeof LIMITS;

// Lazily-initialised limiter cache
const limiters = new Map<LimiterKey, Ratelimit>();

function getLimiter(key: LimiterKey): Ratelimit | null {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
      // Error-level log in production so it surfaces in alerts/dashboards
      console.error(
        '[ratelimit] CRITICAL: KV_REST_API_URL or KV_REST_API_TOKEN not configured — ' +
        `rate limiting is DISABLED for endpoint "${key}". ` +
        'Set these environment variables in Vercel to re-enable protection.'
      );
    }
    return null; // fail-open (app still works, but unprotected)
  }

  if (!limiters.has(key)) {
    const { requests, window: w } = LIMITS[key];
    const redis = new Redis({
      url:   process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    limiters.set(key, new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(requests, w),
      analytics: true,
      prefix: `rl:${key}`,
    }));
  }

  return limiters.get(key)!;
}

/** Extract the best available IP from the request */
function getIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1'
  );
}

/**
 * Check rate limit for a given endpoint key.
 * Returns { success: true } if KV is not configured (fail-open).
 */
export async function rateLimit(
  req: NextRequest,
  key: LimiterKey,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const limiter = getLimiter(key);
  if (!limiter) return { success: true, limit: 0, remaining: 0, reset: 0 }; // fail-open

  const ip = getIp(req);
  const result = await limiter.limit(ip);
  return {
    success:   result.success,
    limit:     result.limit,
    remaining: result.remaining,
    reset:     result.reset,
  };
}
