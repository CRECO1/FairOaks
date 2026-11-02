import { NextRequest, NextResponse } from 'next/server';
import { getCrmProfileUser, unauthorized } from '@/lib/crm-auth';
import { calendarAccessToken } from '@/lib/google-calendar';
import { safeJson } from '@/lib/safe-json';

// Put a meeting invite from an email onto the CALLER's own Google Calendar (never anyone else's — the account is the
// caller's, not taken from the body). Google's events.import is idempotent on the invite's UID, so adding the same
// invite twice updates one event instead of stacking duplicates. `dryRun` returns the event that would be created.
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZONE = /^[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+){0,2}$/;
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

export async function POST(req: NextRequest) {
  const caller = await getCrmProfileUser(req);
  if (!caller) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const title = clip(b.title, 300).trim(), allDay = b.allDay === true, start = clip(b.start, 25), end = clip(b.end, 25);
  const zone = b.timeZone == null ? null : clip(b.timeZone, 60);
  const ok = allDay ? ISO_DATE.test(start) && ISO_DATE.test(end) : ISO_LOCAL.test(start) && ISO_LOCAL.test(end);
  if (!title || !ok || (zone && !ZONE.test(zone))) return NextResponse.json({ error: 'That invite has no usable date or title.' }, { status: 400 });

  const when = (v: string) => (allDay ? { date: v } : { dateTime: v, ...(v.endsWith('Z') || !zone ? {} : { timeZone: zone }) });
  const uid = clip(b.uid, 200).trim();
  const recurrence = typeof b.recurrence === 'string' && /^RRULE:[A-Z0-9=;,\-+:]{1,200}$/.test(b.recurrence) ? [b.recurrence] : undefined;
  const event = {
    ...(uid ? { iCalUID: uid } : {}),
    summary: title,
    location: clip(b.location, 300) || undefined,
    description: [clip(b.description, 2000), clip(b.organizer, 200) ? `Organizer: ${clip(b.organizer, 200)}` : '', 'Added from an email invite in the CRM'].filter(Boolean).join('\n\n'),
    start: when(start), end: when(end),
    ...(recurrence ? { recurrence } : {}),
  };
  if (b.dryRun === true) return NextResponse.json({ dryRun: true, event });

  const t = await calendarAccessToken(caller.id);
  if ('error' in t) return NextResponse.json({ error: t.error === 'none' ? 'Connect your Google account first.' : 'Could not refresh your Google connection — reconnect it in Settings.' }, { status: 401 });
  // Without a UID there is nothing to dedupe on, so a plain insert; with one, import is idempotent.
  const url = uid ? 'https://www.googleapis.com/calendar/v3/calendars/primary/events/import' : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  if (res.status === 403) return NextResponse.json({ error: 'scope_missing', message: 'Calendar write permission not granted. Please reconnect Google in Settings.' }, { status: 403 });
  if (!res.ok) { console.error('[calendar/import-invite] Google error', res.status, (await res.text().catch(() => '')).slice(0, 400)); return NextResponse.json({ error: 'Google Calendar would not take that invite — it may already be on your calendar.' }, { status: 502 }); }
  const created = await safeJson<{ id?: string; htmlLink?: string }>(res, 'calendar/import-invite');
  return NextResponse.json({ success: true, eventId: created?.id, htmlLink: created?.htmlLink });
}
