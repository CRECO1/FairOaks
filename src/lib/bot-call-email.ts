/**
 * Confirmation EMAIL after the AI receptionist takes a lead call, for callers who gave (and confirmed) an email
 * address: "Thanks for calling — here's what we have. Reply to confirm or correct it, and someone on our team will be
 * in touch." This is the working twin of lib/bot-call-text.ts — Talkroute refuses to start a text thread ("Bulk
 * messaging is not enabled"), but email has no such limit. A reply goes to the office inbox.
 *
 * SAFETY: OFF unless BOT_CALL_EMAIL says otherwise.
 *   unset / 'off' — never sends
 *   'test'        — sends ONLY to addresses in BOT_CALL_EMAIL_TEST_ADDRESSES
 *   'on'          — sends to every eligible caller in BOT_CALL_EMAIL_UNITS (default 'commercial')
 *
 * Eligible = a finished bot call on the call-back list with a confirmed email, not yet emailed. Never: spam/silent,
 * vendors, our own or team addresses, anyone unsubscribed, bounced/dead addresses, anyone emailed in the last 24 h.
 * Max 10 per run; calls older than 24 h are skipped. Progress is stored on the call (ai_meta.confirm_email).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { esc, resendConfig } from '@/lib/esign';
import { prettyPhone } from '@/lib/phone';
import { junkKind } from '@/lib/call-routing';

const MAX_PER_RUN = 10;
const MAX_AGE_H = 24;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type BotEmailMode = 'off' | 'test' | 'on';
export const botEmailMode = (): BotEmailMode => {
  const m = (process.env.BOT_CALL_EMAIL ?? 'off').trim().toLowerCase();
  return m === 'on' || m === 'test' ? m : 'off';
};
const testAddresses = () => new Set((process.env.BOT_CALL_EMAIL_TEST_ADDRESSES ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const enabledUnits = () => (process.env.BOT_CALL_EMAIL_UNITS ?? 'commercial').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export function confirmEmail(o: { company: string; name: string | null; phone: string | null; email: string; intent: string | null; property: string | null; lang: 'en' | 'es'; replyTo: string }): { subject: string; html: string; text: string } {
  const es = o.lang === 'es';
  const rows: Array<[string, string]> = [
    [es ? 'Nombre' : 'Name', o.name ?? ''], [es ? 'Teléfono' : 'Phone', o.phone ? prettyPhone(o.phone) : ''], ['Email', o.email],
    [es ? 'Solicitud' : 'Request', o.intent ?? ''], [es ? 'Propiedad' : 'Property', o.property ?? ''],
  ].filter(([, v]) => v) as Array<[string, string]>;
  const subject = es ? `Gracias por llamar a ${o.company} — confirme sus datos` : `Thanks for calling ${o.company} — please confirm your details`;
  const lead = es ? `Gracias por llamar a ${o.company}. Esto es lo que tenemos:` : `Thanks for calling ${o.company}. Here's what we have:`;
  const ask = es ? 'Responda a este correo para confirmar o corregir estos datos, y alguien de nuestro equipo se pondrá en contacto.' : 'Please reply to this email to confirm or correct this, and someone on our team will be in touch.';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="border-bottom:3px solid #c9922c;padding:14px 0 10px"><span style="font-size:20px;font-weight:800;letter-spacing:.5px;color:#c9922c">${esc(o.company)}</span></div>
    <div style="padding:18px 2px;font-size:15px;line-height:1.55">
      <p>${esc(lead)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:15px">${rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>
      <p>${esc(ask)}</p>
    </div>
    <div style="border-top:1px solid #eee;margin-top:14px;padding-top:10px;font-size:11px;color:#9ca3af">${esc(es ? 'Recibió este correo porque llamó a nuestra línea y nos dio esta dirección.' : 'You received this because you called our line and gave us this address.')}</div></div>`;
  const text = `${lead}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${ask}`;
  return { subject, html, text };
}

type Result = { mode: BotEmailMode; eligible: number; sent: number; failed: number; plan?: Array<{ call_id: string; to: string; subject: string }>; skipped: Record<string, number> };

export async function sendBotCallEmails(db: SupabaseClient, opts: { dryRun?: boolean } = {}): Promise<Result> {
  const mode = botEmailMode();
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const out: Result = { mode, eligible: 0, sent: 0, failed: 0, skipped };
  if (mode === 'off' && !opts.dryRun) return out;

  const since = new Date(Date.now() - MAX_AGE_H * 3600_000).toISOString();
  const { data: calls } = await db.from('crm_call_log')
    .select('id, business_unit, caller_name, callback_number, from_number, intent, summary, contact_id, started_at, ai_meta')
    .eq('source', 'voicebot').eq('direction', 'inbound').eq('needs_follow_up', true).not('summary', 'is', null)
    // a 2-minute grace so the summary, number recovery and contact filing have finished
    .gte('started_at', since).lte('started_at', new Date(Date.now() - 2 * 60_000).toISOString()).order('started_at');
  const todo = (calls ?? []).filter(c => !((c.ai_meta ?? {}) as Record<string, unknown>).confirm_email);

  const { data: profiles } = await db.from('crm_profiles').select('email');
  const team = new Set((profiles ?? []).map(p => String(p.email ?? '').toLowerCase()).filter(Boolean));
  const { data: dead } = await db.from('crm_dead_emails').select('email');
  const deadSet = new Set((dead ?? []).map(d => String(d.email).toLowerCase()));
  const { data: settings } = await db.from('crm_voicebot_settings').select('business_unit, company_name');
  const companyOf = new Map((settings ?? []).map(s => [s.business_unit as string, (s.company_name as string) || 'our team']));
  const units = enabledUnits(), tests = testAddresses();
  const seen = new Set<string>();

  for (const c of todo) {
    if (out.sent + out.failed >= MAX_PER_RUN) break;
    const meta = (c.ai_meta ?? {}) as Record<string, unknown>;
    const email = String(meta.caller_email ?? '').trim().toLowerCase();
    if (!email) continue;   // most calls: no email given — not a skip worth recording
    const mark = async (status: string, error?: string) => {
      if (!opts.dryRun) await db.from('crm_call_log').update({ ai_meta: { ...meta, confirm_email: { status, at: new Date().toISOString(), ...(error ? { error } : {}) } }, updated_at: new Date().toISOString() }).eq('id', c.id);
    };
    if (!EMAIL.test(email)) { skip('not a valid email'); await mark('skipped:invalid'); continue; }
    if (junkKind(c)) { skip('spam/silent'); await mark('skipped:spam'); continue; }
    if (meta.lead_type === 'vendor') { skip('vendor'); await mark('skipped:vendor'); continue; }
    if (team.has(email) || /@(crecotx\.com|fairoaksrealtygroup\.com)$/.test(email)) { skip('our own / team address'); await mark('skipped:internal'); continue; }
    if (deadSet.has(email)) { skip('dead address'); await mark('skipped:dead'); continue; }
    if (!units.includes(c.business_unit)) { skip('unit not enabled'); continue; }
    if (mode === 'test' && !tests.has(email)) { skip('test mode: not a test address'); continue; }
    if (seen.has(email)) { skip('duplicate address this run'); continue; }
    seen.add(email);

    const { data: unsub } = await db.from('crm_clients').select('id').ilike('email', email).not('unsubscribed_at', 'is', null).limit(1);
    if (unsub?.length) { skip('unsubscribed'); await mark('skipped:unsubscribed'); continue; }
    // already emailed this address in the last day (another call)
    const { data: recent } = await db.from('crm_call_log').select('id').eq('source', 'voicebot').neq('id', c.id).filter('ai_meta->confirm_email->>status', 'eq', 'sent').filter('ai_meta->>caller_email', 'ilike', email).gte('started_at', new Date(Date.now() - 86400_000).toISOString()).limit(1);
    if (recent?.length) { skip('emailed in the last 24h'); await mark('skipped:recent'); continue; }

    out.eligible++;
    const { from, apiKey } = resendConfig(c.business_unit);
    const replyTo = from.match(/<([^>]+)>/)?.[1] ?? from;
    const mail = confirmEmail({ company: companyOf.get(c.business_unit) ?? 'our team', name: c.caller_name, phone: c.callback_number || c.from_number, email, intent: c.intent, property: (meta.property as string | null) ?? null, lang: meta.language === 'es' ? 'es' : 'en', replyTo });
    if (opts.dryRun) { (out.plan ??= []).push({ call_id: c.id, to: email, subject: mail.subject }); continue; }
    if (!apiKey) { out.failed++; await mark('failed', 'no Resend key'); continue; }
    try {
      const { error } = await new Resend(apiKey).emails.send({ from, to: email, replyTo, subject: mail.subject, html: mail.html, text: mail.text });
      if (error) throw new Error(error.message);
      await mark('sent'); out.sent++;
      if (c.contact_id) await db.from('crm_activity').insert({ client_id: c.contact_id, type: 'email', business_unit: c.business_unit, notes: `Confirmation email sent after the call: ${mail.subject}` });
    } catch (e) {
      out.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[bot-call-email]', c.id, msg);
      await mark('failed', msg.slice(0, 300));
    }
  }
  return out;
}
