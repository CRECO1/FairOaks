import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encryptToken } from '@/lib/token-crypto';
import { randomUUID } from 'crypto';

const BASE_URL     = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.fairoaksrealtygroup.com').replace(/[\r\n\s]+$/, '');
const REDIRECT_URI = `${BASE_URL}/api/gmail/callback`;
const CRM_URL      = `${BASE_URL}/crm`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export async function GET(req: NextRequest) {
  const code     = req.nextUrl.searchParams.get('code');
  const stateRaw = req.nextUrl.searchParams.get('state');
  const error    = req.nextUrl.searchParams.get('error');

  // State is "userId|bu|retryFlag|nonce" (bu / retryFlag may be empty)
  const stateParts  = (stateRaw ?? '').split('|');
  const stateUserId = stateParts[0];
  const stateBu     = stateParts[1] ?? '';
  const isRetry     = stateParts[2] === 'retry';
  const stateNonce  = stateParts[3] ?? '';
  const returnBase  = stateBu ? `${CRM_URL}/${stateBu}` : CRM_URL;

  if (error || !code || !stateUserId) {
    console.error('[gmail/callback] Missing params or error:', { error, code: !!code, stateUserId });
    return NextResponse.redirect(`${returnBase}?gmail=error&reason=oauth_denied`);
  }

  // CSRF: the nonce echoed in `state` must match the HttpOnly cookie the auth
  // route (or a prior retry) set on this browser. Blocks account-linking CSRF —
  // an attacker can't forge a callback that binds a Gmail account to another userId.
  const cookieNonce = req.cookies.get('gmail_oauth_nonce')?.value ?? '';
  if (!stateNonce || !cookieNonce || stateNonce !== cookieNonce) {
    console.error('[gmail/callback] OAuth state nonce mismatch — possible CSRF');
    return NextResponse.redirect(`${returnBase}?gmail=error&reason=bad_state`);
  }

  // Service-role client — no SSR session cookie needed
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify this userId exists in CRM + resolve their org for tenant isolation
  const { data: profile, error: profileErr } = await supabase
    .from('crm_profiles')
    .select('id, org_id')
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

  // Fetch the Gmail address for this token
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const gmailProfile = await profileRes.json();
  const gmailEmail   = gmailProfile.email as string | undefined;

  if (!gmailEmail) {
    console.error('[gmail/callback] Could not get Gmail email from profile');
    return NextResponse.redirect(`${returnBase}?gmail=error&reason=no_email`);
  }

  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
  const now       = new Date().toISOString();

  // Check if this (user_id, gmail_email) pair already exists
  const { data: existing } = await supabase
    .from('gmail_connections')
    .select('id')
    .eq('user_id', stateUserId)
    .eq('gmail_email', gmailEmail)
    .maybeSingle();

  if (existing) {
    // Refresh tokens on existing connection
    const updatePayload: Record<string, string> = {
      access_token: encryptToken(tokens.access_token),
      expires_at:   expiresAt,
      updated_at:   now,
    };
    if (tokens.refresh_token) updatePayload.refresh_token = encryptToken(tokens.refresh_token);

    const { error: updateErr } = await supabase
      .from('gmail_connections')
      .update(updatePayload)
      .eq('id', existing.id);

    if (updateErr) {
      console.error('[gmail/callback] Update error:', updateErr);
      return NextResponse.redirect(`${returnBase}?gmail=error&reason=db_update`);
    }

  } else {
    // New connection — needs a refresh_token
    if (!tokens.refresh_token) {
      console.error('[gmail/callback] No refresh_token for new connection — revoking stale grant');
      await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, { method: 'POST' }).catch(() => {});

      if (isRetry) {
        // Already retried once — give up and show a clear error
        console.error('[gmail/callback] Still no refresh_token after retry — giving up');
        return NextResponse.redirect(`${returnBase}?gmail=error&reason=no_refresh_token`);
      }

      // Auto-retry: go directly to Google OAuth (skip auth route to avoid session-cookie dependency).
      // After revocation, Google MUST issue a new refresh_token on the next consent.
      const retryNonce = randomUUID();
      const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      googleUrl.searchParams.set('client_id',     process.env.GOOGLE_CLIENT_ID!);
      googleUrl.searchParams.set('redirect_uri',  REDIRECT_URI);
      googleUrl.searchParams.set('response_type', 'code');
      googleUrl.searchParams.set('scope',         SCOPES);
      googleUrl.searchParams.set('access_type',   'offline');
      googleUrl.searchParams.set('prompt',        'consent');
      googleUrl.searchParams.set('login_hint',    gmailEmail);
      // Carry the retry flag + a fresh nonce so the retry's callback passes the CSRF check
      googleUrl.searchParams.set('state', `${stateUserId}|${stateBu}|retry|${retryNonce}`);
      const retryRes = NextResponse.redirect(googleUrl.toString());
      retryRes.cookies.set('gmail_oauth_nonce', retryNonce, {
        httpOnly: true, secure: true, sameSite: 'lax', path: '/api/gmail', maxAge: 600,
      });
      return retryRes;
    }

    const { error: insertErr } = await supabase
      .from('gmail_connections')
      .insert({
        user_id:       stateUserId,
        org_id:        profile.org_id,
        gmail_email:   gmailEmail,
        email:         gmailEmail,
        access_token:  encryptToken(tokens.access_token),
        refresh_token: encryptToken(tokens.refresh_token),
        expires_at:    expiresAt,
        updated_at:    now,
      });

    if (insertErr) {
      console.error('[gmail/callback] Insert error:', insertErr);
      return NextResponse.redirect(`${returnBase}?gmail=error&reason=db_insert`);
    }
  }

  const successRes = NextResponse.redirect(`${returnBase}?gmail=connected&account=${encodeURIComponent(gmailEmail)}`);
  successRes.cookies.delete('gmail_oauth_nonce'); // one-time use
  return successRes;
}
