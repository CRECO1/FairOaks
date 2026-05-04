import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';

interface GmailConnection {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email?: string;
}

async function getValidConnection(
  userId: string,
  anonKey: string,
  serviceRoleKey: string
): Promise<{ accessToken: string; agentEmail: string | null } | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  const rows: GmailConnection[] = await res.json();
  if (!rows || rows.length === 0) return null;

  const conn = rows[0];
  const expiresAt = new Date(conn.expires_at).getTime();
  let accessToken = conn.access_token;

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

    await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ access_token: accessToken, expires_at: newExpiry, updated_at: new Date().toISOString() }),
    });
  }

  let agentEmail: string | null = conn.email ?? null;
  if (!agentEmail) {
    try {
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        agentEmail = profile.emailAddress ?? null;
        if (agentEmail) {
          await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: anonKey,
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ email: agentEmail }),
          });
        }
      }
    } catch {
      // non-fatal
    }
  }

  return { accessToken, agentEmail };
}

export async function POST(req: NextRequest) {
  try {
    const { userId, dealId, to, subject, body, agentName, ccAgentIds } = await req.json();
    if (!userId || !dealId || !to || !subject || !body) {
      return NextResponse.json({ error: 'userId, dealId, to, subject, body are required' }, { status: 400 });
    }

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const connection = await getValidConnection(userId, anonKey, serviceRoleKey);
    if (!connection) return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
    const { accessToken, agentEmail } = connection;

    const gmailEmail = agentEmail ?? '';
    const trackingId = crypto.randomUUID();

    // Look up CC agent emails (exclude the sender)
    let ccEmails: string[] = [];
    if (ccAgentIds?.length) {
      const ids = (ccAgentIds as string[]).filter(id => id !== userId);
      if (ids.length) {
        const profilesRes = await fetch(
          `${SUPABASE_URL}/rest/v1/crm_profiles?id=in.(${ids.join(',')})&select=email`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` } }
        );
        const profiles: { email: string }[] = await profilesRes.json();
        ccEmails = profiles.map(p => p.email).filter(Boolean);
      }
    }

    const pixel = `<img src="https://www.fairoaksrealtygroup.com/api/track/open?id=${trackingId}" width="1" height="1" style="display:none" />`;
    const bodyWithPixel = `${body}${pixel}`;

    const fromLine = agentName ? `${agentName} <${gmailEmail}>` : gmailEmail;
    const headers: string[] = [
      `From: ${fromLine}`,
      `To: ${to}`,
    ];
    if (ccEmails.length) headers.push(`Cc: ${ccEmails.join(', ')}`);
    headers.push(`Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', bodyWithPixel);

    const rawEmail = headers.join('\r\n');

    const encoded = Buffer.from(rawEmail)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });

    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      return NextResponse.json({ error: sendData.error?.message ?? 'Gmail send failed' }, { status: 500 });
    }

    // Strip HTML tags for the stored plain-text body summary
    const plainBody = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
    const emailDate = new Date().toISOString().slice(0, 10);

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_deal_emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        deal_id: dealId,
        direction: 'sent',
        from_email: gmailEmail,
        to_email: to,
        subject,
        body: plainBody,
        email_date: emailDate,
        gmail_message_id: sendData.id,
        tracking_id: trackingId,
        ...(ccEmails.length ? { cc_emails: ccEmails.join(', ') } : {}),
      }),
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('Failed to insert sent email:', errText);
      return NextResponse.json({ error: 'Email sent but failed to log: ' + errText }, { status: 500 });
    }

    const inserted = await insertRes.json();
    const emailId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;

    return NextResponse.json({ success: true, emailId });
  } catch (err) {
    console.error('Gmail send error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
