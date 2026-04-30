import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';

async function getValidAccessToken(conn: any): Promise<string | null> {
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
    body: JSON.stringify({ access_token: refreshed.access_token, expires_at: newExpiry, updated_at: new Date().toISOString() }),
  });

  return refreshed.access_token;
}

async function fetchCalendarEvents(accessToken: string, accountEmail: string, days: number) {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', now.toISOString());
  url.searchParams.set('timeMax', future.toISOString());
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '50');

  const calRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!calRes.ok) return { events: [], scopeError: calRes.status === 403 };

  const calData = await calRes.json();
  const events = (calData.items ?? []).map((e: any) => ({
    id: `${accountEmail}::${e.id}`,
    title: e.summary ?? '(No title)',
    description: e.description ?? null,
    location: e.location ?? null,
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    allDay: !e.start?.dateTime,
    attendees: (e.attendees ?? []).map((a: any) => ({ email: a.email, name: a.displayName ?? null, self: a.self ?? false })),
    htmlLink: e.htmlLink ?? null,
    status: e.status ?? 'confirmed',
    account: accountEmail, // which calendar this came from
  }));

  return { events, scopeError: false };
}

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    const days = parseInt(req.nextUrl.searchParams.get('days') ?? '90');
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // Fetch ALL connected accounts for this user
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}`, {
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
    });
    const connections = await res.json();
    if (!connections || connections.length === 0) return NextResponse.json({ error: 'Not connected' }, { status: 401 });

    // Fetch calendar events from all accounts in parallel
    const results = await Promise.all(
      connections.map(async (conn: any) => {
        const token = await getValidAccessToken(conn);
        if (!token) return { events: [], scopeError: false };
        return fetchCalendarEvents(token, conn.gmail_email, days);
      })
    );

    const scopeError = results.every(r => r.scopeError);
    const allEvents = results.flatMap(r => r.events);

    // Sort merged events by start time
    allEvents.sort((a, b) => {
      if (!a.start) return 1;
      if (!b.start) return -1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });

    return NextResponse.json({ events: allEvents, scopeError });
  } catch (err) {
    console.error('Calendar events error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
