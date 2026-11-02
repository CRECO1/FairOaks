// Read the first event out of an emailed meeting invite (.ics). Handles what actually shows up in a broker's inbox:
// Google Calendar and Outlook invites, UTC / zoned / all-day times, Windows time-zone names, folded lines and
// escaped text. Not a full iCalendar parser — one VEVENT, plus the METHOD so a cancellation is not added as a meeting.

export interface IcsEvent {
  uid: string;
  method: string;                 // REQUEST, PUBLISH, CANCEL, REPLY …
  title: string;
  allDay: boolean;
  /** all-day: YYYY-MM-DD. timed: local wall time YYYY-MM-DDTHH:MM:SS (no zone), or UTC with a trailing Z. */
  start: string;
  end: string;
  timeZone: string | null;        // IANA zone for a zoned/floating time; null for UTC or all-day
  location: string;
  description: string;
  organizer: string;
  recurrence: string | null;      // the RRULE line, if any
}

// Outlook writes Windows zone names; Google wants IANA ones.
const WINDOWS_ZONES: Record<string, string> = {
  'Central Standard Time': 'America/Chicago', 'Central Daylight Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York', 'Eastern Daylight Time': 'America/New_York',
  'Mountain Standard Time': 'America/Denver', 'Mountain Daylight Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles', 'Pacific Daylight Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'UTC': 'UTC', 'GMT Standard Time': 'Europe/London',
};
const DEFAULT_ZONE = 'America/Chicago';

const unescapeText = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

/** Lines with their parameters: "DTSTART;TZID=X:2026…" → { name: 'DTSTART', params: { TZID: 'X' }, value: '2026…' }. */
function contentLines(text: string) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  return unfolded.split(/\r?\n/).filter(Boolean).map(line => {
    const i = line.indexOf(':');
    if (i < 0) return null;
    const [name, ...rawParams] = line.slice(0, i).split(';');
    const params: Record<string, string> = {};
    for (const p of rawParams) { const [k, v] = p.split('='); if (k) params[k.toUpperCase()] = (v ?? '').replace(/^"|"$/g, ''); }
    return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
  }).filter((x): x is { name: string; params: Record<string, string>; value: string } => !!x);
}

function when(value: string, params: Record<string, string>): { iso: string; allDay: boolean; zone: string | null } | null {
  const v = value.trim();
  if (/^\d{8}$/.test(v) || params.VALUE === 'DATE') {
    if (!/^\d{8}$/.test(v)) return null;
    return { iso: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true, zone: null };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7]) return { iso: `${iso}Z`, allDay: false, zone: null };
  const tz = params.TZID ? (WINDOWS_ZONES[params.TZID] ?? (/^[A-Za-z_]+\/[A-Za-z_+\-0-9/]+$/.test(params.TZID) ? params.TZID : DEFAULT_ZONE)) : DEFAULT_ZONE;
  return { iso, allDay: false, zone: tz };
}

export function parseIcs(text: string): IcsEvent | null {
  const lines = contentLines(text);
  const begin = lines.findIndex(l => l.name === 'BEGIN' && l.value.toUpperCase() === 'VEVENT');
  if (begin < 0) return null;
  const rest = lines.slice(begin + 1);
  const endIdx = rest.findIndex(l => l.name === 'END' && l.value.toUpperCase() === 'VEVENT');
  const ev = endIdx < 0 ? rest : rest.slice(0, endIdx);
  const get = (n: string) => ev.find(l => l.name === n);
  const ds = get('DTSTART');
  const start = ds ? when(ds.value, ds.params) : null;
  if (!start) return null;
  const de = get('DTEND');
  let end = de ? when(de.value, de.params) : null;
  if (!end) {
    const dur = get('DURATION')?.value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
    const mins = dur ? (Number(dur[1] ?? 0) * 1440 + Number(dur[2] ?? 0) * 60 + Number(dur[3] ?? 0)) : (start.allDay ? 1440 : 60);
    const base = new Date(start.allDay ? `${start.iso}T00:00:00Z` : `${start.iso.replace(/Z$/, '')}Z`);
    base.setUTCMinutes(base.getUTCMinutes() + mins);
    const iso = base.toISOString().replace(/\.\d{3}Z$/, '');
    end = start.allDay ? { iso: iso.slice(0, 10), allDay: true, zone: null } : { iso: start.iso.endsWith('Z') ? `${iso}Z` : iso, allDay: false, zone: start.zone };
  }
  const org = get('ORGANIZER');
  const organizer = org ? (org.params.CN || org.value.replace(/^mailto:/i, '')) : '';
  return {
    uid: get('UID')?.value.trim() ?? '',
    method: (lines.find(l => l.name === 'METHOD')?.value ?? 'PUBLISH').trim().toUpperCase(),
    title: unescapeText(get('SUMMARY')?.value ?? '') || '(no title)',
    allDay: start.allDay,
    start: start.iso, end: end.iso, timeZone: start.zone,
    location: unescapeText(get('LOCATION')?.value ?? ''),
    description: unescapeText(get('DESCRIPTION')?.value ?? '').slice(0, 2000),
    organizer,
    recurrence: get('RRULE') ? `RRULE:${get('RRULE')!.value.trim()}` : null,
  };
}

/** "Thu, Nov 5 at 2:00 PM" (or "Thu, Nov 5" for all-day), in the invite's own time zone — what a person would say. */
export function describeWhen(e: IcsEvent): string {
  if (e.allDay) return new Date(`${e.start}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const utc = e.start.endsWith('Z');
  // A zoned invite carries wall-clock fields: read them back as UTC so no shift is applied. A UTC invite is shown in Central.
  const d = new Date(utc ? e.start : `${e.start}Z`), timeZone = utc ? 'America/Chicago' : 'UTC';
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone, ...(utc ? { timeZoneName: 'short' as const } : {}) });
  return `${day} at ${time}`;
}
