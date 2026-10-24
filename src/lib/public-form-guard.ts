/**
 * Extra bounds for the anonymous lead-style endpoints (leads, quiz, agent-apply, listing-alerts).
 *
 * The per-IP limiter and bot-guard stop a script on one address, but a rotating-proxy botnet — or one person using
 * a victim's address — gets past both. So also limit by WHO is being submitted: a given email / phone can be
 * submitted a handful of times an hour across all of these forms, no matter how many IPs the requests come from.
 * Also: field caps, so one request can't push megabytes into the CRM and the broker's inbox.
 */
import { userRateLimit } from '@/lib/user-ratelimit';

/** False when this email/phone has already been submitted too often (all public forms share one budget). */
export async function contactAllowed(email: unknown, phone: unknown): Promise<boolean> {
  const e = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
  const p = typeof phone === 'string' ? phone.replace(/\D/g, '').slice(-10) : '';
  for (const id of [e && `e:${e}`, p.length === 10 && `p:${p}`]) {
    if (!id) continue;
    if (!(await userRateLimit('public-form-contact', id, 4, '1 h')).success) return false;
  }
  return true;
}

/** A trimmed string no longer than `max`, or '' for anything that isn't a string. */
export function capStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
