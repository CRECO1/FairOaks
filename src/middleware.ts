import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Protected routes that require authentication (redirect to login if no user)
const protectedRoutes = ['/manage'];
const publicRoutes = ['/manage/login'];

// API routes that need session refresh but should NOT redirect (return 401 instead)
const apiSessionRoutes = ['/api/campaigns', '/api/crm'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for Supabase env vars — skip if not configured
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.next();
  }

  // For API routes that need auth, just refresh the session cookie and pass through.
  // The route handler itself decides whether to return 401.
  const isApiSessionRoute = apiSessionRoutes.some(route => pathname.startsWith(route));
  if (isApiSessionRoute) {
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
    // Match CRM/campaign API routes so the session cookie is refreshed
    '/api/campaigns/:path*',
    '/api/campaigns',
    '/api/crm/:path*',
  ],
};
