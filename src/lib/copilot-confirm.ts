import crypto from 'crypto';
import type { AgentCtx } from '@/lib/crm-assistant-tools';

/**
 * Binding a copilot write to the agent's approval of it.
 *
 * The old design unlocked writes with an `allowWrites` boolean in the request body and
 * re-ran the model over the whole conversation. Two things were wrong with that:
 *
 *   1. It did not work. On the confirm pass the conversation already contained the
 *      tool_result "NOT_EXECUTED … do not retry", so the model answered in text instead
 *      of re-issuing the call — every time. Clicking "Confirm & run" wrote nothing and
 *      told the agent to click the button they had just clicked. 0 of 5 in testing, and
 *      zero copilot writes in the production audit trail.
 *   2. The flag was the client's to set, and nothing tied what ran to what was shown.
 *      A caller could send allowWrites=true on the first request and skip the
 *      confirmation entirely; on a confirm pass every write the model produced ran,
 *      not just the approved one, with whatever arguments it re-derived that time.
 *
 * So approval is now a ticket, not a mode. When a write is queued the server hands back
 * an opaque token over the exact tool name and arguments, bound to that agent and
 * short-lived. Confirming replays the ticket — the model is not consulted again and
 * cannot change its mind about the arguments. What runs is what the agent read.
 *
 * Signed rather than stored so there is no new table and no cleanup job; the payload is
 * small and the ticket is single-use by expiry rather than by bookkeeping.
 */

// A dedicated secret if one is set, otherwise the service-role key — both are
// server-only, and the fallback means this needs no new environment variable.
function secret(): string {
  const s = process.env.COPILOT_CONFIRM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('copilot-confirm: no signing secret available');
  return s;
}

const TTL_MS = 30 * 60 * 1000;

interface Ticket { n: string; i: Record<string, unknown>; u: string; e: number }

function sign(body: string): string {
  return crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}

/** Issue an approval ticket for one proposed write. */
export function signPendingWrite(ctx: AgentCtx, name: string, input: Record<string, unknown>): string {
  const ticket: Ticket = { n: name, i: input ?? {}, u: ctx.userId, e: Date.now() + TTL_MS };
  const body = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/**
 * Verify a ticket and return the call it authorises.
 *
 * Returns null for anything that is not a valid, unexpired ticket issued to THIS agent —
 * a forged or edited token, one lifted from another agent's session, or a stale one.
 */
export function verifyPendingWrite(token: unknown, ctx: AgentCtx): { name: string; input: Record<string, any> } | null {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = sign(body);
  // Constant-time compare; timingSafeEqual throws on a length mismatch.
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let t: Ticket;
  try { t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Ticket; }
  catch { return null; }

  if (!t || typeof t.n !== 'string') return null;
  if (t.u !== ctx.userId) return null;        // issued to someone else
  if (!(typeof t.e === 'number') || Date.now() > t.e) return null;
  return { name: t.n, input: (t.i ?? {}) as Record<string, any> };
}
