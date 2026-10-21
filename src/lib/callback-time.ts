/**
 * Call-back touch times for the Calling Log. Everything is Central (America/Chicago),
 * whatever timezone the browser or server is in: "tomorrow 9 AM" is the next Central
 * calendar day at 9 AM Central.
 */
import { chicagoLocalToUTC, chicagoToday } from '@/lib/chicago-time';

const CT = 'America/Chicago';
export const MAX_DAYS_AHEAD = 365;

export type CallbackPreset = { key: string; label: string; iso: string };

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Next Central calendar day, YYYY-MM-DD. */
export const tomorrowCentral = (now: Date = new Date()) => addDays(chicagoToday(now), 1);

export function callbackPresets(now: Date = new Date()): CallbackPreset[] {
  const tmrw = tomorrowCentral(now);
  return [
    { key: '2h', label: 'Call back in 2 hours', iso: new Date(now.getTime() + 2 * 3600_000).toISOString() },
    { key: '4h', label: 'Call back in 4 hours', iso: new Date(now.getTime() + 4 * 3600_000).toISOString() },
    { key: 'tmrw9', label: 'Tomorrow 9:00 AM', iso: chicagoLocalToUTC(tmrw, '09:00') },
    { key: 'tmrw12', label: 'Tomorrow 12:00 PM', iso: chicagoLocalToUTC(tmrw, '12:00') },
  ];
}

/** 6:00 AM – 9:00 PM in 15-minute steps, as { value: 'HH:MM', label: '9:00 AM' }. */
export const TIME_SLOTS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let m = 6 * 60; m <= 21 * 60; m += 15) {
    const h = Math.floor(m / 60), mi = m % 60;
    out.push({ value: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, label: `${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` });
  }
  return out;
})();

/** A Central date + time picked in the Custom control → the UTC instant to store. */
export const customToIso = (dateStr: string, timeStr: string): string | null =>
  dateStr && timeStr ? chicagoLocalToUTC(dateStr, timeStr) : null;

/** "Thu, Oct 22 · 9:00 AM CT" */
export function formatCentral(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { timeZone: CT, weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: CT, hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time} CT`;
}
