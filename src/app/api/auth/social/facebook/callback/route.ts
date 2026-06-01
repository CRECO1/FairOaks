import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { encryptToken } from '@/lib/token-crypto';

const CRM_RETURN = 'https://www.fairoaksrealtygroup.com/crm/residential#social';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  console.log('[facebook/callback] start', { error, hasCode: !!code, hasState: !!stateParam });

  if (error || !code || !stateParam) {
    console.error('[facebook/callback] OAuth denied or missing params:', { error, hasCode: !!code, hasState: !!stateParam });
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=facebook&reason=oauth_denied`);
  }

  const [userId, stateNonce] = (stateParam ?? '').split(':');
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get('fb_oauth_nonce')?.value;

  console.log('[facebook/callback] nonce check', { userId, hasStoredNonce: !!storedNonce, nonceMatch: storedNonce === stateNonce });

  if (!storedNonce || storedNonce !== stateNonce) {
    console.error('[facebook/callback] Nonce mismatch — stored:', storedNonce?.slice(0,8), 'received:', stateNonce?.slice(0,8));
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=facebook&reason=invalid_state`);
  }
  cookieStore.delete('fb_oauth_nonce');

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

  console.log('[facebook/callback] profile lookup', { userId, found: !!profile });

  if (!profile) {
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=facebook&reason=invalid_user`);
  }

  // Exchange code for short-lived token
  const tokenRes = await fetch('https://graph.facebook.com/v18.0/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID!,
      client_secret: process.env.FACEBOOK_APP_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/facebook/callback`,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  console.log('[facebook/callback] token exchange', { success: !!tokenData.access_token, error: tokenData.error });

  if (!tokenData.access_token) {
    console.error('[facebook/callback] Token exchange failed:', tokenData);
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=facebook&reason=token_exchange`);
  }

  // Exchange for long-lived user token
  const longLivedRes = await fetch(
    `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
  );
  const longLivedData = await longLivedRes.json();
  const userToken = longLivedData.access_token || tokenData.access_token;

  // Get pages managed by this user
  const pagesRes = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?access_token=${userToken}`
  );
  const pagesData = await pagesRes.json();
  const pages: Array<{ id: string; name: string; access_token: string }> = pagesData.data ?? [];

  console.log('[facebook/callback] pages found:', pages.length, pages.map(p => p.name));

  if (pages.length === 0) {
    console.error('[facebook/callback] No pages found. pagesData:', JSON.stringify(pagesData));
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=facebook&reason=no_pages`);
  }

  const now = new Date().toISOString();
  let connectedCount = 0;

  for (const page of pages) {
    const { error: upsertError } = await supabase
      .from('social_connections')
      .upsert(
        {
          agent_id: userId,
          platform: 'facebook',
          platform_account_id: page.id,
          account_name: page.name,
          access_token: encryptToken(page.access_token),
          page_id: page.id,
          is_active: true,
          updated_at: now,
        },
        { onConflict: 'agent_id,platform,platform_account_id' }
      );

    console.log('[facebook/callback] upsert facebook page', page.name, { error: upsertError });
    connectedCount++;

    // Check for linked Instagram business account
    const igRes = await fetch(
      `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
    );
    const igData = await igRes.json();
    const igAccountId = igData.instagram_business_account?.id;

    console.log('[facebook/callback] instagram linked to page', page.name, { igAccountId });

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
            platform: 'instagram',
            platform_account_id: igAccountId,
            account_name: igInfo.username || igInfo.name || `IG: ${page.name}`,
            access_token: encryptToken(page.access_token),
            page_id: page.id,
            is_active: true,
            updated_at: now,
          },
          { onConflict: 'agent_id,platform,platform_account_id' }
        );

      console.log('[facebook/callback] upsert instagram', igInfo.username, { error: igUpsertError });
      connectedCount++;
    }
  }

  console.log('[facebook/callback] done, connectedCount:', connectedCount);
  return NextResponse.redirect(`${CRM_RETURN}?social=connected&platform=facebook&count=${connectedCount}`);
}
