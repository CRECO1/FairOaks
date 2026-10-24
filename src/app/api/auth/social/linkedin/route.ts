import { NextRequest, NextResponse } from 'next/server';
import { getCrmProfileUser, unauthorized } from '@/lib/crm-auth';
import { signOAuthState } from '@/lib/oauth-state';
import { cookies } from 'next/headers';
import { rateLimit } from '@/lib/ratelimit';

export async function GET(req: NextRequest) {
  const user = await getCrmProfileUser(req);
  if (!user) return unauthorized();

  const rl = await rateLimit(req, 'oauth');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const userId = req.nextUrl.searchParams.get('userId') ?? user.id;
  if (userId !== user.id) {
    return NextResponse.json({ error: 'Cannot initiate OAuth for another user' }, { status: 403 });
  }

  const { state, nonce } = signOAuthState({ uid: userId });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/linkedin/callback`,
    scope: 'r_liteprofile r_emailaddress w_member_social r_organization_social w_organization_social',
    state,
  });

  (await cookies()).set('li_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  });

  return NextResponse.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
}
