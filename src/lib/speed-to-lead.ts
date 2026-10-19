import { chicagoHourDow } from '@/lib/chicago-time';
/**
 * Speed-to-lead + best-time-to-call helpers for the call queue. Pure and client-safe.
 *
 * Response time counts BUSINESS minutes (Mon–Sat 8:00–18:00 Central, same hours as the phones) so a lead that
 * arrives at 11 pm isn't "9 hours late" when the first agent opens the queue at 8 am.
 */

/** Past this many business minutes uncontacted, a new lead is flagged red "call now". */
export const STL_LATE_MIN = 30;
/** Amber ("getting stale") starts here. */
export const STL_WARN_MIN = 15;

const CT = 'America/Chicago';
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: CT, weekday: 'short', hour: 'numeric', hour12: false });
const HOUR = 3_600_000;
// Central offsets are whole hours, so open/closed is constant within a UTC clock hour — cache per hour.
const hourOpen = new Map<number, boolean>();
function open(ms: number): boolean {
  const k = Math.floor(ms / HOUR);
  let v = hourOpen.get(k);
  if (v === undefined) {
    const p = fmt.formatToParts(new Date(k * HOUR));
    const day = p.find(x => x.type === 'weekday')?.value ?? '';
    const hour = Number(p.find(x => x.type === 'hour')?.value ?? '0') % 24;
    v = day !== 'Sun' && hour >= 8 && hour < 18;
    hourOpen.set(k, v);
  }
  return v;
}

/** Business minutes between two instants (scans at most 14 days). */
export function businessMinutesBetween(fromIso: string, toMs: number = Date.now()): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from) || toMs <= from) return 0;
  const end = Math.min(toMs, from + 14 * 86_400_000);
  let mins = 0;
  for (let t = from; t < end;) {
    const next = Math.min((Math.floor(t / HOUR) + 1) * HOUR, end);
    if (open(t)) mins += (next - t) / 60_000;
    t = next;
  }
  return Math.round(mins);
}

/** "4m", "1h 12m", "3h" — never "0m" for a real response, never longer than needed. */
export function fmtMins(m: number): string {
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export type StlTone = 'fresh' | 'warn' | 'late';
export const stlTone = (m: number): StlTone => (m >= STL_LATE_MIN ? 'late' : m >= STL_WARN_MIN ? 'warn' : 'fresh');
export const STL_COLORS: Record<StlTone, { bg: string; fg: string; bd: string }> = {
  fresh: { bg: '#dcfce7', fg: '#166534', bd: '#bbf7d0' },
  warn: { bg: '#fef3c7', fg: '#92400e', bd: '#fde68a' },
  late: { bg: '#fee2e2', fg: '#b91c1c', bd: '#fecaca' },
};

/** Label for a lead still waiting on its first call. */
export function waitingLabel(m: number, closedNow: boolean): string {
  if (closedNow && m < 1) return '⚡ Came in after hours — first call when we open';
  return m >= STL_LATE_MIN ? `⏱ ${fmtMins(m)} — call now` : `⚡ ${fmtMins(m)} since it came in`;
}

export function isOpenNow(now = Date.now()): boolean { return open(now); }

// ── Best time to call ────────────────────────────────────────────────────────

export const isConnectNote = (note: string | null | undefined) => /—\s*(Connected|Talked to them)/i.test(note ?? '');

/** Turn the contact's past *connected* calls into a hint like "Picked up before: Tue ~10 am · Thu ~4 pm". */
export function pickedUpHint(acts: { type: string; note?: string | null; created_at: string }[], now = new Date()): { text: string; nowGood: boolean } | null {
  const hits = acts.filter(a => a.type === 'call' && isConnectNote(a.note)).slice(0, 4);
  if (!hits.length) return null;
  const seen = new Set<string>();
  const parts: string[] = [];
  let nowGood = false;
  for (const h of hits) {
    const d = new Date(h.created_at);
    const { hour: hr, dow } = chicagoHourDow(d);
    const key = `${dow}-${hr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = `${d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short' })} ~${hr % 12 || 12} ${hr < 12 ? 'am' : 'pm'}`;
    parts.push(label);
    if (Math.abs(hr - chicagoHourDow(now).hour) <= 1) nowGood = true;
  }
  return { text: parts.slice(0, 3).join(' · '), nowGood };
}

/** Team-wide: which hours of the day actually connect. Returns the best two hours with ≥ minCalls attempts. */
export function bestHours(rows: { note?: string | null; created_at: string }[], minCalls = 8): { hour: number; rate: number; n: number }[] {
  const tot = new Array(24).fill(0) as number[], hit = new Array(24).fill(0) as number[];
  for (const r of rows) {
    const d = new Date(r.created_at);
    const { hour: h, dow } = chicagoHourDow(d);
    if (dow === 0) continue;
    tot[h]++; if (isConnectNote(r.note)) hit[h]++;
  }
  return tot.map((n, hour) => ({ hour, n, rate: n ? hit[hour] / n : 0 }))
    .filter(x => x.n >= minCalls && x.hour >= 7 && x.hour < 19)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 2);
}
export const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
