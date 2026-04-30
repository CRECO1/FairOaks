import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';

async function getValidAccessToken(userId: string, anonKey: string, serviceRoleKey: string): Promise<string | null> {
  // Fetch stored tokens
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
    headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
  });
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;

  const conn = rows[0];
  const expiresAt = new Date(conn.expires_at).getTime();

  // If token is still valid (with 2 min buffer), use it
  if (Date.now() < expiresAt - 120_000) return conn.access_token;

  // Refresh the token
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

  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  // Update stored token
  await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ access_token: refreshed.access_token, expires_at: newExpiry, updated_at: new Date().toISOString() }),
  });

  return refreshed.access_token;
}

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64(part.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    const { userId, dealId, clientEmail } = await req.json();
    if (!userId || !dealId || !clientEmail) {
      return NextResponse.json({ error: 'userId, dealId, clientEmail required' }, { status: 400 });
    }

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const accessToken = await getValidAccessToken(userId, anonKey, serviceRoleKey);
    if (!accessToken) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });

    // Search Gmail for emails to/from the client
    const query = encodeURIComponent(`from:${clientEmail} OR to:${clientEmail}`);
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    // Fetch existing email IDs to avoid duplicates
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_deal_emails?deal_id=eq.${dealId}&select=id`,
      { headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
    );
    const existing = await existingRes.json();
    const existingIds = new Set((existing || []).map((e: any) => e.id));

    let synced = 0;
    for (const msg of listData.messages) {
      if (existingIds.has(msg.id)) continue;

      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const msgData = await msgRes.json();
      if (!msgRes.ok) continue;

      const headers = msgData.payload?.headers || [];
      const get = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const from = get('From');
      const to = get('To');
      const subject = get('Subject') || '(no subject)';
      const dateStr = get('Date');
      const body = extractBody(msgData.payload);
      const emailDate = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
      const direction = from.toLowerCase().includes(clientEmail.toLowerCase()) ? 'received' : 'sent';

      await fetch(`${SUPABASE_URL}/rest/v1/crm_deal_emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Prefer': 'resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          id: msg.id,
          deal_id: dealId,
          direction,
          from_email: from,
          to_email: to,
          subject,
          body: body.slice(0, 4000),
          email_date: emailDate,
        }),
      });
      synced++;
    }

    return NextResponse.json({ synced });
  } catch (err) {
    console.error('Gmail sync error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
