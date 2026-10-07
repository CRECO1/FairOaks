/**
 * Bounce-risk scoring for marketing recipients — built from the 2026-10-07 audit of 613 mailed contacts:
 *
 *   address style / source                              hard-bounce rate
 *   free mail (gmail, yahoo, …)                                3 %
 *   corporate, ordinary                                       12 %
 *   corporate "initial+lastname@" (guessed-style)             32 %
 *   corporate domain that has already hard-bounced someone    31 %
 *
 * A "proven" address — one we've already delivered to, or that opened/clicked — is trusted regardless.
 * Used by the campaigns cron (hold_risky_addresses campaigns skip risky, unproven recipients), the pre-send
 * check (expected bounce estimate) and nothing else; it never unsubscribes anyone.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'comcast.net', 'sbcglobal.net', 'att.net', 'bellsouth.net', 'verizon.net', 'cox.net', 'protonmail.com',
]);

export type Risk = 'guessed-pattern' | 'bounced-domain';

export const RISK_RATE = { free: 0.03, corporate: 0.12, guessed: 0.32, bouncedDomain: 0.31, proven: 0.005 } as const;

export interface RiskContext {
  /** Domains where at least one address has hard-bounced. */
  riskyDomains: Set<string>;
  /** Client ids we've delivered to before (any prior 'sent') or who opened/clicked. */
  proven: Set<string>;
}

const domainOf = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';

/** "jsmith@" for John Smith — the shape of an address somebody guessed rather than was given. */
export function looksGuessed(email: string, first?: string | null, last?: string | null): boolean {
  const local = email.trim().toLowerCase().split('@')[0] ?? '';
  const f = (first ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const l = (last ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return !!f && !!l && local === `${f[0]}${l}`;
}

export async function loadRiskContext(db: SupabaseClient, clientIds: string[]): Promise<RiskContext> {
  const proven = new Set<string>();
  for (let i = 0; i < clientIds.length; i += 200) {
    const ids = clientIds.slice(i, i + 200);
    const [{ data: sent }, { data: eng }] = await Promise.all([
      db.from('crm_campaign_sends').select('client_id').eq('status', 'sent').in('client_id', ids),
      db.from('email_tracking_events').select('client_id').in('event_type', ['open', 'click']).in('client_id', ids),
    ]);
    for (const r of sent ?? []) proven.add(r.client_id as string);
    for (const r of eng ?? []) proven.add(r.client_id as string);
  }
  const riskyDomains = new Set<string>();
  const { data: dead } = await db.from('crm_dead_emails').select('email');
  for (const d of dead ?? []) { const dom = domainOf(String(d.email)); if (dom && !FREE_MAIL.has(dom)) riskyDomains.add(dom); }
  return { riskyDomains, proven };
}

export function addressRisk(c: { id: string; email: string | null; first_name?: string | null; last_name?: string | null }, ctx: RiskContext): Risk | null {
  if (!c.email) return null;
  const dom = domainOf(c.email);
  if (!dom || FREE_MAIL.has(dom)) return null;
  if (looksGuessed(c.email, c.first_name, c.last_name)) return 'guessed-pattern';
  if (ctx.riskyDomains.has(dom)) return 'bounced-domain';
  return null;
}

/** Rough chance this address bounces, for the pre-send estimate. */
export function bounceChance(c: { id: string; email: string | null; first_name?: string | null; last_name?: string | null }, ctx: RiskContext): number {
  if (ctx.proven.has(c.id)) return RISK_RATE.proven;
  if (!c.email) return 0;
  const dom = domainOf(c.email);
  if (FREE_MAIL.has(dom)) return RISK_RATE.free;
  const r = addressRisk(c, ctx);
  return r === 'guessed-pattern' ? RISK_RATE.guessed : r === 'bounced-domain' ? RISK_RATE.bouncedDomain : RISK_RATE.corporate;
}
