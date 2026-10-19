/**
 * Text follow-up after the AI receptionist takes a lead call: "Thanks for calling — here's what we have (name, number,
 * what you asked about). Reply to confirm or correct it, and someone on our team will be in touch."
 * The reply lands in the Calling Log's Texts view on the same line the caller dialed, so a correction is seen by the team.
 *
 * SAFETY: OFF unless BOT_CALL_TEXT says otherwise (same pattern as lib/missed-call-text.ts).
 *   unset / 'off' — never sends
 *   'test'        — sends ONLY to numbers in BOT_CALL_TEXT_TEST_NUMBERS
 *   'on'          — sends to every eligible caller in BOT_CALL_TEXT_UNITS (default 'commercial')
 *
 * Eligible = a finished bot call that is on the call-back list with a real, textable caller number and a name or
 * request on file, 8am–8:30pm Central only (a later run picks up the overnight ones). Never: spam/silent/wrong
 * numbers, vendors, our own or our team's numbers, toll-free numbers, anyone who texted STOP, anyone we texted in the
 * last 24 h, calls older than 16 h. Max 10 per run. Spanish callers get Spanish.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { last10, prettyPhone, toE164 } from '@/lib/phone';
import { sendText, talkrouteConfigured } from '@/lib/talkroute';
import { junkKind } from '@/lib/call-routing';
import { LEAD_LABEL, type LeadType } from '@/lib/voicebot';

const MAX_PER_RUN = 10;
const MAX_AGE_H = 16;
const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|parar|alto)\s*\W*$/i;

export type BotTextMode = 'off' | 'test' | 'on';
export const botTextMode = (): BotTextMode => {
  const m = (process.env.BOT_CALL_TEXT ?? 'off').trim().toLowerCase();
  return m === 'on' || m === 'test' ? m : 'off';
};
const testNumbers = () => new Set((process.env.BOT_CALL_TEXT_TEST_NUMBERS ?? '').split(',').map(n => last10(n)).filter(d => d.length === 10));
const enabledUnits = () => (process.env.BOT_CALL_TEXT_UNITS ?? 'commercial').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/** 8:00 a.m.–8:30 p.m. Central, any day: nobody gets a text at night. */
export function textableNow(at: Date = new Date()): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(at).map(x => [x.type, x.value]));
  const mins = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return mins >= 8 * 60 && mins < 20 * 60 + 30;
}

export function botTextBody(o: { company: string; name: string | null; phone: string | null; intent: string | null; lang: 'en' | 'es' }): string {
  const have = [o.name, o.phone ? prettyPhone(o.phone) : null, o.intent].filter(Boolean).join(', ');
  if (o.lang === 'es') {
    return `Gracias por llamar a ${o.company}. Esto es lo que tenemos: ${have}. Responda a este mensaje para confirmar o corregir, y alguien de nuestro equipo se pondrá en contacto. (Responda STOP para no recibir más mensajes.)`;
  }
  return `Thanks for calling ${o.company}. Here's what we have: ${have}. Please reply to confirm or correct it, and someone on our team will be in touch. (Reply STOP to opt out.)`;
}

export interface BotTextPlanRow { call_id: string; unit: string; to: string; from: string; body: string }
type Result = { mode: BotTextMode; eligible: number; sent: number; failed: number; plan?: BotTextPlanRow[]; skipped: Record<string, number> };

export async function sendBotCallTexts(db: SupabaseClient, opts: { dryRun?: boolean; ignoreHours?: boolean } = {}): Promise<Result> {
  const mode = botTextMode();
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const out: Result = { mode, eligible: 0, sent: 0, failed: 0, skipped };
  if (mode === 'off' && !opts.dryRun) return out;
  if (!opts.dryRun && !talkrouteConfigured()) return out;
  if (!opts.dryRun && !opts.ignoreHours && !textableNow()) return out;

  const since = new Date(Date.now() - MAX_AGE_H * 3600_000).toISOString();
  const { data: calls } = await db.from('crm_call_log')
    .select('id, business_unit, from_number, caller_name, callback_number, intent, summary, needs_follow_up, contact_id, started_at, ai_meta')
    .eq('source', 'voicebot').eq('direction', 'inbound').eq('needs_follow_up', true).is('textback_status', null)
    .not('summary', 'is', null)
    // the summary lands when the call ends; a 2-minute grace lets the number recovery and contact filing finish first
    .gte('started_at', since).lte('started_at', new Date(Date.now() - 2 * 60_000).toISOString()).order('started_at');

  const { data: profiles } = await db.from('crm_profiles').select('phone');
  const team = new Set((profiles ?? []).map(p => last10(p.phone)).filter(d => d.length === 10));
  const { data: settings } = await db.from('crm_voicebot_settings').select('business_unit, company_name, talkroute_numbers, twilio_number');
  const ours = new Set((settings ?? []).flatMap(s => [...((s.talkroute_numbers ?? []) as string[]), s.twilio_number as string]).map(n => last10(n)));
  const lineOf = new Map((settings ?? []).map(s => [s.business_unit as string, ((s.talkroute_numbers ?? []) as string[])[0] ?? null]));
  const companyOf = new Map((settings ?? []).map(s => [s.business_unit as string, (s.company_name as string) || 'our team']));
  const units = enabledUnits(), tests = testNumbers();
  const seen = new Set<string>();

  for (const c of calls ?? []) {
    if (out.sent + out.failed >= MAX_PER_RUN) break;
    const meta = (c.ai_meta ?? {}) as Record<string, unknown>;
    const number = c.callback_number || c.from_number;
    const tail = last10(number);
    const mark = async (status: string, error?: string) => {
      if (!opts.dryRun) await db.from('crm_call_log').update({ textback_at: new Date().toISOString(), textback_status: `bot:${status}`, textback_error: error ?? null }).eq('id', c.id);
    };
    if (tail.length !== 10 || /^(800|833|844|855|866|877|888)/.test(tail)) { skip('not a textable number'); await mark('skipped:not textable'); continue; }
    if (ours.has(tail) || team.has(tail)) { skip('our own / team number'); await mark('skipped:internal'); continue; }
    if (junkKind(c)) { skip('spam/silent'); await mark('skipped:spam'); continue; }
    if (meta.lead_type === 'vendor') { skip('vendor'); await mark('skipped:vendor'); continue; }
    if (!c.caller_name && !c.intent) { skip('nothing to confirm'); await mark('skipped:no info'); continue; }
    if (!units.includes(c.business_unit)) { skip('unit not enabled'); continue; }
    if (mode === 'test' && !tests.has(tail)) { skip('test mode: not a test number'); continue; }
    if (seen.has(tail)) { skip('duplicate caller this run'); continue; }
    seen.add(tail);

    const line = lineOf.get(c.business_unit);
    if (!line) { skip('no text line for this unit'); continue; }
    const conv = `1${last10(line)}-1${tail}`;
    const { data: hist } = await db.from('crm_text_messages').select('direction, body, sent_at').eq('conversation_id', conv).order('sent_at', { ascending: false }).limit(30);
    if ((hist ?? []).some(m => m.direction === 'inbound' && STOP.test(m.body ?? ''))) { skip('opted out (STOP)'); await mark('skipped:opted out'); continue; }
    const dayAgo = Date.now() - 86400_000;
    if ((hist ?? []).some(m => m.direction === 'outbound' && new Date(m.sent_at).getTime() > dayAgo)) { skip('texted in the last 24h'); await mark('skipped:recent text'); continue; }
    const { count: dup } = await db.from('crm_call_log').select('id', { count: 'exact', head: true }).like('textback_status', 'bot:sent').gte('textback_at', new Date(dayAgo).toISOString()).or(`from_number.like.%${tail},callback_number.like.%${tail}`);
    if ((dup ?? 0) > 0) { skip('already texted today'); await mark('skipped:already texted'); continue; }

    out.eligible++;
    const lt = meta.lead_type as LeadType | undefined;
    const body = botTextBody({
      company: companyOf.get(c.business_unit) ?? 'our team', name: c.caller_name, phone: number,
      intent: c.intent || (lt && lt !== 'other' ? LEAD_LABEL[lt] : null),
      lang: meta.language === 'es' ? 'es' : 'en',
    });
    const to = toE164(number)!, from = toE164(line)!;
    if (opts.dryRun) { (out.plan ??= []).push({ call_id: c.id, unit: c.business_unit, to, from, body }); continue; }
    try {
      const sent = await sendText(conv, body);
      await mark('sent');
      out.sent++;
      await db.from('crm_text_messages').insert({
        business_unit: c.business_unit, source: 'talkroute', external_id: sent?.id ? `msg:${sent.id}` : `bottext:${c.id}`,
        conversation_id: conv, direction: 'outbound', from_number: from, to_number: to, body, contact_id: c.contact_id,
        sent_at: new Date().toISOString(), read: true, handled_at: new Date().toISOString(), raw: sent ?? null,
      });
      if (c.contact_id) await db.from('crm_activity').insert({ client_id: c.contact_id, type: 'sms', business_unit: c.business_unit, notes: `Confirmation text sent after the call: ${body.slice(0, 200)}` });
    } catch (e) {
      out.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[bot-call-text]', c.id, msg);
      await mark('failed', msg.slice(0, 300));
    }
  }
  return out;
}
