import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { rateLimit } from '@/lib/ratelimit';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, 'oauth');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  // userId is required — must belong to a real CRM profile
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  // Verify the user exists in crm_profiles (light check, no full auth required here —
  // security is enforced by the CSRF nonce verified in the callback)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: profile } = await supabase
    .from('crm_profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 403 });
  }

  const nonce = crypto.randomBytes(32).toString('hex');

  const isPopup = req.nextUrl.searchParams.get('popup') === '1';

  console.log('[facebook/auth] building redirect', {
    userId,
    appId: process.env.FACEBOOK_APP_ID,
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
    isPopup,
  });

  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/facebook/callback`,
    scope: 'pages_show_list,pages_read_engagement,pages_manage_posts',
    response_type: 'code',
    state: `${userId}:${nonce}${isPopup ? ':popup' : ''}`,
  });

  (await cookies()).set('fb_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  });

  return NextResponse.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params}`);
}
