/**
 * Per-USER sliding-window rate limit (Upstash Redis), for signed-in routes that send mail or spend money.
 * src/lib/ratelimit.ts keys on client IP with a fixed table of budgets; this keys on an arbitrary id
 * (the caller's user id) so one agent can't burn the brand's sending reputation from many IPs.
 *
 * Same posture as ratelimit.ts: dev without Redis is allowed through, production without Redis is
 * rejected (fail closed) and logged at error level.
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const cache = new Map<string, Ratelimit>();

export async function userRateLimit(
  name: string,
  userId: string,
  requests: number,
  window: `${number} ${'s' | 'm' | 'h' | 'd'}`,
): Promise<{ success: boolean }> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[user-ratelimit] CRITICAL: KV not configured — "${name}" is REJECTING requests (fail-closed).`);
      return { success: false };
    }
    return { success: true };
  }
  const key = `${name}:${requests}:${window}`;
  let limiter = cache.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN }),
      limiter: Ratelimit.slidingWindow(requests, window),
      prefix: `rl:user:${name}`,
    });
    cache.set(key, limiter);
  }
  const r = await limiter.limit(userId);
  return { success: r.success };
}
