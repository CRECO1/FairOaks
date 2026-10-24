import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rateLimit } from '@/lib/ratelimit';
import { getCrmProfileUser, unauthorized } from '@/lib/crm-auth';
import { signOAuthState } from '@/lib/oauth-state';

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, 'oauth');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  // Logged-in CRM user, connecting to their own profile only (see facebook/route.ts).
  const user = await getCrmProfileUser(req);
  if (!user) return unauthorized();
  const requested = req.nextUrl.searchParams.get('userId');
  if (requested && requested !== user.id) return NextResponse.json({ error: 'Cannot connect an account for another user' }, { status: 403 });
  const { state, nonce } = signOAuthState({ uid: user.id, popup: req.nextUrl.searchParams.get('popup') === '1' });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/youtube/callback`,
    scope: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  (await cookies()).set('yt_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
