/**
 * Rate limiting via Upstash Redis + @upstash/ratelimit
 *
 * In development, fails OPEN if the KV env vars are not configured, so the app
 * still works locally without Redis. In production it fails CLOSED: leaving the
 * public endpoints entirely unprotected is the worse outcome, and the condition
 * is logged at error level so it surfaces immediately.
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
  // E-sign link — 120 per IP per minute. Generous on purpose: several signers
  // at one company share a NAT address, and each page view makes a handful of
  // calls. Used with failOpen, see rateLimitFailOpen below.
  esign:         { requests: 120, window: '1 m' },
} as const;

type LimiterKey = keyof typeof LIMITS;

// Lazily-initialised limiter cache
const limiters = new Map<LimiterKey, Ratelimit>();

function getLimiter(key: LimiterKey): Ratelimit | 'unavailable' | null {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
      // Error-level log in production so it surfaces in alerts/dashboards
      console.error(
        '[ratelimit] CRITICAL: KV_REST_API_URL or KV_REST_API_TOKEN not configured — ' +
        `endpoint "${key}" is now REJECTING requests (fail-closed). ` +
        'Set these environment variables in Vercel to restore service.'
      );
    }
    // Fail CLOSED in production: an unprotected public endpoint is worse than a
    // temporarily rejected submission, and this is only reachable if the KV env
    // vars go missing. Local dev still works without Redis.
    return process.env.NODE_ENV === 'production' ? 'unavailable' : null;
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
 * If KV is not configured: { success: true } in development, { success: false }
 * in production (fail-closed).
 */
export async function rateLimit(
  req: NextRequest,
  key: LimiterKey,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const limiter = getLimiter(key);
  if (limiter === 'unavailable') return { success: false, limit: 0, remaining: 0, reset: 0 }; // fail-closed in prod
  if (!limiter) return { success: true, limit: 0, remaining: 0, reset: 0 }; // dev without Redis

  const ip = getIp(req);
  const result = await limiter.limit(ip);
  return {
    success:   result.success,
    limit:     result.limit,
    remaining: result.remaining,
    reset:     result.reset,
  };
}

/**
 * Rate limit that lets traffic through when the limiter itself is unavailable.
 *
 * rateLimit() fails CLOSED, which is right for a lead form: if Redis is down,
 * dropping submissions beats letting someone flood the database. It is the
 * wrong trade for the e-sign link. That endpoint is reached by external
 * counterparties signing a contract, its tokens are 128-bit and not guessable,
 * and the realistic threat is noise rather than compromise. Failing closed
 * there would mean a Redis hiccup stops people signing — a worse outcome than
 * the abuse the limit is meant to deter.
 *
 * So this is deliberately weaker than rateLimit() and must not be used for
 * anything that writes on behalf of an unauthenticated caller.
 */
export async function rateLimitFailOpen(
  req: NextRequest,
  key: LimiterKey,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  try {
    const limiter = getLimiter(key);
    if (limiter === 'unavailable' || !limiter) {
      return { success: true, limit: 0, remaining: 0, reset: 0 };   // let it through
    }
    const result = await limiter.limit(getIp(req));
    return { success: result.success, limit: result.limit, remaining: result.remaining, reset: result.reset };
  } catch (e) {
    console.error(`[ratelimit] ${key} check failed, allowing through:`, e);
    return { success: true, limit: 0, remaining: 0, reset: 0 };
  }
}
