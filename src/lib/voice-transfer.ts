import type { SupabaseClient } from '@supabase/supabase-js';
import { officeOpen, ownLineNumbers, type VoicebotSettings } from '@/lib/voicebot';
import { toE164 } from '@/lib/phone';

/**
 * Live transfer: the caller asks for a person, Ava rings that agent's CELL. If the agent doesn't pick up, the
 * caller lands in the agent's own cell voicemail and leaves the message there (a carrier voicemail answers the
 * Dial, so from Twilio's side it connected) — while the CRM still logs the call, who it was sent to, how long
 * it rang/talked, and a follow-up to make sure the message is returned.
 *
 * VOICEBOT_TRANSFER = on | off | test (default test). In test mode only the team's own phones can trigger a
 * transfer (so it can be proven on a real call before customers hit it); `off` disables it everywhere.
 */
export type TransferKey = 'zack' | 'brian' | 'ed';
export interface TransferTarget { key: TransferKey; name: string; number: string }

const last10 = (n: string | null | undefined) => (n ?? '').replace(/\D/g, '').slice(-10);

export function transferMode(): 'on' | 'off' | 'test' {
  const m = (process.env.VOICEBOT_TRANSFER || 'test').toLowerCase();
  return m === 'on' || m === 'off' ? m : 'test';
}

/**
 * Who can be rung. Zack = the "Transfer to a person" number in the Calling Log settings (his cell);
 * Brian and Ed = the phone on their CRM profile. Our own lines never count (that would loop the call back to Ava).
 */
export async function transferTargets(db: SupabaseClient, s: VoicebotSettings): Promise<TransferTarget[]> {
  const own = await ownLineNumbers(db);
  const ok = (n: string | null | undefined) => last10(n).length === 10 && !own.has(last10(n));
  const out: TransferTarget[] = [];
  if (ok(s.transfer_number)) out.push({ key: 'zack', name: 'Zack', number: toE164(s.transfer_number)! });
  const { data: profiles } = await db.from('crm_profiles').select('first_name, phone').in('first_name', ['Brian', 'Ed']);
  for (const p of profiles ?? []) {
    const key = String(p.first_name).toLowerCase() as TransferKey;
    if (ok(p.phone as string | null) && !out.some(t => t.key === key)) out.push({ key, name: p.first_name as string, number: toE164(p.phone as string)! });
  }
  return out;
}

/**
 * Is transfer on for THIS call, and to whom? Returns the people the bot may offer, or [] (= no transfer; the bot
 * takes a message instead). Outside office hours only an emergency may transfer (the model says so with urgent=true).
 */
export async function transferOptions(db: SupabaseClient, s: VoicebotSettings, fromNumber: string | null, unit: string): Promise<TransferTarget[]> {
  const mode = transferMode();
  if (mode === 'off') return [];
  const targets = await transferTargets(db, s);
  if (!targets.length) return [];
  if (mode === 'test') {
    // Team phones only, and only ring Zack's cell so a test never wakes anyone else.
    const key = last10(fromNumber);
    if (key.length < 10 || (await ownLineNumbers(db)).has(key)) return [];
    const { internalNumbers } = await import('@/lib/call-history');
    if (!(await internalNumbers(db, unit)).has(key)) return [];
    return targets.filter(t => t.key === 'zack');
  }
  return targets;
}

/** Pick who to ring from the model's `transfer_to` (zack/brian/ed/any); falls back to the first available. */
export function pickTarget(options: TransferTarget[], want: string | null | undefined, at: Date = new Date()): TransferTarget | null {
  if (!options.length) return null;
  const w = (want || '').toLowerCase();
  return options.find(t => t.key === w) ?? options[0];
}

/** Outside Mon–Sat 8–6 CT only a genuine emergency rings a cell phone. */
export function mayRingNow(urgent: boolean, at: Date = new Date()): boolean {
  return urgent || officeOpen(at);
}

/** What the Dial leg did, in words, for the call note / notification. */
export function describeDial(t: { name: string; status: string; durationSec: number | null }): string {
  const d = t.durationSec ?? 0;
  if (t.status === 'completed' && d >= 45) return `Transferred to ${t.name} — connected, ${Math.round(d / 60) || 1} min.`;
  if (t.status === 'completed') return `Transferred to ${t.name} — rang through and the caller most likely left ${t.name} a voicemail on their cell (${d}s). Follow up to make sure it was returned.`;
  if (t.status === 'no-answer') return `Tried ${t.name}'s cell — no answer; Ava took the message instead.`;
  if (t.status === 'busy') return `Tried ${t.name}'s cell — busy; Ava took the message instead.`;
  return `Tried ${t.name}'s cell — could not connect; Ava took the message instead.`;
}
