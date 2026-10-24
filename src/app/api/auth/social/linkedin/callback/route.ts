import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getCrmProfileUser } from '@/lib/crm-auth';
import { nonceMatches, verifyOAuthState } from '@/lib/oauth-state';
import { encryptToken } from '@/lib/token-crypto';
import { safeJson } from '@/lib/safe-json';

const CRM_RETURN = 'https://crm.vultstack.com/crm/residential#social';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code || !stateParam) {
    console.error('[linkedin/callback] OAuth error:', { error, code: !!code, hasState: !!stateParam });
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=linkedin&reason=oauth_denied`);
  }

  // Signed, expiring state (lib/oauth-state) + the logged-in session must be the user it was minted for.
  const st = verifyOAuthState(stateParam);
  const userId = st?.uid ?? '';
  const cookieStore = await cookies();
  if (!st || !nonceMatches(st.nonce, cookieStore.get('li_oauth_nonce')?.value)) {
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=linkedin&reason=invalid_state`);
  }
  cookieStore.delete('li_oauth_nonce');
  const sessionUser = await getCrmProfileUser(req);
  if (!sessionUser || sessionUser.id !== userId) {
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=linkedin&reason=invalid_state`);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify user exists + resolve their org for tenant isolation
  const { data: profile } = await supabase
    .from('crm_profiles')
    .select('id, org_id')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) {
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=linkedin&reason=invalid_user`);
  }

  // Exchange code for access token
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/linkedin/callback`,
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });

  const tokenData = await safeJson<{ access_token?: string; expires_in?: number; refresh_token?: string }>(tokenRes, 'linkedin/callback token');
  if (!tokenData?.access_token) {
    console.error('[linkedin/callback] Token exchange failed:', tokenData);
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=linkedin&reason=token_exchange`);
  }

  // Get LinkedIn profile info
  const profileRes = await fetch('https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const liProfile = await safeJson<{ id?: string; name?: string; localizedFirstName?: string; localizedLastName?: string }>(profileRes, 'linkedin/callback profile');

  if (!liProfile?.id) {
    console.error('[linkedin/callback] Failed to fetch LinkedIn profile:', liProfile);
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=linkedin&reason=profile_fetch`);
  }

  const accountName = `${liProfile.localizedFirstName || ''} ${liProfile.localizedLastName || ''}`.trim() || liProfile.id;
  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 5183944) * 1000).toISOString();
  const now = new Date().toISOString();

  await supabase
    .from('social_connections')
    .upsert(
      {
        agent_id: userId,
        org_id: profile.org_id,
        platform: 'linkedin',
        platform_account_id: liProfile.id,
        account_name: accountName,
        access_token: encryptToken(tokenData.access_token),
        refresh_token: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
        expires_at: expiresAt,
        is_active: true,
        updated_at: now,
      },
      { onConflict: 'agent_id,platform,platform_account_id' }
    );

  return NextResponse.redirect(`${CRM_RETURN}?social=connected&platform=linkedin`);
}
