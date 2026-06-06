import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { encryptToken } from '@/lib/token-crypto';

const CRM_BASE = 'https://crm.vultstack.com/crm/residential';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL!;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  const stateParts = (stateParam ?? '').split(':');
  const userId = stateParts[0];
  const stateNonce = stateParts[1];
  const isPopup = stateParts[2] === 'popup';

  const done = (qs: string) =>
    isPopup
      ? NextResponse.redirect(`${BASE_URL}/api/auth/social/done?${qs}`)
      : NextResponse.redirect(`${CRM_BASE}?${qs}`);

  if (error || !code || !stateParam) {
    console.error('[facebook/callback] OAuth denied or missing params:', {
      error,
      hasCode: !!code,
      hasState: !!stateParam,
    });
    const fbError = encodeURIComponent(error ?? (!code ? 'no_code' : 'no_state'));
    return done(`social=error&platform=facebook&reason=oauth_denied&fb_error=${fbError}`);
  }

  const cookieStore = await cookies();
  const storedNonce = cookieStore.get('fb_oauth_nonce')?.value;

  if (!storedNonce || storedNonce !== stateNonce) {
    console.error('[facebook/callback] Nonce mismatch');
    return done('social=error&platform=facebook&reason=invalid_state');
  }
  cookieStore.delete('fb_oauth_nonce');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: profile } = await supabase
    .from('crm_profiles')
    .select('id, org_id')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) {
    return done('social=error&platform=facebook&reason=invalid_user');
  }

  // Exchange code for short-lived token
  const tokenRes = await fetch('https://graph.facebook.com/v18.0/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID!,
      client_secret: process.env.FACEBOOK_APP_SECRET!,
      redirect_uri: `${BASE_URL}/api/auth/social/facebook/callback`,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error('[facebook/callback] Token exchange failed:', tokenData.error);
    return done('social=error&platform=facebook&reason=token_exchange');
  }

  // Exchange for long-lived user token (~60 days) — POST keeps secret out of URLs/logs
  const longLivedRes = await fetch('https://graph.facebook.com/v18.0/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: process.env.FACEBOOK_APP_ID!,
      client_secret: process.env.FACEBOOK_APP_SECRET!,
      fb_exchange_token: tokenData.access_token,
    }),
  });
  const longLivedData = await longLivedRes.json();
  const userToken = longLivedData.access_token || tokenData.access_token;
  const userTokenExpiresAt = new Date(
    Date.now() + ((longLivedData.expires_in ?? 5_184_000) * 1000)
  ).toISOString();

  // Get pages managed by this user — include instagram_business_account in the same call
  const pagesRes = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${userToken}`
  );
  const pagesData = await pagesRes.json();
  const pages: Array<{
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: { id: string };
  }> = pagesData.data ?? [];

  if (pages.length === 0) {
    console.error('[facebook/callback] No pages found');
    return done('social=error&platform=facebook&reason=no_pages');
  }

  const now = new Date().toISOString();
  let connectedCount = 0;

  for (const page of pages) {
    const { error: upsertError } = await supabase
      .from('social_connections')
      .upsert(
        {
          agent_id: userId,
          org_id: profile.org_id,
          platform: 'facebook',
          platform_account_id: page.id,
          account_name: page.name,
          access_token: encryptToken(page.access_token),
          refresh_token: encryptToken(userToken),
          expires_at: null,
          page_id: page.id,
          is_active: true,
          updated_at: now,
        },
        { onConflict: 'agent_id,platform,platform_account_id' }
      );

    if (upsertError) console.error('[facebook/callback] upsert facebook page error:', upsertError);
    connectedCount++;

    // Attempt 1: instagram_business_account inline from /me/accounts (user token)
    let igAccountId = page.instagram_business_account?.id;

    // Attempt 2: connected_instagram_account field (page token)
    if (!igAccountId) {
      const r2 = await fetch(
        `https://graph.facebook.com/v18.0/${page.id}?fields=connected_instagram_account&access_token=${page.access_token}`
      );
      const d2 = await r2.json();
      igAccountId = d2.connected_instagram_account?.id;
    }

    // Attempt 3: /page/instagram_accounts edge (page token)
    if (!igAccountId) {
      const r3 = await fetch(
        `https://graph.facebook.com/v18.0/${page.id}/instagram_accounts?access_token=${page.access_token}`
      );
      const d3 = await r3.json();
      igAccountId = d3.data?.[0]?.id;
    }

    // Attempt 4: /me?fields=instagram_business_accounts (user token)
    if (!igAccountId) {
      const r4 = await fetch(
        `https://graph.facebook.com/v18.0/me?fields=instagram_business_accounts&access_token=${userToken}`
      );
      const d4 = await r4.json();
      igAccountId = d4.instagram_business_accounts?.data?.[0]?.id;
    }

    // Skip PBIA — when no real IG account is linked, Facebook returns the page ID itself
    if (igAccountId && igAccountId === page.id) igAccountId = undefined;

    if (igAccountId) {
      const igInfoRes = await fetch(
        `https://graph.facebook.com/v18.0/${igAccountId}?fields=name,username&access_token=${page.access_token}`
      );
      const igInfo = await igInfoRes.json();

      const { error: igUpsertError } = await supabase
        .from('social_connections')
        .upsert(
          {
            agent_id: userId,
            org_id: profile.org_id,
            platform: 'instagram',
            platform_account_id: igAccountId,
            account_name: igInfo.username || igInfo.name || `IG: ${page.name}`,
            access_token: encryptToken(page.access_token),
            refresh_token: encryptToken(userToken),
            expires_at: userTokenExpiresAt,
            page_id: page.id,
            is_active: true,
            updated_at: now,
          },
          { onConflict: 'agent_id,platform,platform_account_id' }
        );

      if (igUpsertError) console.error('[facebook/callback] upsert instagram error:', igUpsertError);
      connectedCount++;
    }
  }

  return done(`social=connected&platform=facebook&count=${connectedCount}`);
}
