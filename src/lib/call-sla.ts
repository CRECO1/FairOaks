/**
 * Call-back speed reminders — the phone twin of the web-lead SLA (cron/lead-sla).
 *
 * An open call-back that nobody has returned:
 *   30 business minutes → email whoever it's assigned to,
 *   2 business hours    → email them AND the backup (Zack ↔ Brian).
 * The clock only runs Mon–Sat 8–6 Central, so a 9 pm voicemail isn't "2 hours
 * late" at 11 pm. Each level is sent once per call (crm_call_sla_alerts). Calls
 * from before this shipped are left to the daily digest.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendMonitored } from '@/lib/integration-alert';
import { prettyPhone } from '@/lib/phone';
import { backupFor, businessMinutesSince, zackProfile, type Profile } from '@/lib/call-routing';

export const CALL_SLA_START = '2026-10-06T18:00:00Z';
const NUDGE_MIN = 30;
const ESCALATE_MIN = 120;
const LOOKBACK_HOURS = 96;

/** Zack's CRM login is the Fair Oaks address; his alerts belong in his CRECO inbox. */
const ALERT_INBOX: Record<string, string> = { 'info@fairoaksrealtygroup.com': 'zack@crecotx.com' };

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const span = (m: number) => (m < 120 ? `${m} min` : `${Math.round(m / 60)} hours`);

export async function runCallbackSla(db: SupabaseClient): Promise<{ checked: number; sent: number; results: Array<{ id: string; status: string }> }> {
  const since = new Date(Math.max(Date.parse(CALL_SLA_START), Date.now() - LOOKBACK_HOURS * 3600_000)).toISOString();
  const { data: rows, error } = await db.from('crm_call_log')
    .select('id, business_unit, source, kind, from_number, callback_number, caller_name, contact_id, started_at, summary, intent, ai_meta, follow_up_assignee')
    .eq('needs_follow_up', true).is('handled_at', null).eq('answered_by_bot', false)
    .gte('started_at', since);
  if (error) throw error;
  const calls = rows ?? [];
  if (!calls.length) return { checked: 0, sent: 0, results: [] };

  const { data: profileRows } = await db.from('crm_profiles').select('id, email, first_name, last_name, role');
  const profiles = (profileRows ?? []) as Profile[];
  const byId = new Map(profiles.map(p => [p.id, p]));
  const inbox = (p?: Profile) => (p?.email ? ALERT_INBOX[p.email.toLowerCase()] ?? p.email : null);
  const results: Array<{ id: string; status: string }> = [];
  let sent = 0;

  for (const c of calls) {
    const mins = businessMinutesSince(c.started_at);
    const level = mins >= ESCALATE_MIN ? 2 : mins >= NUDGE_MIN ? 1 : 0;
    if (!level) { results.push({ id: c.id, status: `waiting ${mins}m` }); continue; }
    const { data: already } = await db.from('crm_call_sla_alerts').select('level').eq('call_id', c.id).eq('level', level).maybeSingle();
    if (already) { results.push({ id: c.id, status: `level${level}-already-sent` }); continue; }

    const owner = (c.follow_up_assignee ? byId.get(c.follow_up_assignee) : undefined) ?? zackProfile(profiles);
    const backup = level === 2 ? byId.get(backupFor(owner?.id ?? null, profiles) ?? '') : undefined;
    const to = Array.from(new Set([inbox(owner), inbox(backup)].filter((e): e is string => !!e)));
    const commercial = c.business_unit === 'commercial';
    const key = (commercial ? process.env.RESEND_API_KEY_COMMERCIAL : process.env.RESEND_API_KEY) || process.env.RESEND_API_KEY;
    if (!to.length || !key) { results.push({ id: c.id, status: 'no-recipient' }); continue; }
    const from = commercial && process.env.RESEND_API_KEY_COMMERCIAL ? 'CRECO Call Alerts <noreply@crecotx.com>' : 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>';

    let who = c.caller_name as string | null;
    if (c.contact_id) {
      const { data: k } = await db.from('crm_clients').select('first_name, last_name, business_name').eq('id', c.contact_id).maybeSingle();
      if (k) who = `${k.first_name ?? ''} ${k.last_name ?? ''}`.trim() || k.business_name || who;
    }
    const num = (c.callback_number || c.from_number) as string | null;
    who = who || prettyPhone(num);
    const property = (c.ai_meta as Record<string, unknown> | null)?.property as string | undefined;
    const ownerName = owner?.first_name?.split(' ')[0] || 'the owner';
    const what = c.kind === 'voicemail' ? 'left a voicemail' : c.source === 'voicebot' ? 'talked to the AI receptionist' : 'called and didn’t reach anyone';
    const subject = level === 2
      ? `⚠️ Call-back waiting ${span(mins)}: ${who}${c.intent ? ` — ${c.intent}` : ''} (${ownerName} + backup)`
      : `📞 Call-back waiting ${span(mins)}: ${who}${c.intent ? ` — ${c.intent}` : ''}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A">
        <div style="background:#1A1A1A;color:#fff;padding:16px 20px;border-bottom:3px solid #C9922C">
          <strong style="font-size:16px">${level === 2 ? 'Escalation: call-back still waiting' : 'Call-back reminder'}</strong>
        </div>
        <div style="padding:20px;border:1px solid #E8E5E0;border-top:0">
          <p style="margin:0 0 12px"><strong>${esc(who)}</strong> ${what} ${span(mins)} ago (business hours) and hasn't been called back.${level === 2 ? ` ${esc(ownerName)} has it; this goes to the backup too so someone calls today.` : ''}</p>
          ${num ? `<p style="margin:0 0 12px"><a href="tel:${esc(num)}" style="display:inline-block;padding:10px 18px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">📞 Call ${esc(prettyPhone(num))}</a></p>` : ''}
          ${property ? `<p style="margin:0 0 8px;font-size:14px;color:#555">Asked about: <strong>${esc(property)}</strong></p>` : ''}
          ${c.summary ? `<p style="margin:0 0 16px;padding:12px;background:#FAFAF8;border:1px solid #E8E5E0;font-size:14px;white-space:pre-wrap">${esc(String(c.summary).slice(0, 600))}</p>` : ''}
          <a href="https://www.fairoaksrealtygroup.com/crm/${c.business_unit}#calls" style="display:inline-block;padding:10px 18px;background:#C9922C;color:#1A1A1A;text-decoration:none;border-radius:6px;font-weight:bold">Open the Calling Log</a>
          <p style="margin:16px 0 0;font-size:12px;color:#888">Mark it handled in the Calling Log (or just call them back — the log notices) and these reminders stop.</p>
        </div>
      </div>`;
    const res = await sendMonitored(new Resend(key.replace(/[\r\n\s]+$/, '')), { from, to, subject, html }, 'call_sla_alerts', { label: 'Call-back SLA reminder' });
    if (!res.ok) { results.push({ id: c.id, status: `send-failed: ${res.error}` }); continue; }
    await db.from('crm_call_sla_alerts').insert([{ call_id: c.id, level, sent_to: to }]);
    sent++;
    results.push({ id: c.id, status: `level${level}-sent` });
  }
  return { checked: calls.length, sent, results };
}
