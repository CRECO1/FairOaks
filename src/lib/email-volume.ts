/**
 * How many CAMPAIGN (marketing) emails a workspace may send per day.
 *
 * WHAT THIS CAPS — AND WHAT IT NEVER TOUCHES
 * Only the campaign cron (/api/cron/campaigns) consults this. Transactional mail —
 * lead alerts, inquiry auto-replies, e-signature requests and reminders, listing
 * alerts, the weekly digest — is sent straight from its own route and never passes
 * through a marketing cap, so a blast can't queue ahead of it or stop it. The only
 * shared ceiling is the Resend plan itself; if the plan has a DAILY limit, set
 * RESEND_DAILY_LIMIT_<UNIT> and marketing is held to that limit minus
 * TRANSACTIONAL_DAILY_RESERVE, leaving that many sends for transactional mail every
 * day. (CRECO's account accepted 182 sends on 2026-09-25, so it isn't on the 100/day
 * Free plan; paid plans have no daily limit, only a monthly one.)
 *
 * THE RAMP
 * Volume steps up weekly — 150, then 250, then 400 — but only while the list stays
 * healthy, measured over the trailing HEALTH.windowDays from bounce/complaint events
 * the Resend webhook records in email_tracking_events:
 *
 *   healthy   bounce < 2% and complaints < 0.1%  → the scheduled step
 *   watch     bounce < 5% and complaints < 0.3%  → one step back (never below 150)
 *   brake     anything worse                     → FLOOR (75) until it recovers
 *
 * Below HEALTH.minSample sends there isn't enough signal to judge, so the schedule
 * applies as written. Setting CAMPAIGN_DAILY_CAP_<UNIT> overrides all of this
 * (a number, or 0 for no cap) — for a deliberate, human decision only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const RAMP = {
  /** Step 1 applies from this date; each later step is eligible stepDays later. */
  start: '2026-09-29',
  stepDays: 7,
  steps: [150, 250, 400],
  /** Where the brake drops volume. The pre-ramp cap. */
  floor: 75,
} as const;

export const HEALTH = {
  windowDays: 7,
  minSample: 50,
  advance: { bounce: 0.02, complaint: 0.001 },
  brake: { bounce: 0.05, complaint: 0.003 },
} as const;

/** Sends kept free for transactional mail when the plan has a daily limit. */
export const TRANSACTIONAL_DAILY_RESERVE = 50;

/** Units the ramp governs. Residential has never been capped and still isn't. */
const RAMPED_UNITS = new Set(['commercial']);

export interface CapDecision {
  /** null = no cap. */
  cap: number | null;
  reason: string;
  scheduledStep?: number;
  health?: { sends: number; bounces: number; complaints: number; bounceRate: number; complaintRate: number };
}

export async function marketingDailyCap(db: SupabaseClient, unit: string, now = new Date()): Promise<CapDecision> {
  const key = unit.toUpperCase();
  const override = process.env[`CAMPAIGN_DAILY_CAP_${key}`];
  if (override !== undefined && override !== '') {
    const n = Number(override);
    return Number.isFinite(n) && n > 0 ? { cap: n, reason: 'env override' } : { cap: null, reason: 'env override: no cap' };
  }
  if (!RAMPED_UNITS.has(unit)) return { cap: null, reason: 'unit not ramped' };

  const elapsed = Math.floor((now.getTime() - Date.parse(`${RAMP.start}T00:00:00Z`)) / (RAMP.stepDays * 86400_000));
  const scheduled = Math.min(Math.max(elapsed, 0), RAMP.steps.length - 1);

  const health = await trailingHealth(db, unit, now);
  let cap: number = RAMP.steps[scheduled];
  let reason = `ramp step ${scheduled + 1} of ${RAMP.steps.length}`;
  if (health.sends >= HEALTH.minSample) {
    if (health.bounceRate >= HEALTH.brake.bounce || health.complaintRate >= HEALTH.brake.complaint) {
      cap = RAMP.floor;
      reason = `brake: ${pct(health.bounceRate)} bounce / ${pct(health.complaintRate, 2)} complaints over ${HEALTH.windowDays}d`;
    } else if (health.bounceRate >= HEALTH.advance.bounce || health.complaintRate >= HEALTH.advance.complaint) {
      cap = RAMP.steps[Math.max(scheduled - 1, 0)];
      reason = `watch: held a step back at ${pct(health.bounceRate)} bounce / ${pct(health.complaintRate, 2)} complaints`;
    }
  }

  const planDaily = Number(process.env[`RESEND_DAILY_LIMIT_${key}`]);
  if (Number.isFinite(planDaily) && planDaily > 0 && cap > planDaily - TRANSACTIONAL_DAILY_RESERVE) {
    cap = Math.max(planDaily - TRANSACTIONAL_DAILY_RESERVE, 0);
    reason += `; plan limit ${planDaily}/day minus ${TRANSACTIONAL_DAILY_RESERVE} reserved for transactional`;
  }
  return { cap, reason, scheduledStep: scheduled + 1, health };
}

async function trailingHealth(db: SupabaseClient, unit: string, now: Date) {
  const since = new Date(now.getTime() - HEALTH.windowDays * 86400_000).toISOString();
  const [{ count: sends }, { count: bounces }, { count: complaints }] = await Promise.all([
    db.from('crm_campaign_sends').select('id, campaign:crm_campaigns!inner(business_unit)', { count: 'exact', head: true })
      .eq('type', 'email').in('status', ['sent']).gte('sent_at', since).eq('campaign.business_unit', unit),
    db.from('email_tracking_events').select('id, campaign:crm_campaigns!inner(business_unit)', { count: 'exact', head: true })
      .eq('event_type', 'bounce').gte('occurred_at', since).eq('campaign.business_unit', unit),
    db.from('email_tracking_events').select('id, campaign:crm_campaigns!inner(business_unit)', { count: 'exact', head: true })
      .eq('event_type', 'complaint').gte('occurred_at', since).eq('campaign.business_unit', unit),
  ]);
  const s = sends ?? 0, b = bounces ?? 0, c = complaints ?? 0;
  return { sends: s, bounces: b, complaints: c, bounceRate: s ? b / s : 0, complaintRate: s ? c / s : 0 };
}

const pct = (r: number, digits = 1) => `${(r * 100).toFixed(digits)}%`;
