/**
 * AI / search crawler tracker — edge-safe (runs inside middleware).
 *
 * Every request whose user-agent matches one of the bots below gets ONE row in
 * public.crawler_hits (schema: supabase/crawler-hits.sql). Human traffic is never
 * written. The insert is a bare PostgREST fetch handed to event.waitUntil(), so
 * it never delays or breaks the page response; failures are swallowed.
 *
 * How to read the data: docs/crawler-tracker.md.
 */

// First match wins. The tokens don't overlap (Claude-User vs ClaudeBot,
// Perplexity-User vs PerplexityBot are distinct strings), so order is cosmetic.
const BOTS: ReadonlyArray<readonly [name: string, pattern: RegExp]> = [
  ['GPTBot', /GPTBot/i],
  ['OAI-SearchBot', /OAI-SearchBot/i],
  ['ChatGPT-User', /ChatGPT-User/i],
  ['ClaudeBot', /ClaudeBot/i],
  ['Claude-User', /Claude-User/i],
  ['PerplexityBot', /PerplexityBot/i],
  ['Perplexity-User', /Perplexity-User/i],
  ['Googlebot', /Googlebot/i],
  ['Bingbot', /bingbot/i],
  ['Applebot', /Applebot/i],
  ['Amazonbot', /Amazonbot/i],
  ['Meta-ExternalAgent', /meta-externalagent/i],
  ['CCBot', /CCBot/i],
  ['Bytespider', /Bytespider/i],
];

/** Canonical bot name for a user-agent, or null for anything we don't track. */
export function matchCrawler(ua: string | null): string | null {
  if (!ua) return null;
  for (const [name, re] of BOTS) if (re.test(ua)) return name;
  return null;
}

export interface CrawlerHit {
  bot_name: string;
  path: string;
  /** Final status when middleware decided it (e.g. 410); null when the app rendered it. */
  status: number | null;
  user_agent: string;
  host: string | null;
}

/** Fire-and-forget insert. Resolves (never rejects) within ~3s. */
export async function logCrawlerHit(hit: CrawlerHit): Promise<void> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/crawler_hits`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        bot_name: hit.bot_name,
        path: hit.path.slice(0, 1024),
        status: hit.status,
        user_agent: hit.user_agent.slice(0, 512),
        host: hit.host?.slice(0, 255) ?? null,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Tracking must never affect the response.
  }
}
