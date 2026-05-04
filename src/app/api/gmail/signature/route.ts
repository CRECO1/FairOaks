import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';

interface GmailConnection {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

async function getValidToken(userId: string, anonKey: string, serviceKey: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
    headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceKey}` },
  });
  const rows: GmailConnection[] = await res.json();
  if (!rows?.length) return null;

  const conn = rows[0];
  let accessToken = conn.access_token;

  if (Date.now() >= new Date(conn.expires_at).getTime() - 120_000) {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: conn.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    const refreshed = await refreshRes.json();
    if (!refreshRes.ok || !refreshed.access_token) return null;
    accessToken = refreshed.access_token;
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': anonKey, 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ access_token: accessToken, expires_at: newExpiry }),
    });
  }

  return accessToken;
}

// GET /api/gmail/signature?userId=xxx
// Fetches the agent's Gmail signature and saves it to crm_profiles
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const accessToken = await getValidToken(userId, anonKey, serviceKey);
  if (!accessToken) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });

  // Fetch all send-as addresses (the primary one has the signature)
  const sendAsRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!sendAsRes.ok) {
    const err = await sendAsRes.json();
    return NextResponse.json({ error: err.error?.message ?? 'Failed to fetch Gmail settings' }, { status: 400 });
  }

  const sendAsData = await sendAsRes.json();
  const sendAsList: any[] = sendAsData.sendAs ?? [];

  // Find the default/primary send-as (isDefault: true, or first in list)
  const primary = sendAsList.find(s => s.isDefault) ?? sendAsList[0];
  const signature: string = primary?.signature ?? '';

  // Save to crm_profiles
  await fetch(`${SUPABASE_URL}/rest/v1/crm_profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ email_signature: signature }),
  });

  return NextResponse.json({ signature });
}
