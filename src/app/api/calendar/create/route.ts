import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { SUPABASE_URL } from '@/lib/supabase-admin';

type GmailConn = { id: string; access_token: string; refresh_token: string; expires_at: string; gmail_email: string };

async function getValidAccessToken(conn: GmailConn): Promise<string | null> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const expiresAt = new Date(conn.expires_at).getTime();
  if (Date.now() < expiresAt - 120_000) return conn.access_token;

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
  await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?id=eq.${conn.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
    body: JSON.stringify({ access_token: refreshed.access_token, expires_at: newExpiry }),
  });

  return refreshed.access_token;
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getCrmUser();
    if (!caller) return unauthorized();

    const { title, due_date, notes, client_name, task_type, userId } = await req.json();

    if (!title || !due_date || !userId) {
      return NextResponse.json({ error: 'title, due_date, and userId required' }, { status: 400 });
    }

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // Get the user's first connected Google account
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}&limit=1`, {
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
    });
    const connections: GmailConn[] = await res.json();
    if (!connections || connections.length === 0) {
      return NextResponse.json({ error: 'No Google account connected' }, { status: 401 });
    }

    const accessToken = await getValidAccessToken(connections[0]);
    if (!accessToken) {
      return NextResponse.json({ error: 'Could not refresh Google token' }, { status: 401 });
    }

    const typeEmoji = task_type === 'call' ? '📞' : task_type === 'email' ? '✉️' : '📋';
    const eventTitle = `${typeEmoji} ${title}${client_name ? ` — ${client_name}` : ''}`;
    const description = [
      client_name ? `Contact: ${client_name}` : '',
      `Task type: ${task_type === 'follow_up' ? 'Follow Up' : task_type === 'call' ? 'Call' : 'Email'}`,
      notes ? `Notes: ${notes}` : '',
      '',
      'Created by Fair Oaks Realty Group CRM',
    ].filter(l => l !== undefined).join('\n').trim();

    // Create all-day event on the due date
    const event = {
      summary: eventTitle,
      description,
      start: { date: due_date },
      end: { date: due_date },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 480 }, // 8 hours before (morning of)
        ],
      },
    };

    const createRes = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (!createRes.ok) {
      const err = await createRes.json();
      // 403 = scope not granted yet (user needs to re-auth)
      if (createRes.status === 403) {
        return NextResponse.json({ error: 'scope_missing', message: 'Calendar write permission not granted. Please reconnect Google in Settings.' }, { status: 403 });
      }
      return NextResponse.json({ error: err?.error?.message ?? 'Calendar API error' }, { status: 500 });
    }

    const created = await createRes.json();
    return NextResponse.json({ success: true, eventId: created.id, htmlLink: created.htmlLink });
  } catch (err) {
    console.error('Calendar create error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
