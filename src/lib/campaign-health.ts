/**
 * Per-campaign bounce circuit breaker + first-batch canary.
 *
 * lib/email-volume.ts already slows the WHOLE workspace when its trailing bounce rate is bad, but it only caps
 * daily volume — it never stops a campaign that is mailing a dirty list. (AutoBrite Pad — Broker Blast bounced
 * 29 of its first 56 sends before anyone noticed.) This stops it at the campaign:
 *
 *   canary   a campaign with fewer than CANARY prior sends releases at most CANARY emails per run, so the first
 *            15-minute window is a small sample — bounces arrive within minutes — rather than a full batch of 50.
 *   breaker  once a campaign has MIN_SENDS sends in the last WINDOW_DAYS, a bounce rate at or above MAX_RATE
 *            PAUSES the campaign (status 'paused', the same state the Pause button sets) and alerts the owner.
 *            Resuming is a deliberate human step after the list is cleaned.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const CANARY = 25;
export const BREAKER = { minSends: 25, maxRate: 0.08, windowDays: 3 } as const;

export interface CampaignHealth { sends: number; allTimeSends: number; bounced: number; rate: number }

export async function campaignHealth(db: SupabaseClient, campaignId: string): Promise<CampaignHealth> {
  const since = new Date(Date.now() - BREAKER.windowDays * 86_400_000).toISOString();
  const [{ count: recent }, { count: all }, { data: bounces }] = await Promise.all([
    db.from('crm_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'sent').gte('sent_at', since),
    db.from('crm_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'sent'),
    db.from('email_tracking_events').select('client_id').eq('campaign_id', campaignId).eq('event_type', 'bounce').gte('occurred_at', since),
  ]);
  const bounced = new Set((bounces ?? []).map(b => b.client_id as string)).size;
  const sends = recent ?? 0;
  return { sends, allTimeSends: all ?? 0, bounced, rate: sends ? bounced / sends : 0 };
}

export const breakerTripped = (h: CampaignHealth) => h.sends >= BREAKER.minSends && h.rate >= BREAKER.maxRate;
