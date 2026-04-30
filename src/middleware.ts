import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Protected routes that require authentication
const protectedRoutes = ['/manage'];
const publicRoutes = ['/manage/login'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for non-admin routes
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
  const isPublicRoute = publicRoutes.some(route => pathname === route);

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Allow public routes within /manage
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Check for Supabase env vars
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
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
    // Match all admin routes except static files
    '/manage/:path*',
  ],
};
