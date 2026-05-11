import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const REDIRECT_URI = `${process.env.NEXT_PUBLIC_SERVER_URL ?? 'https://www.fairoaksrealtygroup.com'}/api/gmail/callback`;
const CRM_URL = `${process.env.NEXT_PUBLIC_SERVER_URL ?? 'https://www.fairoaksrealtygroup.com'}/crm`;

export async function GET(req: NextRequest) {
  const code      = req.nextUrl.searchParams.get('code');
  const stateRaw  = req.nextUrl.searchParams.get('state');
  const error     = req.nextUrl.searchParams.get('error');

  // State may be "userId" or "userId|businessUnit"
  const [stateUserId, stateBu] = (stateRaw ?? '').split('|');
  const returnBase = stateBu ? `${CRM_URL}/${stateBu}` : CRM_URL;

  if (error || !code || !stateUserId) {
    console.error('[gmail/callback] Missing params or error:', { error, code: !!code, stateUserId });
    return NextResponse.redirect(`${returnBase}?gmail=error&reason=oauth_denied`);
  }

  // Use service-role client to validate user without relying on SSR session cookies
  // (Google redirects to this URL and the session cookie context can be unreliable)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify the stateUserId corresponds to a real CRM profile
  const { data: profile, error: profileErr } = await supabase
    .from('crm_profiles')
    .select('id')
    .eq('id', stateUserId)
    .maybeSingle();

  if (profileErr || !profile) {
    console.error('[gmail/callback] No CRM profile for userId:', stateUserId, profileErr);
    return NextResponse.redirect(`${returnBase}?gmail=error&reason=invalid_user`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();

  if (!tokenRes.ok || !tokens.access_token) {
    console.error('[gmail/callback] Token exchange failed:', tokens);
    return NextResponse.redirect(`${returnBase}?gmail=error&reason=token_exchange`);
  }

  // Get the Gmail address for this token
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const gmailProfile = await profileRes.json();
  const gmailEmail   = gmailProfile.email;

  if (!gmailEmail) {
    console.error('[gmail/callback] Could not get Gmail email from profile');
    return NextResponse.redirect(`${returnBase}?gmail=error&reason=no_email`);
  }

  console.log('[gmail/callback] Processing connection:', { stateUserId, gmailEmail, hasRefreshToken: !!tokens.refresh_token, stateBu });

  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
  const now       = new Date().toISOString();

  // Check if this (user_id, gmail_email) already exists
  const { data: existing } = await supabase
    .from('gmail_connections')
    .select('id')
    .eq('user_id', stateUserId)
    .eq('gmail_email', gmailEmail)
    .maybeSingle();

  if (existing) {
    // Update existing connection — always refresh the tokens
    const updatePayload: Record<string, string> = {
      access_token: tokens.access_token,
      expires_at:   expiresAt,
      updated_at:   now,
    };
    // Only update refresh_token if Google returned one (it won't on re-auth without revoke)
    if (tokens.refresh_token) updatePayload.refresh_token = tokens.refresh_token;

    const { error: updateErr } = await supabase
      .from('gmail_connections')
      .update(updatePayload)
      .eq('id', existing.id);

    if (updateErr) {
      console.error('[gmail/callback] Update error:', updateErr);
      return NextResponse.redirect(`${returnBase}?gmail=error&reason=db_update`);
    }
    console.log('[gmail/callback] Updated existing connection for', gmailEmail);
  } else {
    // New connection — must have refresh_token
    if (!tokens.refresh_token) {
      console.error('[gmail/callback] No refresh_token for new connection:', gmailEmail, '— revoking and auto-retrying');
      // Revoke the stale access so Google issues a fresh grant on next auth
      await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, { method: 'POST' }).catch(() => {});

      // Check if this is already a retry (prevent infinite loops)
      const isRetry = stateRaw?.includes('|retry');
      if (isRetry) {
        console.error('[gmail/callback] Still no refresh_token after retry — giving up');
        return NextResponse.redirect(`${returnBase}?gmail=error&reason=no_refresh_token`);
      }

      // Auto-retry: bounce back to the auth route — after revocation Google will
      // show fresh consent and return a proper refresh_token this time
      const base = process.env.NEXT_PUBLIC_SERVER_URL ?? 'https://www.fairoaksrealtygroup.com';
      const retryUrl = new URL(`${base}/api/gmail/auth`);
      retryUrl.searchParams.set('userId', stateUserId);
      retryUrl.searchParams.set('hint', gmailEmail);
      retryUrl.searchParams.set('bu', stateBu ?? '');
      retryUrl.searchParams.set('retry', '1');
      return NextResponse.redirect(retryUrl.toString());
    }

    const { error: insertErr } = await supabase
      .from('gmail_connections')
      .insert({
        user_id:       stateUserId,
        gmail_email:   gmailEmail,
        email:         gmailEmail,
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at:    expiresAt,
        updated_at:    now,
      });

    if (insertErr) {
      console.error('[gmail/callback] Insert error:', insertErr);
      return NextResponse.redirect(`${returnBase}?gmail=error&reason=db_insert`);
    }
    console.log('[gmail/callback] Inserted new connection for', gmailEmail, 'user', stateUserId);
  }

  return NextResponse.redirect(`${returnBase}?gmail=connected&account=${encodeURIComponent(gmailEmail)}`);
}
