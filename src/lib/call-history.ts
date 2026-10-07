/**
 * Caller history for the Calling Log: for each call, what happened the previous times
 * this number rang — so "3rd call, never reached" is visible on the row instead of
 * hiding in a flat list. 42% of calls come from people who have called before.
 *
 * Also works out which numbers are INTERNAL (our lines, the team's phones, and the
 * phones Talkroute forwards to — e.g. the owner's cell), so calls between us don't
 * clutter the log.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { last10 } from '@/lib/phone';

export interface HistoryCall {
  id: string; direction: string; result: string | null; kind: string; source: string;
  from_number: string | null; to_number: string | null; started_at: string; duration_sec: number | null;
  answered_by: string | null; answered_by_bot: boolean; notes: string | null; summary: string | null; intent: string | null;
}
export interface CallerHistory {
  prior: number; first_at: string;
  /** A person on our side has actually talked with them before (answered, or we called and connected). */
  reached: boolean;
  last: { at: string; label: string; by: string | null; note: string | null };
}

/** The other party's number on a call (who rang us, or whom we rang). */
export const otherParty = (c: Pick<HistoryCall, 'direction' | 'from_number' | 'to_number'>) => last10(c.direction === 'outbound' ? c.to_number : c.from_number);

const lastLabel = (c: HistoryCall): string => {
  if (c.source === 'voicebot') return 'talked to the receptionist';
  if (c.kind === 'voicemail') return 'left a voicemail';
  if (c.direction === 'outbound') return (c.duration_sec ?? 0) >= 20 ? 'we called them' : 'we tried them';
  if (c.result === 'missed') return 'missed';
  if (c.result === 'hangup') return 'hung up';
  return 'answered';
};
const humanReached = (c: HistoryCall) =>
  (c.direction === 'inbound' && c.result === 'answered' && !!c.answered_by) ||
  (c.direction === 'outbound' && (c.duration_sec ?? 0) >= 20) || c.source === 'manual';

export function buildHistory(calls: HistoryCall[], names: Map<string, string>): (row: { id: string; direction: string; from_number: string | null; to_number: string | null; started_at: string }) => CallerHistory | null {
  const byTail = new Map<string, HistoryCall[]>();
  for (const c of calls) {
    if (c.answered_by_bot) continue;                 // the Talkroute leg of a bot call — the bot's own row is the call
    const t = otherParty(c);
    if (t.length === 10) (byTail.get(t) ?? byTail.set(t, []).get(t)!).push(c);
  }
  for (const list of byTail.values()) list.sort((a, b) => a.started_at.localeCompare(b.started_at));
  return row => {
    const t = otherParty(row);
    const prior = (byTail.get(t) ?? []).filter(c => c.id !== row.id && c.started_at < row.started_at);
    if (!prior.length) return null;
    const last = prior[prior.length - 1];
    const note = (last.notes || last.summary || last.intent || '').replace(/\s+/g, ' ').trim();
    return {
      prior: prior.length, first_at: prior[0].started_at, reached: prior.some(humanReached),
      last: { at: last.started_at, label: lastLabel(last), by: last.answered_by ? names.get(last.answered_by) ?? null : null, note: note ? note.slice(0, 90) : null },
    };
  };
}

/** Our own lines, the team's phones, and every phone Talkroute has forwarded a call to. */
export async function internalNumbers(db: SupabaseClient, unit: string): Promise<Set<string>> {
  const out = new Set<string>();
  const [{ data: profiles }, { data: settings }, { data: answered }] = await Promise.all([
    db.from('crm_profiles').select('phone'),
    db.from('crm_voicebot_settings').select('talkroute_numbers, twilio_number'),
    db.from('crm_call_log').select('raw').eq('business_unit', unit).eq('source', 'talkroute').eq('result', 'answered')
      .gte('started_at', new Date(Date.now() - 120 * 86_400_000).toISOString()).limit(400),
  ]);
  for (const p of profiles ?? []) out.add(last10(p.phone));
  for (const s of settings ?? []) { out.add(last10(s.twilio_number)); for (const n of (s.talkroute_numbers ?? []) as string[]) out.add(last10(n)); }
  // "Call answered by _Primary Forward Number_ - _1 (210) 355-8683_" — the number that picked up is one of ours.
  for (const r of answered ?? []) {
    for (const e of ((r.raw as { events?: Array<{ description?: string }> } | null)?.events ?? [])) {
      const m = e.description?.match(/answered by _[^_]+_ - _1? ?\(?(\d{3})\)? ?(\d{3})-?(\d{4})_/i);
      if (m) out.add(m[1] + m[2] + m[3]);
    }
  }
  out.delete('');
  return out;
}
