import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { validateCsrf } from '@/lib/csrf';

// Protected routes that require authentication (redirect to login if no user)
const protectedRoutes = ['/manage'];
const publicRoutes = ['/manage/login'];

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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://www.googletagmanager.com https://www.google-analytics.com https://ssl.google-analytics.com https://www.clarity.ms https://www.recaptcha.net https://recaptcha.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https: http:",
      "connect-src 'self' https://*.supabase.co https://api.resend.com https://api-sabor.connectmls.com https://maps.googleapis.com https://vitals.vercel-insights.com https://www.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net https://www.googletagmanager.com https://*.clarity.ms",
      "frame-src 'self' https://www.google.com https://recaptcha.google.com https://www.recaptcha.net",
      "worker-src 'self' blob:",
    ].join('; ')
  );
  return res;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for Supabase env vars — skip if not configured
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Routes with session refresh + CSRF
  const isApiSessionRoute = apiSessionRoutes.some(route => pathname.startsWith(route));
  if (isApiSessionRoute) {
    const csrfError = validateCsrf(request);
    if (csrfError) {
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

  // Skip middleware for non-admin page routes
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
  const isPublicRoute = publicRoutes.some(route => pathname === route);

  if (!isProtectedRoute) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Allow public routes within /manage
  if (isPublicRoute) {
    return withSecurityHeaders(NextResponse.next());
  }

  try {
    // Update session and get user
    const { supabaseResponse, user } = await updateSession(request);

    // If no user, redirect to login
    if (!user) {
      const loginUrl = new URL('/manage/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return withSecurityHeaders(NextResponse.redirect(loginUrl));
    }

    return withSecurityHeaders(supabaseResponse);
  } catch (error) {
    console.error('Middleware auth error:', error);
    // On error, redirect to login
    const loginUrl = new URL('/manage/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }
}

export const config = {
  matcher: [
    // Match all admin page routes
    '/manage/:path*',
    // Match API routes that require session refresh + CSRF protection
    '/api/campaigns/:path*',
    '/api/campaigns',
    '/api/crm/:path*',
    '/api/action-plans/:path*',
    '/api/smart-lists',
    '/api/gmail/:path*',
    '/api/mls/sync',
    '/api/attom',
    '/api/calendar/:path*',
  ],
};
