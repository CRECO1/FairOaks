import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const CRM_RETURN = 'https://www.fairoaksrealtygroup.com/crm/residential#social';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state'); // userId
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code || !state) {
    console.error('[twitter/callback] OAuth error:', { error, code: !!code, state });
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=twitter&reason=oauth_denied`);
  }

  // Retrieve code verifier from cookie
  const cookieStore = await cookies();
  const codeVerifier = cookieStore.get('twitter_code_verifier')?.value;

  if (!codeVerifier) {
    console.error('[twitter/callback] Missing code verifier cookie');
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=twitter&reason=missing_verifier`);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify user exists
  const { data: profile } = await supabase
    .from('crm_profiles')
    .select('id')
    .eq('id', state)
    .maybeSingle();

  if (!profile) {
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=twitter&reason=invalid_user`);
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
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=twitter&reason=token_exchange`);
  }

  // Get Twitter user info
  const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=name,username,profile_image_url', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData = await userRes.json();
  const twitterUser = userData.data;

  if (!twitterUser?.id) {
    console.error('[twitter/callback] Failed to fetch Twitter user:', userData);
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=twitter&reason=profile_fetch`);
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;
  const now = new Date().toISOString();

  await supabase
    .from('social_connections')
    .upsert(
      {
        agent_id: state,
        platform: 'twitter',
        platform_account_id: twitterUser.id,
        account_name: `@${twitterUser.username}`,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt,
        is_active: true,
        updated_at: now,
      },
      { onConflict: 'agent_id,platform,platform_account_id' }
    );

  // Clear verifier cookie
  cookieStore.delete('twitter_code_verifier');

  console.log(`[twitter/callback] Connected Twitter @${twitterUser.username} for user ${state}`);

  return NextResponse.redirect(`${CRM_RETURN}?social=connected&platform=twitter`);
}
