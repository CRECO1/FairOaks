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

/**
 * INSTANT missed-call alert — the owner's phone buzzes within a couple of minutes of a
 * call nobody reached, instead of waiting for the 30-minute reminder. (The caller can't
 * be texted: Talkroute refuses to start a new text thread — "Bulk messaging is not
 * enabled" — so speed to call-back is the lever we control.)
 *
 * Fires once per call (crm_call_sla_alerts level 0) for an inbound Talkroute call that
 * was missed, hung up on within a minute, or left a voicemail, and is still open, inside
 * business hours. To the call's owner (tidyCallLog assigns one). Never for: calls the
 * bot took (it emails its own summary), spam/silent, our own or team numbers, or a
 * number already alerted in the last 30 minutes (one alert per person, not per redial).
 */
import { last10 as tail10 } from '@/lib/phone';
import { isBusinessOpen } from '@/lib/talkroute';
import { junkKind } from '@/lib/call-routing';

const INSTANT_MAX_AGE_MIN = 90;

export async function sendInstantMissedAlerts(db: SupabaseClient, opts: { minAgeSec?: number; onlyCallId?: string; testTo?: string } = {}): Promise<{ checked: number; sent: number; results: Array<{ id: string; status: string }> }> {
  const results: Array<{ id: string; status: string }> = [];
  if (!isBusinessOpen() && !opts.testTo) return { checked: 0, sent: 0, results };
  const since = new Date(Date.now() - INSTANT_MAX_AGE_MIN * 60_000).toISOString();
  const until = new Date(Date.now() - (opts.minAgeSec ?? 0) * 1000).toISOString();
  let q = db.from('crm_call_log')
    .select('id, business_unit, kind, result, duration_sec, from_number, to_number, callback_number, caller_name, contact_id, started_at, summary, transcript, intent, outcome, follow_up_assignee')
    .eq('source', 'talkroute').eq('direction', 'inbound').eq('answered_by_bot', false)
    .gte('started_at', opts.testTo ? new Date(Date.now() - 14 * 86_400_000).toISOString() : since).lte('started_at', until).order('started_at');
  // Real runs only look at calls still waiting on a call-back; a test render may use any call.
  if (!opts.testTo) q = q.eq('needs_follow_up', true).is('handled_at', null);
  if (opts.onlyCallId) q = q.eq('id', opts.onlyCallId);
  const { data: rows } = await q;
  const calls = (rows ?? []).filter(c => c.kind === 'voicemail' || c.result === 'missed' || (c.result === 'hangup' && (c.duration_sec ?? 999) < 60));
  if (!calls.length) return { checked: 0, sent: 0, results };

  const { data: profileRows } = await db.from('crm_profiles').select('id, email, first_name, last_name, role, phone');
  const profiles = (profileRows ?? []) as (Profile & { phone: string | null })[];
  const byId = new Map(profiles.map(p => [p.id, p]));
  const team = new Set(profiles.map(p => tail10(p.phone)).filter(d => d.length === 10));
  const { data: st } = await db.from('crm_voicebot_settings').select('talkroute_numbers');
  const ours = new Set((st ?? []).flatMap(s => (s.talkroute_numbers ?? []) as string[]).map(n => tail10(n)));
  const inbox = (p?: Profile) => (p?.email ? ALERT_INBOX[p.email.toLowerCase()] ?? p.email : null);
  const half = new Date(Date.now() - 30 * 60_000).toISOString();
  let sent = 0;
  const alertedNow = new Set<string>();

  for (const c of calls) {
    const num = (c.callback_number || c.from_number) as string | null;
    const tail = tail10(num);
    if (!opts.testTo) {
      const { data: already } = await db.from('crm_call_sla_alerts').select('level').eq('call_id', c.id).eq('level', 0).maybeSingle();
      if (already) { results.push({ id: c.id, status: 'already-alerted' }); continue; }
    }
    const skip = async (why: string) => { results.push({ id: c.id, status: `skip:${why}` }); if (!opts.testTo) await db.from('crm_call_sla_alerts').insert([{ call_id: c.id, level: 0, sent_to: [`skipped:${why}`] }]); };
    if (tail.length !== 10) { await skip('no number'); continue; }
    if (ours.has(tail) || team.has(tail)) { await skip('internal'); continue; }
    if (junkKind(c) || c.outcome === 'spam') { await skip('spam'); continue; }
    if (alertedNow.has(tail)) { results.push({ id: c.id, status: 'same-caller-this-run' }); continue; }
    if (!opts.testTo) {
      // One alert per person: a redial within 30 minutes doesn't buzz the owner again.
      const { data: recent } = await db.from('crm_call_log').select('id').neq('id', c.id).like('from_number', `%${tail}`).gte('started_at', half);
      const ids = (recent ?? []).map(r => r.id);
      if (ids.length) {
        const { data: prior } = await db.from('crm_call_sla_alerts').select('call_id, sent_to').eq('level', 0).in('call_id', ids);
        // Skip markers ('skipped:<why>') are not alerts — only a real send counts.
        if ((prior ?? []).some(p => ((p.sent_to ?? []) as string[]).some(x => !x.startsWith('skipped:')))) { await skip('alerted-recently'); continue; }
      }
    }
    alertedNow.add(tail);

    const owner = (c.follow_up_assignee ? byId.get(c.follow_up_assignee) : undefined) ?? zackProfile(profiles);
    const to = opts.testTo ? [opts.testTo] : [inbox(owner)].filter((e): e is string => !!e);
    const commercial = c.business_unit === 'commercial';
    const key = (commercial ? process.env.RESEND_API_KEY_COMMERCIAL : process.env.RESEND_API_KEY) || process.env.RESEND_API_KEY;
    if (!to.length || !key) { results.push({ id: c.id, status: 'no-recipient' }); continue; }
    const from = commercial && process.env.RESEND_API_KEY_COMMERCIAL ? 'CRECO Call Alerts <noreply@crecotx.com>' : 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>';

    let who = (c.caller_name as string | null) ?? null, ctxLine = '';
    if (c.contact_id) {
      const { data: k } = await db.from('crm_clients').select('first_name, last_name, business_name, type').eq('id', c.contact_id).maybeSingle();
      if (k) {
        who = `${k.first_name ?? ''} ${k.last_name ?? ''}`.trim() || k.business_name || who;
        ctxLine = [k.business_name && who !== k.business_name ? k.business_name : null, k.type].filter(Boolean).join(' · ');
      }
    }
    const { count: priorCalls } = await db.from('crm_call_log').select('id', { count: 'exact', head: true }).like('from_number', `%${tail}`).lt('started_at', c.started_at).eq('direction', 'inbound');
    const when = new Date(c.started_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
    const ownerName = owner?.first_name?.split(' ')[0] || 'you';
    const what = c.kind === 'voicemail' ? 'left a voicemail' : (c.duration_sec ?? 0) > 0 && c.result === 'hangup' ? 'called and hung up before anyone picked up' : 'called and nobody picked up';
    const label = who || prettyPhone(num);
    const vm = c.kind === 'voicemail' ? (c.transcript as string | null) : null;
    const subject = `${opts.testTo ? '[TEST] ' : ''}📞 Missed call: ${label}${c.kind === 'voicemail' ? ' (voicemail)' : ''} — call back now`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A">
        <div style="background:#1A1A1A;color:#fff;padding:14px 18px;border-bottom:3px solid #C9922C"><strong style="font-size:16px">${opts.testTo ? 'TEST · ' : ''}Missed call — ${esc(ownerName)}, this one's yours</strong></div>
        <div style="padding:18px;border:1px solid #E8E5E0;border-top:0">
          <p style="margin:0 0 4px;font-size:18px"><strong>${esc(label)}</strong></p>
          ${ctxLine ? `<p style="margin:0 0 4px;font-size:14px;color:#555">${esc(ctxLine)}</p>` : ''}
          <p style="margin:0 0 14px;font-size:14px;color:#555">${what} at ${esc(when)}${priorCalls ? ` · ${priorCalls + 1}${priorCalls === 1 ? 'nd' : 'th'} call from this number` : ''}</p>
          <p style="margin:0 0 16px"><a href="tel:${esc(tail)}" style="display:block;text-align:center;padding:16px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:18px">📞 Call ${esc(prettyPhone(num))}</a></p>
          ${vm ? `<p style="margin:0 0 6px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px">Voicemail</p><p style="margin:0 0 16px;padding:12px;background:#FAF8F5;border-left:3px solid #C9922C;font-size:14px;white-space:pre-wrap">${esc(vm.slice(0, 700))}</p>` : ''}
          <a href="https://www.fairoaksrealtygroup.com/crm/${c.business_unit}#calls" style="display:inline-block;padding:10px 16px;background:#C9922C;color:#1A1A1A;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">Open the Calling Log</a>
          <p style="margin:14px 0 0;font-size:12px;color:#888">Mark it handled (or just call back — the log notices) and the 30-minute reminder won't fire.</p>
        </div>
      </div>`;
    const res = await sendMonitored(new Resend(key.replace(/[\r\n\s]+$/, '')), { from, to, subject, html }, 'call_instant_alerts', { label: 'Instant missed-call alert' });
    if (!res.ok) { results.push({ id: c.id, status: `send-failed: ${res.error}` }); continue; }
    if (!opts.testTo) await db.from('crm_call_sla_alerts').insert([{ call_id: c.id, level: 0, sent_to: to }]);
    sent++;
    results.push({ id: c.id, status: opts.testTo ? 'test-sent' : 'sent' });
  }
  return { checked: calls.length, sent, results };
}
