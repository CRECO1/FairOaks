import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { encryptToken } from '@/lib/token-crypto';
import crypto from 'crypto';

const CRM_BASE = 'https://www.fairoaksrealtygroup.com/crm/residential';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state'); // userId:nonce
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code || !stateParam) {
    console.error('[twitter/callback] OAuth error:', { error, code: !!code, stateParam });
    return NextResponse.redirect(`${CRM_BASE}?social=error&platform=twitter&reason=oauth_denied`);
  }

  const parts = (stateParam ?? '').split(':');
  const userId = parts[0];
  const stateNonce = parts[1];
  const stateHmac = parts[2];

  // Retrieve code verifier + CSRF nonce from cookies
  const cookieStore = await cookies();
  const codeVerifier = cookieStore.get('twitter_code_verifier')?.value;
  const storedNonce = cookieStore.get('twitter_oauth_nonce')?.value;

  if (!codeVerifier) {
    console.error('[twitter/callback] Missing code verifier cookie');
    return NextResponse.redirect(`${CRM_BASE}?social=error&platform=twitter&reason=missing_verifier`);
  }

  // 1. Validate CSRF nonce (proves this browser started the flow)
  if (!storedNonce || storedNonce !== stateNonce) {
    console.error('[twitter/callback] CSRF nonce mismatch');
    return NextResponse.redirect(`${CRM_BASE}?social=error&platform=twitter&reason=invalid_state`);
  }

  // 2. Validate HMAC (proves userId wasn't tampered with after nonce issuance)
  const expectedHmac = crypto
    .createHmac('sha256', process.env.TOKEN_ENCRYPTION_KEY ?? 'dev-fallback-key')
    .update(`${userId}:${stateNonce}`)
    .digest('hex');
  const hmacValid = stateHmac?.length === expectedHmac.length &&
    crypto.timingSafeEqual(Buffer.from(stateHmac, 'hex'), Buffer.from(expectedHmac, 'hex'));
  if (!hmacValid) {
    console.error('[twitter/callback] State HMAC invalid — possible userId tampering');
    return NextResponse.redirect(`${CRM_BASE}?social=error&platform=twitter&reason=invalid_state`);
  }

  cookieStore.delete('twitter_oauth_nonce');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify user exists
  const { data: profile } = await supabase
    .from('crm_profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) {
    return NextResponse.redirect(`${CRM_BASE}?social=error&platform=twitter&reason=invalid_user`);
  }

  // Exchange code + verifier for tokens
  const credentials = Buffer.from(
    `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
  ).toString('base64');

  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/twitter/callback`,
      code_verifier: codeVerifier,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error('[twitter/callback] Token exchange failed:', tokenData);
    return NextResponse.redirect(`${CRM_BASE}?social=error&platform=twitter&reason=token_exchange`);
  }

  // Get Twitter user info
  const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=name,username,profile_image_url', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData = await userRes.json();
  const twitterUser = userData.data;

  if (!twitterUser?.id) {
    console.error('[twitter/callback] Failed to fetch Twitter user:', userData);
    return NextResponse.redirect(`${CRM_BASE}?social=error&platform=twitter&reason=profile_fetch`);
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;
  const now = new Date().toISOString();

  await supabase
    .from('social_connections')
    .upsert(
      {
        agent_id: userId,
        platform: 'twitter',
        platform_account_id: twitterUser.id,
        account_name: `@${twitterUser.username}`,
        access_token: encryptToken(tokenData.access_token),
        refresh_token: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
        expires_at: expiresAt,
        is_active: true,
        updated_at: now,
      },
      { onConflict: 'agent_id,platform,platform_account_id' }
    );

  // Clear verifier cookie
  cookieStore.delete('twitter_code_verifier');

  return NextResponse.redirect(`${CRM_BASE}?social=connected&platform=twitter`);
}
