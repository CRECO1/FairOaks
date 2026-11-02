import { NextRequest, NextResponse } from 'next/server';
import { getCrmProfileUser, unauthorized, forbidden } from '@/lib/crm-auth';
import { SUPABASE_URL } from '@/lib/supabase-admin';
import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { safeJson } from '@/lib/safe-json';

type GmailConn = { id: string; access_token: string; refresh_token: string; expires_at: string; gmail_email: string };

async function getValidAccessToken(conn: GmailConn): Promise<string | null> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const expiresAt = new Date(conn.expires_at).getTime();
  if (Date.now() < expiresAt - 120_000) return decryptToken(conn.access_token);

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decryptToken(conn.refresh_token),
      grant_type: 'refresh_token',
    }),
  });

  const refreshed = await safeJson<{ access_token?: string; expires_in?: number }>(refreshRes, 'calendar/create token refresh');
  if (!refreshed?.access_token) return null;

  // Google omits expires_in on some refreshes; fall back to its documented 1 hour.
  const newExpiry = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?id=eq.${conn.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
    body: JSON.stringify({ access_token: encryptToken(refreshed.access_token), expires_at: newExpiry }),
  });

  return refreshed.access_token;
}

export async function POST(req: NextRequest) {
  try {
    // Bearer-aware for the same reason as /api/gmail/send: the copilot has a token,
    // not a cookie jar.
    const caller = await getCrmProfileUser(req);
    if (!caller) return unauthorized();

    const { title, due_date, notes, client_name, task_type, userId, start_time, duration_minutes, location, attendees } = await req.json();

    if (!title || !due_date || !userId) {
      return NextResponse.json({ error: 'title, due_date, and userId required' }, { status: 400 });
    }

    // userId selects which agent's Google account the event is written to. It arrives in
    // the body, so it has to be checked against the caller: without this, any signed-in
    // CRM user could POST someone else's id and create events on THEIR calendar using
    // THEIR stored OAuth token. Mirrors the same guard in /api/gmail/send.
    if (caller.id !== userId) return forbidden("Cannot use another user's Google connection");

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // Get the user's first connected Google account
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${userId}&limit=1`, {
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${serviceRoleKey}` },
    });
    const connections = await safeJson<GmailConn[]>(res, 'calendar/create connections');
    if (!Array.isArray(connections) || connections.length === 0) {
      return NextResponse.json({ error: 'No Google account connected' }, { status: 401 });
    }

    const accessToken = await getValidAccessToken(connections[0]);
    if (!accessToken) {
      return NextResponse.json({ error: 'Could not refresh Google token' }, { status: 401 });
    }

    // A time of day ("13:30" or "1:30 PM") makes this a real timed event in Central time; without one it stays all-day.
    // Safety net: if nobody passed a time but the title or notes name one ("tour at 1:30 PM", "11:30am"), use it — a
    // specific time must never end up as an all-day entry. Only an explicit am/pm or a colon time counts (not "at 3 people").
    const written = `${title ?? ''} ${notes ?? ''}`.match(/\b(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?)(?![a-z0-9])/i)?.[1];
    const wantedTime: string | null = typeof start_time === 'string' && start_time.trim() ? start_time : (written ?? null);
    const timeMatch = typeof wantedTime === 'string' ? wantedTime.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i) : null;
    let startHm: string | null = null;
    if (timeMatch) {
      let h = Number(timeMatch[1]); const m = Number(timeMatch[2] ?? 0); const ap = timeMatch[3]?.toLowerCase();
      if (ap) { if (h < 1 || h > 12) h = -1; else h = (h % 12) + (ap.startsWith('p') ? 12 : 0); }
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) startHm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    if (typeof start_time === 'string' && start_time.trim() && !startHm) return NextResponse.json({ error: `I couldn't read the time "${start_time}" — use something like 13:30 or 1:30 PM.` }, { status: 400 });
    const mins = Math.min(1440, Math.max(5, Number(duration_minutes) || 60));

    const typeEmoji = task_type === 'call' ? '📞' : task_type === 'email' ? '✉️' : '📋';
    const eventTitle = `${typeEmoji} ${title}${client_name ? ` — ${client_name}` : ''}`;
    const description = [
      client_name ? `Contact: ${client_name}` : '',
      task_type ? `Task type: ${task_type === 'follow_up' ? 'Follow Up' : task_type === 'call' ? 'Call' : 'Email'}` : '',
      notes ? `Notes: ${notes}` : '',
      '',
      'Created by Fair Oaks Realty Group CRM',
    ].filter(l => l !== undefined).join('\n').trim();

    // Duplicate guard: if an all-day event with this exact title already sits on the
    // date, return it instead of stacking a second one. The Copilot re-calling
    // schedule_event (or a double-click) would otherwise create duplicate events.
    try {
      const dayStart = `${due_date}T00:00:00Z`;
      const dayEnd = new Date(new Date(`${due_date}T00:00:00Z`).getTime() + 86_400_000).toISOString();
      const listRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(dayStart)}&timeMax=${encodeURIComponent(dayEnd)}&singleEvents=true&maxResults=50`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (listRes.ok) {
        const list = await safeJson<{ items?: Array<{ id: string; summary?: string; htmlLink?: string }> }>(listRes, 'calendar/create dedupe');
        const existing = (list?.items ?? []).find(ev => (ev.summary ?? '') === eventTitle);
        if (existing) return NextResponse.json({ success: true, eventId: existing.id, htmlLink: existing.htmlLink, duplicate: true });
      }
    } catch { /* dedupe is best-effort — never block a genuine create over it */ }

    // All-day on the due date, or a timed event at start_time. (An all-day end date is exclusive, so it is the next day.)
    const ZONE = 'America/Chicago';
    const localEnd = (() => {
      const [h, m] = (startHm ?? '00:00').split(':').map(Number);
      const t = new Date(Date.UTC(2000, 0, 1, h, m + mins)); // only the clock and day-roll matter
      const dayRoll = Math.floor((h * 60 + m + mins) / 1440);
      const d = new Date(`${due_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dayRoll);
      return `${d.toISOString().slice(0, 10)}T${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:00`;
    })();
    const nextDay = (() => { const d = new Date(`${due_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    // Guests get a real Google Calendar invite (sendUpdates=all). Only on a timed meeting, never an all-day reminder.
    const guestEmails: string[] = startHm && Array.isArray(attendees)
      ? [...new Set<string>(attendees.map((a: unknown) => String(a ?? '').trim().toLowerCase()).filter((a: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)))].slice(0, 20)
      : [];
    const event = {
      summary: eventTitle,
      ...(guestEmails.length ? { attendees: guestEmails.map(email => ({ email })) } : {}),
      description,
      ...(typeof location === 'string' && location.trim() ? { location: location.trim().slice(0, 300) } : {}),
      ...(startHm
        ? { start: { dateTime: `${due_date}T${startHm}:00`, timeZone: ZONE }, end: { dateTime: localEnd, timeZone: ZONE } }
        : { start: { date: due_date }, end: { date: nextDay } }),
      reminders: {
        useDefault: false,
        overrides: [
          startHm ? { method: 'popup', minutes: 30 } : { method: 'popup', minutes: 480 }, // 30 min before a timed event; morning of an all-day one
        ],
      },
    };

    const createRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events${guestEmails.length ? '?sendUpdates=all' : ''}`,
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
      const err = await createRes.text().catch(() => '');
      // 403 = scope not granted yet (user needs to re-auth)
      if (createRes.status === 403) {
        return NextResponse.json({ error: 'scope_missing', message: 'Calendar write permission not granted. Please reconnect Google in Settings.' }, { status: 403 });
      }
      console.error('[calendar/create] Google API error', createRes.status, err.slice(0, 500));
      return NextResponse.json({ error: 'Calendar API error' }, { status: 500 });
    }

    const created = await safeJson<{ id?: string; htmlLink?: string }>(createRes, 'calendar/create event');
    if (!created) return NextResponse.json({ error: 'Calendar API error' }, { status: 500 });
    return NextResponse.json({ success: true, eventId: created.id, htmlLink: created.htmlLink, invited: guestEmails });
  } catch (err) {
    console.error('Calendar create error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
