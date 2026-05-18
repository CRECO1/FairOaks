import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { cookies } from 'next/headers';
import crypto from 'crypto';

function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url').substring(0, 128);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

export async function GET(req: NextRequest) {
  const user = await getCrmUser();
  if (!user) return unauthorized();

  const userId = req.nextUrl.searchParams.get('userId') ?? user.id;
  if (userId !== user.id) {
    return NextResponse.json({ error: 'Cannot initiate OAuth for another user' }, { status: 403 });
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store verifier in a short-lived cookie
  const cookieStore = await cookies();
  cookieStore.set('twitter_code_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600, // 10 minutes
    path: '/',
    sameSite: 'lax',
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TWITTER_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/twitter/callback`,
    scope: 'tweet.read tweet.write users.read offline.access',
    state: userId,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return NextResponse.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
}
