import { digits } from '@/lib/phone';

/**
 * The matching key for a caller ID: last 10 digits for a US/Canada number (so +1, 1-, parentheses and
 * dashes all collapse), the full digits for an international one. Null for anything that isn't a real
 * number ("anonymous", "restricted", "266696687", short codes) — those are never blocked or listed.
 * Kept in its own dependency-free file so the call-screen route stays small and fast to start.
 */
export function blockKey(n: string | null | undefined): string | null {
  const raw = String(n ?? '').trim();
  const d = digits(raw);
  if (d.length === 10) return d;
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (raw.startsWith('+') && d.length >= 11 && d.length <= 15) return d;
  return null;
}
