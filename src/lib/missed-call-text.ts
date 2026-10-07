/**
 * Missed-call text-back: "Sorry we missed your call" within minutes, so a lead who
 * hit voicemail (or hung up while it rang) hears from us before they call a competitor.
 *
 * SAFETY: OFF unless MISSED_CALL_TEXTBACK says otherwise.
 *   unset / 'off' — never sends
 *   'test'        — sends ONLY to numbers in MISSED_CALL_TEXTBACK_TEST_NUMBERS
 *   'on'          — sends to every eligible caller in MISSED_CALL_TEXTBACK_UNITS
 *                   (default 'commercial')
 *
 * Eligible = a real inbound Talkroute call nobody reached (missed, a hang-up under
 * a minute, or a voicemail), still waiting on a call-back, inside business hours,
 * not texted yet. Never: calls the bot took, spam/robocalls, our own or our team's
 * numbers, toll-free numbers, anyone who texted STOP, anyone we texted in the last
 * 24 h, calls older than 16 h. Max 15 per run. The text goes from the number they
 * dialed, so a reply lands in the Calling Log's Texts view.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { last10, toE164 } from '@/lib/phone';
import { isBusinessOpen, sendText, talkrouteConfigured } from '@/lib/talkroute';
import { junkKind } from '@/lib/call-routing';

const MAX_PER_RUN = 15;
const MAX_AGE_H = 16;
const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*\W*$/i;

export type TextbackMode = 'off' | 'test' | 'on';
export const textbackMode = (): TextbackMode => {
  const m = (process.env.MISSED_CALL_TEXTBACK ?? 'off').trim().toLowerCase();
  return m === 'on' || m === 'test' ? m : 'off';
};
const testNumbers = () => new Set((process.env.MISSED_CALL_TEXTBACK_TEST_NUMBERS ?? '').split(',').map(n => last10(n)).filter(d => d.length === 10));
const enabledUnits = () => (process.env.MISSED_CALL_TEXTBACK_UNITS ?? 'commercial').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export function textbackBody(company: string, firstName: string | null): string {
  const who = firstName ? `${firstName} with ${company}` : company;
  return `Hi, this is ${who}. Sorry we missed your call! What can we help you with? Reply here or we'll call you back shortly. (Reply STOP to opt out.)`;
}

export interface TextbackPlanRow { call_id: string; unit: string; to: string; from: string; body: string }

export async function sendMissedCallTexts(db: SupabaseClient, opts: { dryRun?: boolean } = {}): Promise<{ mode: TextbackMode; open: boolean; eligible: number; sent: number; failed: number; plan?: TextbackPlanRow[]; skipped: Record<string, number> }> {
  const mode = textbackMode();
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const open = isBusinessOpen();
  const out = { mode, open, eligible: 0, sent: 0, failed: 0, skipped } as { mode: TextbackMode; open: boolean; eligible: number; sent: number; failed: number; plan?: TextbackPlanRow[]; skipped: Record<string, number> };
  if (mode === 'off' && !opts.dryRun) return out;
  if (!opts.dryRun && !talkrouteConfigured()) return out;
  if (!open && !opts.dryRun) return out;

  const since = new Date(Date.now() - MAX_AGE_H * 3600_000).toISOString();
  const { data: calls } = await db.from('crm_call_log')
    .select('id, business_unit, kind, result, direction, from_number, to_number, duration_sec, started_at, intent, summary, outcome, follow_up_assignee, contact_id')
    .eq('source', 'talkroute').eq('direction', 'inbound').eq('answered_by_bot', false)
    .is('handled_at', null).is('textback_status', null)
    // 2-minute grace: someone who rings straight back (or a hang-up still being logged) isn't texted.
    .gte('started_at', since).lte('started_at', new Date(Date.now() - 2 * 60_000).toISOString()).order('started_at');
  const rows = (calls ?? []).filter(c => c.kind === 'voicemail' || c.result === 'missed' || (c.result === 'hangup' && (c.duration_sec ?? 999) < 60));

  const { data: profiles } = await db.from('crm_profiles').select('id, first_name, phone');
  const team = new Set((profiles ?? []).map(p => last10(p.phone)).filter(d => d.length === 10));
  const { data: settings } = await db.from('crm_voicebot_settings').select('business_unit, company_name, talkroute_numbers');
  const ours = new Set((settings ?? []).flatMap(s => (s.talkroute_numbers ?? []) as string[]).map(n => last10(n)));
  const companyOf = new Map((settings ?? []).map(s => [s.business_unit as string, (s.company_name as string) || 'our team']));
  const firstOf = new Map((profiles ?? []).map(p => [p.id as string, (p.first_name as string | null)?.split(' ')[0] ?? null]));
  const units = enabledUnits(), tests = testNumbers();
  const seen = new Set<string>();

  for (const c of rows) {
    if (out.sent + out.failed >= MAX_PER_RUN) break;
    const tail = last10(c.from_number);
    const mark = async (status: string, error?: string) => { if (!opts.dryRun) await db.from('crm_call_log').update({ textback_at: new Date().toISOString(), textback_status: status, textback_error: error ?? null }).eq('id', c.id); };
    if (tail.length !== 10 || /^(800|833|844|855|866|877|888)/.test(tail)) { skip('not a textable number'); await mark('skipped:not textable'); continue; }
    if (ours.has(tail) || team.has(tail)) { skip('our own / team number'); await mark('skipped:internal'); continue; }
    if (junkKind(c) || c.outcome === 'spam') { skip('spam/silent'); await mark('skipped:spam'); continue; }
    if (!units.includes(c.business_unit)) { skip('unit not enabled'); continue; }
    if (mode === 'test' && !tests.has(tail)) { skip('test mode: not a test number'); continue; }
    if (seen.has(tail)) { skip('duplicate caller this run'); continue; }
    seen.add(tail);

    // Opt-outs and recent contact, from the text history.
    const conv = `1${last10(c.to_number)}-1${tail}`;
    const { data: hist } = await db.from('crm_text_messages').select('direction, body, sent_at').eq('conversation_id', conv).order('sent_at', { ascending: false }).limit(30);
    if ((hist ?? []).some(m => m.direction === 'inbound' && STOP.test(m.body ?? ''))) { skip('opted out (STOP)'); await mark('skipped:opted out'); continue; }
    const dayAgo = Date.now() - 86400_000;
    if ((hist ?? []).some(m => m.direction === 'outbound' && new Date(m.sent_at).getTime() > dayAgo)) { skip('texted in the last 24h'); await mark('skipped:recent text'); continue; }
    // Another call from the same number already got a text today.
    const { count: dup } = await db.from('crm_call_log').select('id', { count: 'exact', head: true }).eq('textback_status', 'sent').gte('textback_at', new Date(dayAgo).toISOString()).like('from_number', `%${tail}`);
    if ((dup ?? 0) > 0) { skip('already texted today'); await mark('skipped:already texted'); continue; }

    out.eligible++;
    const body = textbackBody(companyOf.get(c.business_unit) ?? 'our team', c.follow_up_assignee ? firstOf.get(c.follow_up_assignee) ?? null : null);
    const to = toE164(c.from_number)!, from = toE164(c.to_number)!;
    if (opts.dryRun) { (out.plan ??= []).push({ call_id: c.id, unit: c.business_unit, to, from, body }); continue; }
    try {
      const sent = await sendText(conv, body);
      await mark('sent');
      out.sent++;
      await db.from('crm_text_messages').insert({
        business_unit: c.business_unit, source: 'talkroute', external_id: sent?.id ? `msg:${sent.id}` : `textback:${c.id}`,
        conversation_id: conv, direction: 'outbound', from_number: from, to_number: to, body, contact_id: c.contact_id,
        sent_at: new Date().toISOString(), read: true, handled_at: new Date().toISOString(), raw: sent ?? null,
      });
      if (c.contact_id) await db.from('crm_activity').insert({ client_id: c.contact_id, type: 'sms', business_unit: c.business_unit, notes: `Missed-call text sent: ${body.slice(0, 200)}` });
    } catch (e) {
      out.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[missed-call-text]', c.id, msg);
      await mark('failed', msg.slice(0, 300));
    }
  }
  return out;
}
