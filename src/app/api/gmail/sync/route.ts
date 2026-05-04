import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';

interface GmailConnection {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email?: string; // stored agent email, if available
}

async function getValidConnection(userId: string, anonKey: string, serviceRoleKey: string): Promise<{ accessToken: string; agentEmail: string | null } | null> {
  // Fetch stored tokens
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
    headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
  });
  const rows: GmailConnection[] = await res.json();
  if (!rows || rows.length === 0) return null;

  const conn = rows[0];
  const expiresAt = new Date(conn.expires_at).getTime();
  let accessToken = conn.access_token;

  // If token expired (with 2 min buffer), refresh it
  if (Date.now() >= expiresAt - 120_000) {
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

    // Update stored token
    await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ access_token: accessToken, expires_at: newExpiry, updated_at: new Date().toISOString() }),
    });
  }

  // Get the agent's own Gmail address (used to narrow the search query)
  // Try the stored email first; fall back to the Gmail profile API
  let agentEmail: string | null = conn.email ?? null;
  if (!agentEmail) {
    try {
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        agentEmail = profile.emailAddress ?? null;

        // Persist it so we don't have to fetch it every time
        if (agentEmail) {
          await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': anonKey,
              'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ email: agentEmail }),
          });
        }
      }
    } catch {
      // Non-fatal — we'll fall back to Gmail's built-in "me" operators
    }
  }

  return { accessToken, agentEmail };
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

    const connection = await getValidConnection(userId, anonKey, serviceRoleKey);
    if (!connection) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
    const { accessToken, agentEmail } = connection;

    // Search Gmail for emails that are direct exchanges between this agent and the client.
    // Using agent email explicitly when available; otherwise rely on Gmail's built-in "me" alias.
    // This avoids pulling in emails where the client was only CC'd or BCC'd on unrelated threads.
    const agentPart = agentEmail ?? 'me';
    const query = encodeURIComponent(
      `(from:${clientEmail} to:${agentPart}) OR (from:${agentPart} to:${clientEmail})`
    );
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    // Fetch already-synced Gmail message IDs for this deal to avoid duplicates
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_deal_emails?deal_id=eq.${dealId}&select=gmail_message_id`,
      { headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
    );
    const existing = await existingRes.json();
    const existingMsgIds = new Set(
      (existing || []).map((e: any) => e.gmail_message_id).filter(Boolean)
    );

    let synced = 0;
    for (const msg of listData.messages) {
      if (existingMsgIds.has(msg.id)) continue;

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

      // Secondary guard: confirm this email actually involves the client directly
      // (not just a CC, forwarded thread, etc.)
      const fromLower = from.toLowerCase();
      const toLower = to.toLowerCase();
      const clientLower = clientEmail.toLowerCase();
      const clientInFrom = fromLower.includes(clientLower);
      const clientInTo = toLower.includes(clientLower);
      if (!clientInFrom && !clientInTo) continue; // skip unrelated emails

      // If we know the agent's email, double-check the other side of the thread too
      if (agentEmail) {
        const agentLower = agentEmail.toLowerCase();
        const agentInFrom = fromLower.includes(agentLower);
        const agentInTo = toLower.includes(agentLower);
        if (!agentInFrom && !agentInTo) continue;
      }

      // email_date column is type 'date' — use YYYY-MM-DD only
      const emailDate = dateStr ? new Date(dateStr).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const direction = clientInFrom ? 'received' : 'sent';

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_deal_emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          gmail_message_id: msg.id,
          deal_id: dealId,
          direction,
          from_email: from,
          to_email: to,
          subject,
          body: body.slice(0, 4000),
          email_date: emailDate,
          gmail_thread_id: msgData.threadId ?? null,
          rfc_message_id: get('Message-ID') || null,
        }),
      });

      if (insertRes.ok || insertRes.status === 201) synced++;
      else {
        const errText = await insertRes.text();
        console.error(`Failed to insert email ${msg.id}:`, errText);
      }
    }

    return NextResponse.json({ synced });
  } catch (err) {
    console.error('Gmail sync error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
