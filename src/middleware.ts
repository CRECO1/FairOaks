import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { validateCsrf } from '@/lib/csrf';

// Protected routes that require authentication (redirect to login if no user)
const protectedRoutes = ['/manage'];
const publicRoutes = ['/manage/login'];

// API routes that need session refresh / CSRF protection (return 401 instead of redirect)
const apiSessionRoutes = [
  '/api/campaigns',
  '/api/crm',
  '/api/action-plans',
  '/api/smart-lists',
  '/api/gmail',
  '/api/mls/sync',
  '/api/attom',
  '/api/calendar',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for Supabase env vars — skip if not configured
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.next();
  }

  // For API routes that need auth, validate CSRF then refresh the session cookie.
  // The route handler itself decides whether to return 401.
  const isApiSessionRoute = apiSessionRoutes.some(route => pathname.startsWith(route));
  if (isApiSessionRoute) {
    // CSRF check — rejects cross-origin state-changing requests
    const csrfError = validateCsrf(request);
    if (csrfError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
      const { supabaseResponse } = await updateSession(request);
      return supabaseResponse;
    } catch {
      return NextResponse.next();
    }
  }

  // Skip middleware for non-admin page routes
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
  const isPublicRoute = publicRoutes.some(route => pathname === route);

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Allow public routes within /manage
  if (isPublicRoute) {
    return NextResponse.next();
  }

  try {
    // Update session and get user
    const { supabaseResponse, user } = await updateSession(request);

    // If no user, redirect to login
    if (!user) {
      const loginUrl = new URL('/manage/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    return supabaseResponse;
  } catch (error) {
    console.error('Middleware auth error:', error);
    // On error, redirect to login
    const loginUrl = new URL('/manage/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
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
