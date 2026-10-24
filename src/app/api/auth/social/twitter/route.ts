import { NextRequest, NextResponse } from 'next/server';
import { getCrmProfileUser, unauthorized } from '@/lib/crm-auth';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { rateLimit } from '@/lib/ratelimit';

// No built-in fallback: with the key unset the flow fails closed instead of signing state with a public constant.
function stateKey(): string {
  const k = process.env.TOKEN_ENCRYPTION_KEY;
  if (!k) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  return k;
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url').substring(0, 128);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

export async function GET(req: NextRequest) {
  const user = await getCrmProfileUser(req);
  if (!user) return unauthorized();

  const rl = await rateLimit(req, 'oauth');
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const userId = req.nextUrl.searchParams.get('userId') ?? user.id;
  if (userId !== user.id) {
    return NextResponse.json({ error: 'Cannot initiate OAuth for another user' }, { status: 403 });
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const nonce = crypto.randomBytes(32).toString('hex');

  // Store verifier + nonce in short-lived cookies
  const cookieStore = await cookies();
  cookieStore.set('twitter_code_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600, // 10 minutes
    path: '/',
    sameSite: 'lax',
  });
  cookieStore.set('twitter_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  });

  // HMAC binds userId + nonce together — swapping either one breaks the signature
  const stateHmac = crypto
    .createHmac('sha256', stateKey())
    .update(`${userId}:${nonce}`)
    .digest('hex');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TWITTER_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/twitter/callback`,
    scope: 'tweet.read tweet.write users.read offline.access',
    state: `${userId}:${nonce}:${stateHmac}`,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return NextResponse.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
}
