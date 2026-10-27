import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase-admin';
import { PUSH_CATEGORIES, type PushCategory } from '@/lib/push-categories';
import { canSeeVisitorActivity } from '@/lib/visitor-privacy';

/**
 * Phone alerts (web push) for CRM agents — the bell, but it reaches you when the CRM is closed.
 *
 * Mirrors the TORCH app's push: VAPID keys in env, one `crm_push_subscriptions` row per device, dead devices
 * (404/410) pruned on send. Each device also picks WHICH kinds of alert it wants (`categories`), because a
 * phone that buzzes for every site visit gets muted, and then it misses the lead.
 *
 * Never throws. Callers are webhooks, crons and assignment routes, and an alert is never worth failing them.
 */

export { PUSH_CATEGORIES, DEFAULT_PUSH_CATEGORIES, type PushCategory } from '@/lib/push-categories';
const VALID = new Set<string>(PUSH_CATEGORIES.map(c => c.key));

export function cleanCategories(input: unknown): PushCategory[] {
  return Array.isArray(input) ? ([...new Set(input.filter((x): x is string => typeof x === 'string' && VALID.has(x)))] as PushCategory[]) : [];
}

export type PushPayload = {
  title: string;
  body: string;
  /** Where tapping it goes: a path under /crm (e.g. /crm/commercial#tasks). */
  url?: string;
  /** Same tag replaces the earlier alert instead of stacking (e.g. one per call). */
  tag?: string;
  category: PushCategory;
  /** Which CRM this alert belongs to. Phone alerts are for the crecotx.com (commercial) CRM only. */
  businessUnit?: string | null;
};

/** Phone alerts exist for the CRECO / crecotx.com workspace only (Zack, Oct 2026). Residential never sends. */
export const PUSH_BUSINESS_UNIT = 'commercial';

export const pushConfigured = () => !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let configured = false;
function setup() {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@fairoaksrealtygroup.com', process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

/** Only ever send people somewhere inside the CRM. */
const safeUrl = (u?: string) => (u && u.startsWith('/crm') ? u.slice(0, 300) : '/crm');

/**
 * Send to every device of the given agents that opted in to `category`.
 * `ignoreCategory` is for the "send me a test" button, which must reach the device whatever it filters.
 */
export async function sendPushToProfiles(
  profileIds: (string | null | undefined)[],
  p: PushPayload,
  opts: { ignoreCategory?: boolean; db?: SupabaseClient } = {},
): Promise<{ sent: number; devices: number }> {
  const out = { sent: 0, devices: 0 };
  try {
    if (p.businessUnit && p.businessUnit !== PUSH_BUSINESS_UNIT) return out;
    let ids = [...new Set(profileIds.filter((x): x is string => !!x))];
    if (!pushConfigured() || !ids.length) return out;
    setup();
    const db = opts.db ?? adminClient();
    // Site-visit pings are for the account owner only, whoever the caller listed (see visitor-privacy.ts).
    if (p.category === 'visitors') {
      const { data: roles } = await db.from('crm_profiles').select('id, role').in('id', ids);
      ids = (roles ?? []).filter(r => canSeeVisitorActivity(r.role as string)).map(r => r.id as string);
      if (!ids.length) return out;
    }
    let q = db.from('crm_push_subscriptions').select('id, endpoint, p256dh, auth').in('profile_id', ids);
    if (!opts.ignoreCategory) q = q.contains('categories', [p.category]);
    const { data: subs } = await q;
    out.devices = subs?.length ?? 0;
    if (!subs?.length) return out;

    const payload = JSON.stringify({ title: p.title.slice(0, 120), body: p.body.slice(0, 240), url: safeUrl(p.url), tag: p.tag });
    const dead: string[] = [];
    await Promise.all(subs.map(async s => {
      try {
        // A stale "new lead" is worse than none: drop it if the phone is off for a few hours.
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 6, urgency: 'high' });
        out.sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
        else console.error(`[push] send failed (${status ?? '?'}):`, e instanceof Error ? e.message : e);
      }
    }));
    if (dead.length) await db.from('crm_push_subscriptions').delete().in('id', dead);
    if (out.sent) await db.from('crm_push_subscriptions').update({ last_sent_at: new Date().toISOString() }).in('id', subs.map(s => s.id).filter(id => !dead.includes(id)));
  } catch (e) {
    console.error('[push]', e instanceof Error ? e.message : e);
  }
  return out;
}

/**
 * Login emails ≠ alert emails: Zack signs in as info@fairoaksrealtygroup.com but his alerts go to
 * zack@crecotx.com (see known-contact-alert.ts). Resolve an email list to profile ids, matching either.
 */
const ALIAS: Record<string, string> = { 'zack@crecotx.com': 'info@fairoaksrealtygroup.com', 'info@fairoaksrealtygroup.com': 'zack@crecotx.com' };
export async function profileIdsForEmails(emails: (string | null | undefined)[], db: SupabaseClient = adminClient()): Promise<string[]> {
  const wanted = new Set<string>();
  for (const e of emails) {
    const v = String(e ?? '').trim().toLowerCase();
    if (!v) continue;
    wanted.add(v);
    if (ALIAS[v]) wanted.add(ALIAS[v]);
  }
  if (!wanted.size) return [];
  const { data } = await db.from('crm_profiles').select('id, email').in('email', [...wanted]);
  return (data ?? []).map(r => r.id as string);
}

/** The broker(s): super admins, who are copied on everything that executes. */
export async function superAdminIds(db: SupabaseClient = adminClient()): Promise<string[]> {
  const { data } = await db.from('crm_profiles').select('id').eq('role', 'super_admin');
  return (data ?? []).map(r => r.id as string);
}
