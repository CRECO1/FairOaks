import type { NextRequest } from 'next/server';

// Methods that mutate state — these require CSRF validation
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Returns the set of allowed origins for CSRF checks.
 * Includes the configured server URL + localhost variants for development.
 */
function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>();

  // Helper: add both www and non-www variants of a URL
  function addWithVariants(url: string) {
    const base = url.replace(/\/$/, '');
    origins.add(base);
    // Add www variant if missing, and non-www if present
    if (base.includes('://www.')) {
      origins.add(base.replace('://www.', '://'));
    } else {
      const [scheme, rest] = base.split('://');
      origins.add(`${scheme}://www.${rest}`);
    }
  }

  // Production / staging URL (e.g. https://fairoaksrealtygroup.com)
  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    addWithVariants(process.env.NEXT_PUBLIC_SERVER_URL);
  }

  // Vercel preview / deployment URLs
  if (process.env.VERCEL_URL) {
    origins.add(`https://${process.env.VERCEL_URL}`);
  }
  if (process.env.VERCEL_BRANCH_URL) {
    origins.add(`https://${process.env.VERCEL_BRANCH_URL}`);
  }

  // Local development
  origins.add('http://localhost:3000');
  origins.add('https://localhost:3000');
  origins.add('http://localhost');
  origins.add('https://localhost');

  return origins;
}

/**
 * Validate the Origin (or Referer fallback) on state-changing API requests.
 *
 * Returns `null` when the request is safe to proceed.
 * Returns an error string when the request should be rejected.
 *
 * Exemptions (pass through without origin check):
 *  - Read-only methods (GET, HEAD, OPTIONS)
 *  - Requests that carry an Authorization: Bearer token — these are
 *    server-to-server calls (webhooks, cron jobs) that legitimately
 *    have no browser Origin.
 */
export function validateCsrf(req: NextRequest): string | null {
  if (!MUTATING_METHODS.has(req.method)) return null;

  // Server-to-server: Bearer token present → skip CSRF (verified by the route handler)
  const authorization = req.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) return null;

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // Derive the candidate origin from the Referer as a fallback
  let candidate = origin;
  if (!candidate && referer) {
    try {
      const u = new URL(referer);
      candidate = u.origin; // e.g. "https://www.fairoaksrealtygroup.com"
    } catch {
      // malformed Referer — treat as missing
    }
  }

  // If neither Origin nor Referer is present the request is either:
  //  (a) a same-origin server action (Next.js server actions send no origin in some setups)
  //  (b) a curl/tool request without auth
  // We allow it through — the auth layer (Supabase session / Bearer) is the real gate.
  if (!candidate) return null;

  const allowed = getAllowedOrigins();
  if (!allowed.has(candidate)) {
    return `CSRF: origin '${candidate}' is not allowed`;
  }

  return null;
}
