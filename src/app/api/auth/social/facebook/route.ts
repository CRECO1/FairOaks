import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rateLimit } from '@/lib/ratelimit';
import { getCrmProfileUser, unauthorized } from '@/lib/crm-auth';
import { signOAuthState } from '@/lib/oauth-state';

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, 'oauth');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  // Only a logged-in CRM user can connect an account, and only to THEIR OWN profile. (This route used to accept any
  // ?userId= for any existing profile, so a stranger could attach their Facebook to a victim's CRM user.)
  const user = await getCrmProfileUser(req);
  if (!user) return unauthorized();
  const requested = req.nextUrl.searchParams.get('userId');
  if (requested && requested !== user.id) return NextResponse.json({ error: 'Cannot connect an account for another user' }, { status: 403 });
  const userId = user.id;

  const isPopup = req.nextUrl.searchParams.get('popup') === '1';
  const { state, nonce } = signOAuthState({ uid: userId, popup: isPopup });

  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/facebook/callback`,
    scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish',
    response_type: 'code',
    state,
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
