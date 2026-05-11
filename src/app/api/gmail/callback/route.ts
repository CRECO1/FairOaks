import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser } from '@/lib/crm-auth';
import { createClient } from '@supabase/supabase-js';

const REDIRECT_URI = `${process.env.NEXT_PUBLIC_SERVER_URL ?? 'https://www.fairoaksrealtygroup.com'}/api/gmail/callback`;
const CRM_URL = `${process.env.NEXT_PUBLIC_SERVER_URL ?? 'https://www.fairoaksrealtygroup.com'}/crm`;

export async function GET(req: NextRequest) {
  const code        = req.nextUrl.searchParams.get('code');
  const stateUserId = req.nextUrl.searchParams.get('state');
  const error       = req.nextUrl.searchParams.get('error');

  if (error || !code || !stateUserId) {
    console.error('[gmail/callback] Missing params or error:', { error, code: !!code, stateUserId });
    return NextResponse.redirect(`${CRM_URL}?gmail=error`);
  }

  const caller = await getCrmUser();
  if (!caller || caller.id !== stateUserId) {
    console.error('[gmail/callback] Auth mismatch');
    return NextResponse.redirect(`${CRM_URL}?gmail=error`);
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
    return NextResponse.redirect(`${CRM_URL}?gmail=error`);
  }

  // Get the Gmail address for this token
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const gmailProfile = await profileRes.json();
  const gmailEmail   = gmailProfile.email;

  if (!gmailEmail) {
    console.error('[gmail/callback] Could not get Gmail email from profile');
    return NextResponse.redirect(`${CRM_URL}?gmail=error`);
  }

  const supabase  = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
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

    if (updateErr) console.error('[gmail/callback] Update error:', updateErr);
  } else {
    // New connection — must have refresh_token
    if (!tokens.refresh_token) {
      console.error('[gmail/callback] No refresh_token for new connection:', gmailEmail);
      return NextResponse.redirect(`${CRM_URL}?gmail=error&reason=no_refresh_token`);
    }

    const { error: insertErr } = await supabase
      .from('gmail_connections')
      .insert({
        user_id:      stateUserId,
        gmail_email:  gmailEmail,
        email:        gmailEmail,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at:   expiresAt,
        updated_at:   now,
      });

    if (insertErr) {
      console.error('[gmail/callback] Insert error:', insertErr);
      return NextResponse.redirect(`${CRM_URL}?gmail=error`);
    }
  }

  return NextResponse.redirect(`${CRM_URL}?gmail=connected`);
}
