import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CRM_RETURN = 'https://www.fairoaksrealtygroup.com/crm/residential#social';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state'); // userId
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code || !state) {
    console.error('[youtube/callback] OAuth error:', { error, code: !!code, state });
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=youtube&reason=oauth_denied`);
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
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=youtube&reason=invalid_user`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/social/youtube/callback`,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error('[youtube/callback] Token exchange failed:', tokenData);
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=youtube&reason=token_exchange`);
  }

  // Get YouTube channel info
  const channelRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );
  const channelData = await channelRes.json();
  const channel = channelData.items?.[0];

  if (!channel) {
    console.error('[youtube/callback] No YouTube channel found:', channelData);
    return NextResponse.redirect(`${CRM_RETURN}?social=error&platform=youtube&reason=no_channel`);
  }

  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
  const now = new Date().toISOString();

  await supabase
    .from('social_connections')
    .upsert(
      {
        agent_id: state,
        platform: 'youtube',
        platform_account_id: channel.id,
        account_name: channel.snippet?.title || channel.id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt,
        is_active: true,
        updated_at: now,
      },
      { onConflict: 'agent_id,platform,platform_account_id' }
    );

  console.log(`[youtube/callback] Connected YouTube channel "${channel.snippet?.title}" for user ${state}`);

  return NextResponse.redirect(`${CRM_RETURN}?social=connected&platform=youtube`);
}
