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
