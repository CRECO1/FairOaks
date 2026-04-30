import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';
const REDIRECT_URI = 'https://www.fairoaksrealtygroup.com/api/gmail/callback';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const userId = req.nextUrl.searchParams.get('state'); // user_id passed via state param
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code || !userId) {
    return NextResponse.redirect('https://www.fairoaksrealtygroup.com/crm?gmail=error');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token) {
    console.error('Token exchange error:', tokens);
    return NextResponse.redirect('https://www.fairoaksrealtygroup.com/crm?gmail=error');
  }

  // Get the Gmail address
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json();

  // Store tokens in Supabase (upsert by user_id)
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Upsert on (user_id, gmail_email) — allows multiple accounts per user
  await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id: userId,
      gmail_email: profile.email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });

  return NextResponse.redirect('https://www.fairoaksrealtygroup.com/crm?gmail=connected');
}
