// Phone-number helpers shared by the Calling Log, the Talkroute sync and the voice bot.

/** Digits only. */
export function digits(s: string | null | undefined): string {
  return String(s ?? '').replace(/\D/g, '');
}

/** Normalise a US/Canada number to E.164 (+1XXXXXXXXXX). Anything else is returned trimmed, or null when empty. */
export function toE164(s: string | null | undefined): string | null {
  const raw = String(s ?? '').trim();
  if (!raw) return null;
  const d = digits(raw);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (raw.startsWith('+') && d.length >= 8) return `+${d}`;
  return raw;
}

/** The last 10 digits — the part that actually identifies a North American number. */
export function last10(s: string | null | undefined): string {
  const d = digits(s);
  return d.length > 10 ? d.slice(-10) : d;
}

/** True when two numbers refer to the same line, however they were typed. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = last10(a), y = last10(b);
  return !!x && x === y;
}

/** (210) 555-0123 for display; unknown shapes pass through. */
export function prettyPhone(s: string | null | undefined): string {
  const d = last10(s);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return String(s ?? '').trim() || 'Unknown';
}

/** Speak a number the way a person would read it out: "2 1 0, 5 5 5, 0 1 2 3". */
export function spokenPhone(s: string | null | undefined): string {
  const d = last10(s);
  if (d.length !== 10) return String(s ?? '');
  return `${d.slice(0, 3).split('').join(' ')}, ${d.slice(3, 6).split('').join(' ')}, ${d.slice(6).split('').join(' ')}`;
}
