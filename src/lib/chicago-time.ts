/**
 * Convert a Chicago local date+time string to a UTC ISO string.
 * Uses Intl.DateTimeFormat to detect the correct CDT/CST offset for the given date.
 */
export function chicagoLocalToUTC(dateStr: string, timeStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  // Treat as UTC temporarily to query Intl for the Chicago offset at this moment
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(probe).reduce<Record<string, number>>((a, p) => {
    if (p.type !== 'literal') a[p.type] = parseInt(p.value, 10);
    return a;
  }, {});
  const hrNorm = parts.hour === 24 ? 0 : parts.hour;
  const chiAsUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, hrNorm, parts.minute, parts.second ?? 0);
  const offsetMs = probe.getTime() - chiAsUtcMs;
  return new Date(probe.getTime() + offsetMs).toISOString();
}

const CT = 'America/Chicago';

/**
 * "Today" (or any instant) as a Central-time calendar date, YYYY-MM-DD. Servers run in UTC, so
 * `new Date().toISOString().slice(0, 10)` flips to tomorrow at 7 pm CDT / 6 pm CST — use this wherever a date is
 * stamped, compared with a due date, or shown to the team.
 */
export function chicagoToday(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: CT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** M/D/YYYY in Central time (what `toLocaleDateString('en-US')` gives, but pinned to Central instead of the server's UTC). */
export function chicagoDateUS(at: Date = new Date()): string {
  return at.toLocaleDateString('en-US', { timeZone: CT });
}

/** Hour of day (0-23) and weekday (0=Sun) in Central time. */
export function chicagoHourDow(at: Date): { hour: number; dow: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: CT, weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(at).map(x => [x.type, x.value]));
  return { hour: Number(p.hour) % 24, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday)) };
}

/** A date + time, English, Central — for emails and notes built on the server. */
export function chicagoFormat(at: Date, opts: Intl.DateTimeFormatOptions): string {
  return at.toLocaleString('en-US', { timeZone: CT, ...opts });
}
