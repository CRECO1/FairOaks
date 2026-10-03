import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { validateCsrf } from '@/lib/csrf';
import { matchCrawler, logCrawlerHit } from '@/lib/crawler-hits';

// The matcher below covers every page (the crawler tracker needs to see them
// all), but session refresh, CSRF and the middleware security headers still
// apply ONLY to the routes they always covered. Everything else passes through
// untouched — public pages get their headers from next.config.js.
const sessionPrefixes = [
  '/crm', '/admin',
  '/api/campaigns', '/api/crm', '/api/action-plans', '/api/gmail', '/api/calendar',
  '/api/auth/social',
];
const sessionExact = ['/api/smart-lists', '/api/mls/sync', '/api/attom'];

function isSessionRoute(pathname: string): boolean {
  return sessionExact.includes(pathname)
    || sessionPrefixes.some(r => pathname === r || pathname.startsWith(`${r}/`));
}

// App shells that must receive the security headers / CSP below, but must NOT be
// gated here. /crm keeps its session in cookies (@supabase/ssr) while /admin
// keeps its in localStorage (plain supabase-js), which middleware cannot see —
// a redirect on a missing cookie would lock legitimately signed-in admins out.
// Both shells gate themselves client-side and, more importantly, every piece of
// data behind them comes from an authenticated API route plus RLS.
const headerOnlyRoutes = ['/crm', '/admin'];

// API routes that need session refresh + CSRF protection
const apiSessionRoutes = [
  '/api/campaigns',
  '/api/action-plans',
  '/api/smart-lists',
  '/api/gmail',
  '/api/attom',
  '/api/calendar',
];

// API routes that need session refresh but have their own auth — skip CSRF
// (CRM routes use Bearer JWT + Supabase role check; MLS sync uses internal key)
const apiSessionNoCsrfRoutes = [
  '/api/mls/sync',
  '/api/crm',
];

// Security headers applied to every response
function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://www.googletagmanager.com https://www.google-analytics.com https://ssl.google-analytics.com https://*.clarity.ms https://www.recaptcha.net https://recaptcha.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https: http:",
      "connect-src 'self' https://*.supabase.co https://api.resend.com https://api-sabor.connectmls.com https://maps.googleapis.com https://vitals.vercel-insights.com https://www.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net https://www.googletagmanager.com https://*.clarity.ms https://graph.facebook.com https://api.linkedin.com https://api.twitter.com https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com",
      "frame-src 'self' https://www.google.com https://recaptcha.google.com https://www.recaptcha.net",
      "worker-src 'self' blob:",
    ].join('; ')
  );
  return res;
}

// ─── Expired listings → 410 Gone ─────────────────────────────────────────────
// SABOR's IDX feed drops a listing entirely once it sells, expires or is
// withdrawn, so its /listings/<address>-<ListingId> URL can never resolve again.
// Answer 410 (not a 404, not a redirect): it tells Google/Bing/AI crawlers the
// page is permanently gone so they drop it fastest, and stops them re-crawling
// it hundreds of times a day. Visitors still get the "no longer on the market"
// page with active alternatives (the body of /listing-unavailable).
const LISTING_PATH = /^\/listings\/([^/]+)$/;

// Security headers next.config.js sets on the page — carried onto the 410.
const COPIED_HEADERS = [
  'content-security-policy', 'x-frame-options', 'x-content-type-options',
  'referrer-policy', 'permissions-policy', 'strict-transport-security',
];

const GONE_FALLBACK_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Listing No Longer Available | Fair Oaks Realty Group</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1>This listing is no longer on the market</h1><p>It has sold or been taken off the market.</p><p><a href="/listings">Browse active listings</a></p></body></html>';

async function goneListingResponse(request: NextRequest): Promise<NextResponse | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const match = request.nextUrl.pathname.match(LISTING_PATH);
  if (!match) return null;

  // Same parse as listings/[slug]/page.tsx. A slug without a ListingId (old
  // pre-IDX URLs like /listings/modern-farmhouse-retreat) can never resolve.
  const listingId = match[1].match(/-(\d{5,})$/)?.[1];
  if (listingId) {
    try {
      const res = await fetch(new URL(`/api/listings/exists?id=${listingId}`, request.url), {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return null;                 // lookup failed — let the page decide
      const { exists } = await res.json() as { exists?: boolean };
      if (exists !== false) return null;        // live listing, or an unclear answer
    } catch {
      return null;
    }
  }

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'X-Robots-Tag': 'noindex',
  });
  let body = GONE_FALLBACK_HTML;
  try {
    const page = await fetch(new URL('/listing-unavailable', request.url), {
      signal: AbortSignal.timeout(4000),
    });
    if (page.ok) {
      body = await page.text();
      for (const h of COPIED_HEADERS) {
        const v = page.headers.get(h);
        if (v) headers.set(h, v);
      }
    }
  } catch {
    // fall back to the minimal page — still a 410
  }
  return new NextResponse(body, { status: 410, headers });
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const res = await handle(request);

  const bot = matchCrawler(request.headers.get('user-agent'));
  if (bot) {
    // Pass-through responses are rendered by the app after middleware, so their
    // status isn't known here; record it only when middleware answered itself.
    const passedThrough = res.headers.has('x-middleware-next') || res.headers.has('x-middleware-rewrite');
    event.waitUntil(logCrawlerHit({
      bot_name: bot,
      path: request.nextUrl.pathname,            // no query string: keeps tokens/emails out
      status: passedThrough ? null : res.status,
      user_agent: request.headers.get('user-agent') ?? '',
      host: request.headers.get('host'),
    }));
  }
  return res;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const gone = await goneListingResponse(request);
  if (gone) return gone;

  if (!isSessionRoute(pathname)) return NextResponse.next();

  // Check for Supabase env vars — skip if not configured
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Routes with session refresh + CSRF
  const isApiSessionRoute = apiSessionRoutes.some(route => pathname.startsWith(route));
  if (isApiSessionRoute) {
    const csrfResult = validateCsrf(request);
    if (csrfResult) {
      // If it's a NextResponse (e.g. fail-closed 403), return it directly; otherwise generic 403
      if (csrfResult instanceof NextResponse) return csrfResult;
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const { supabaseResponse } = await updateSession(request);
      return withSecurityHeaders(supabaseResponse);
    } catch {
      return withSecurityHeaders(NextResponse.next());
    }
  }

  // Routes with session refresh only (own auth handles security — no CSRF needed)
  const isNoCsrfRoute = apiSessionNoCsrfRoutes.some(route => pathname.startsWith(route));
  if (isNoCsrfRoute) {
    try {
      const { supabaseResponse } = await updateSession(request);
      return withSecurityHeaders(supabaseResponse);
    } catch {
      return withSecurityHeaders(NextResponse.next());
    }
  }

  // App shells: security headers only, never an auth redirect (see above).
  if (headerOnlyRoutes.some(route => pathname.startsWith(route))) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Everything else: security headers only.
  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    // Everything except build assets and static media. Text/XML files stay in
    // (robots.txt, sitemap.xml, llms.txt) — those are what crawlers fetch.
    '/((?!_next/static|_next/image|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|woff2?|ttf|otf|mp4|webm)$).*)',
  ],
};
