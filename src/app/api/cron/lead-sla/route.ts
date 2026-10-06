import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { createLeadFollowUpTask } from '@/lib/lead-followup';
import { sendMonitored } from '@/lib/integration-alert';

/**
 * GET /api/cron/lead-sla — every 15 minutes.
 *
 * Speed-to-lead enforcement for crecotx.com web leads. The Oct-2026 review
 * found 31 of 38 website leads with no logged call, email, note or task, and
 * only one ever got a follow-up task (contacts written by the site's direct
 * pushToCrm path never got one). This job closes both gaps:
 *
 *  1. Backstop: every new inbound web lead gets a call-back task for its
 *     owner, whichever writer created the contact.
 *  2. Nudge: still uncontacted 30 minutes after it landed → email the owner.
 *  3. Escalate: still uncontacted at 2 hours → email the owner AND the backup
 *     (Zack and Brian back each other up), so a lead never sits unworked.
 *
 * "Contacted" means anything a person did after the lead arrived: a logged
 * call/email/note/meeting, a completed call-back task, or a Talkroute call
 * to/from the lead's number. Each reminder level is sent at most once per
 * lead (crm_lead_sla_alerts). Secured by CRON_SECRET.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL ?? 'https://crm.vultstack.com';

/** Leads that landed before this shipped are never nudged about. */
const SLA_START = '2026-10-05T00:00:00Z';
const NUDGE_MIN = 30;
const ESCALATE_MIN = 120;
/** Past this, a lead is no longer "new" — stop checking it. */
const LOOKBACK_HOURS = 72;

/** Activity types that mean a person reached out (deal_update is not contact). */
const CONTACT_ACTIVITY_TYPES = ['call', 'email', 'note', 'meeting'];

/**
 * Where each CRM login actually reads mail. Zack's profile sits under the
 * Fair Oaks address, but lead alerts belong in his CRECO inbox.
 */
const ALERT_INBOX: Record<string, string> = {
  'info@fairoaksrealtygroup.com': 'zack@crecotx.com',
};

type Lead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  agent_id: string | null;
  assigned_agent_ids: string[] | null;
  lead_source: string | null;
  lead_site: string | null;
  channel: string | null;
  utm_campaign: string | null;
  notes: string | null;
};

type Profile = { id: string; email: string | null; first_name: string | null; last_name: string | null; role: string | null };

function isInboundWebLead(l: Lead): boolean {
  return l.lead_site === 'crecotx.com' || /^(website|creco website)/i.test(l.lead_source ?? '');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function ago(createdAt: string): string {
  const min = Math.round((Date.now() - new Date(createdAt).getTime()) / 60000);
  return min < 120 ? `${min} min` : `${Math.round(min / 60)} hours`;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = Date.now();
  const since = new Date(Math.max(new Date(SLA_START).getTime(), now - LOOKBACK_HOURS * 3600_000)).toISOString();
  const nudgeBefore = new Date(now - NUDGE_MIN * 60_000).toISOString();

  const { data: rows, error } = await db
    .from('crm_clients')
    .select('id, first_name, last_name, email, phone, created_at, agent_id, assigned_agent_ids, lead_source, lead_site, channel, utm_campaign, notes')
    .eq('business_unit', 'commercial')
    .gte('created_at', since)
    .lte('created_at', nudgeBefore)
    .is('unsubscribed_at', null);
  if (error) {
    console.error('[lead-sla] fetch failed:', error.message);
    return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  }
  const leads = (rows as Lead[]).filter(isInboundWebLead);
  if (!leads.length) return NextResponse.json({ checked: 0, sent: 0 });

  const { data: profileRows } = await db.from('crm_profiles').select('id, email, first_name, last_name, role');
  const profiles = new Map((profileRows as Profile[] ?? []).map(p => [p.id, p]));
  const superAdmin = (profileRows as Profile[] ?? []).find(p => p.role === 'super_admin');
  const inboxFor = (p?: Profile) => (p?.email ? ALERT_INBOX[p.email.toLowerCase()] ?? p.email : null);

  const resendKey = process.env.RESEND_API_KEY_COMMERCIAL || process.env.RESEND_API_KEY;
  const resend = resendKey ? new Resend(resendKey) : null;
  const from = process.env.RESEND_API_KEY_COMMERCIAL
    ? 'CRECO Lead Alerts <noreply@crecotx.com>'
    : 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>';

  let sent = 0;
  const results: Array<{ id: string; status: string }> = [];

  for (const lead of leads) {
    const name = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || lead.email || 'New lead';

    // Same test classifier as the dashboard + follow-up task.
    const { data: isTest, error: testErr } = await db.rpc('lead_is_test', { p_name: name, p_email: lead.email ?? '' });
    if (testErr || isTest === true) { results.push({ id: lead.id, status: 'test/skip' }); continue; }

    // ── Contacted yet? ────────────────────────────────────────────────────
    const [{ data: acts }, { data: tasks }] = await Promise.all([
      db.from('crm_client_activities').select('id').eq('client_id', lead.id)
        .gte('created_at', lead.created_at).in('type', CONTACT_ACTIVITY_TYPES).limit(1),
      db.from('crm_tasks').select('id, completed_at, status, type').eq('client_id', lead.id),
    ]);
    let contacted = (acts?.length ?? 0) > 0
      || (tasks ?? []).some(t => ['call', 'follow_up'].includes(t.type) && (t.completed_at || ['done', 'completed'].includes(t.status)));
    const digits = (lead.phone ?? '').replace(/\D/g, '').slice(-10);
    if (!contacted && digits.length === 10) {
      const { data: calls } = await db.from('crm_call_log').select('id')
        .gte('started_at', lead.created_at)
        .or(`contact_id.eq.${lead.id},from_number.ilike.*${digits},to_number.ilike.*${digits}`)
        .limit(1);
      contacted = (calls?.length ?? 0) > 0;
    }
    if (contacted) { results.push({ id: lead.id, status: 'contacted' }); continue; }

    // ── Backstop: make sure the owner has a call-back task ────────────────
    if (!(tasks ?? []).some(t => ['call', 'follow_up'].includes(t.type))) {
      await createLeadFollowUpTask(db, {
        clientId: lead.id, name, email: lead.email, phone: lead.phone,
        channel: lead.channel, leadSite: lead.lead_site, campaign: lead.utm_campaign,
        source: lead.lead_source, businessUnit: 'commercial',
        detail: lead.notes ? lead.notes.slice(0, 600) : null,
        ownerId: lead.agent_id,
      });
    }

    // ── Reminder level due now ────────────────────────────────────────────
    const ageMin = (now - new Date(lead.created_at).getTime()) / 60000;
    const level = ageMin >= ESCALATE_MIN ? 2 : 1;
    const { data: already } = await db.from('crm_lead_sla_alerts').select('level').eq('client_id', lead.id).eq('level', level).maybeSingle();
    if (already) { results.push({ id: lead.id, status: `level${level}-already-sent` }); continue; }

    const owner = lead.agent_id ? profiles.get(lead.agent_id) : undefined;
    const backupId = (lead.assigned_agent_ids ?? []).find(id => id !== lead.agent_id)
      ?? (owner?.id !== superAdmin?.id ? superAdmin?.id : undefined);
    const backup = backupId ? profiles.get(backupId) : undefined;
    const to = Array.from(new Set([inboxFor(owner) ?? inboxFor(superAdmin), ...(level === 2 ? [inboxFor(backup)] : [])]
      .filter((e): e is string => !!e)));
    if (!to.length || !resend) { results.push({ id: lead.id, status: 'no-recipient' }); continue; }

    const ownerName = owner ? `${owner.first_name ?? ''}`.trim() || 'the owner' : 'the owner';
    const subject = level === 2
      ? `⚠️ Lead uncontacted for ${ago(lead.created_at)}: ${name} — ${ownerName} + backup, please call`
      : `⏱ ${name} hasn't been contacted yet (${ago(lead.created_at)})`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A">
        <div style="background:#1A1A1A;color:#fff;padding:16px 20px;border-bottom:3px solid #C9922C">
          <strong style="font-size:16px">${level === 2 ? 'Escalation: lead still uncontacted' : 'Speed-to-lead reminder'}</strong>
        </div>
        <div style="padding:20px;border:1px solid #E8E5E0;border-top:0">
          <p style="margin:0 0 12px">${esc(name)} came in from crecotx.com <strong>${ago(lead.created_at)} ago</strong> and nobody has logged a call, email or note yet.${level === 2 ? ` ${esc(ownerName)} owns this lead; this goes to the backup too so someone calls today.` : ''}</p>
          <table style="border-collapse:collapse;font-size:14px;margin:0 0 16px">
            ${lead.phone ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td><a href="tel:${esc(digits)}" style="color:#B8973F;font-weight:bold">${esc(lead.phone)}</a></td></tr>` : ''}
            ${lead.email ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td><a href="mailto:${esc(lead.email)}" style="color:#B8973F">${esc(lead.email)}</a></td></tr>` : ''}
            ${lead.lead_source ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Source</td><td>${esc(lead.lead_source)}</td></tr>` : ''}
          </table>
          ${lead.notes ? `<p style="margin:0 0 16px;padding:12px;background:#FAFAF8;border:1px solid #E8E5E0;font-size:14px;white-space:pre-wrap">${esc(lead.notes.slice(0, 600))}</p>` : ''}
          <a href="${CRM_URL}#tasks" style="display:inline-block;padding:10px 18px;background:#C9922C;color:#1A1A1A;text-decoration:none;border-radius:6px;font-weight:bold">Open the call-back task</a>
          <p style="margin:16px 0 0;font-size:12px;color:#888">Log the call (or complete the task) in the CRM and these reminders stop.</p>
        </div>
      </div>`;

    const res = await sendMonitored(resend, { from, to, subject, html }, 'lead_sla_alerts', { label: 'Lead SLA reminder' });
    if (!res.ok) { results.push({ id: lead.id, status: `send-failed: ${res.error}` }); continue; }
    await db.from('crm_lead_sla_alerts').insert([{ client_id: lead.id, level, sent_to: to }]);
    sent++;
    results.push({ id: lead.id, status: `level${level}-sent` });
  }

  console.log(`[lead-sla] checked ${leads.length}, sent ${sent}`, JSON.stringify(results));
  return NextResponse.json({ checked: leads.length, sent, results });
}
