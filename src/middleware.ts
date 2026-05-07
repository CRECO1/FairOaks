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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for Supabase env vars — skip if not configured
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.next();
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
      return supabaseResponse;
    } catch {
      return NextResponse.next();
    }
  }

  // Routes with session refresh only (own auth handles security — no CSRF needed)
  const isNoCsrfRoute = apiSessionNoCsrfRoutes.some(route => pathname.startsWith(route));
  if (isNoCsrfRoute) {
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
