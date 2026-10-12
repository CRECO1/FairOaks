import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { computeCallList } from '@/lib/engagement-calllist';
import { cachedCompute, cacheKey } from '@/lib/engagement-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The call list: everyone who engaged with a campaign (or, with no
 * campaign_id, with any campaign in the workspace over the last 90 days),
 * hottest and not-yet-contacted first. See lib/campaign-engagement.ts for what
 * counts as engagement and why opens don't.
 *
 * Email replies come from Gmail: the caller's own connected inboxes plus the
 * campaign sender's (an admin or the sender themselves only — an agent never
 * gets another agent's inbox searched for them). Only the fact and date of a
 * reply leave Gmail, never the content.
 */

// The Gmail reply search is the slow part (6–11s live) and is hit on every Marketing open and
// again from the Properties/E-Sign pages. Replies arrive on a scale of minutes, so serve the
// same answer for 2 minutes per user + scope and share one in-flight computation. `?fresh=1`
// skips the cache (the call list's own refresh uses it).
const CACHE_TTL_MS = 120_000;
const responseCache = new Map<string, { at: number; value: Promise<{ status: number; body: unknown }> }>();

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const campaignId = req.nextUrl.searchParams.get('campaign_id');
  const unitParam = req.nextUrl.searchParams.get('unit');
  // The scope the computation will actually use, so `?unit=` and the default share one entry.
  const unit = isAdminRole(ctx.role) ? (unitParam ?? ctx.businessUnit) : ctx.businessUnit;
  const key = cacheKey(ctx.userId, campaignId, unit);
  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  const hit = responseCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    const r = await hit.value;
    return NextResponse.json(r.body, { status: r.status });
  }
  // Behind the per-instance cache sits the persistent one (lib/engagement-cache.ts): a cold
  // instance answers from a stored row instead of recomputing. `?fresh=1` recomputes and
  // refreshes it — the call list asks for that in the background after painting the cached list.
  const value = cachedCompute(adminClient(), `calllist|${key}`, () => computeCallList(adminClient(), ctx, { campaignId, unit }),
    { freshMs: 3 * 60_000, staleMs: 15 * 60_000, force: fresh }, r => r.status === 200).then(r => r.value);
  responseCache.set(key, { at: Date.now(), value });
  // Never serve a failure from cache.
  value.then(r => { if (r.status >= 400 && responseCache.get(key)?.value === value) responseCache.delete(key); },
             () => { if (responseCache.get(key)?.value === value) responseCache.delete(key); });
  if (responseCache.size > 40) { const oldest = [...responseCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) responseCache.delete(oldest[0]); }
  const r = await value;
  return NextResponse.json(r.body, { status: r.status });
}
