/**
 * "A contact you know is on the website" alerts.
 *
 * A visitor becomes a KNOWN contact when their anonymous visitor id is linked to a CRM contact — by submitting a
 * form, or by clicking through a signed `ctk` link in one of our campaign / action-plan emails
 * (site_visitor_links). When such a contact does something that signals intent, their owner (and backup) get an
 * email while it's still warm, with what they did, where they've been, and a one-tap call/CRM button.
 *
 * Triggers (deliberately NOT mere pageviews or email-click-throughs — mail security scanners "click" every link):
 *   • phone_tap / email_tap / text_tap  — they tapped a contact method        (throttled 20 min per kind)
 *   • download                           — a brochure / flyer / report         (20 min)
 *   • lead_form_started                  — began a contact / inquiry form      (20 min)
 *   • engaged visit                      — ≥ 20 s on a page                     (once per 12 h)
 *
 * BUSINESS HOURS ONLY (Mon–Sat 8 am–6 pm Central, same as the call-back SLA clock): nothing is emailed outside
 * them. An after-hours tap still leaves a 🌙 note on the contact's timeline so it isn't lost — it's there when
 * the office opens.
 *
 * Never throws: an alert failure must not disturb tracking ingest. Called from /api/track/event after the response.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendMonitored } from '@/lib/integration-alert';
import { prettyPhone } from '@/lib/phone';
import { isBusinessOpen } from '@/lib/talkroute';

export interface TrackedEvent { type: string; label?: string | null; path?: string | null; value?: number | null }

/** Zack's CRM login is the Fair Oaks address; his alerts belong in his CRECO inbox. */
const ALERT_INBOX: Record<string, string> = { 'info@fairoaksrealtygroup.com': 'zack@crecotx.com' };
const TIER1 = new Set(['phone_tap', 'email_tap', 'text_tap', 'download', 'lead_form_started']);
const TIER1_WINDOW_MIN = 20;
const ENGAGED_MIN_SEC = 20;
const ENGAGED_WINDOW_H = 12;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const siteShort = (h: string) => h.replace(/^www\./, '').replace('.com', '').replace('fairoaksrealtygroup', 'Fair Oaks').replace('crecotx', 'CRECO').replace('elkhornpoint', 'Elkhorn Point');

const WHAT: Record<string, (label: string) => string> = {
  phone_tap: l => `📞 Tapped to call ${l ? prettyPhone(l.replace(/\D/g, '')) || l : 'us'}`,
  email_tap: l => `✉️ Tapped to email ${l || 'us'}`,
  text_tap: l => `💬 Tapped to text ${l ? prettyPhone(l.replace(/\D/g, '')) || l : 'us'}`,
  download: l => `⬇️ Downloaded ${l || 'a file'}`,
  lead_form_started: l => `📝 Started a form${l ? ` (${l})` : ''}`,
  engaged_visit: l => `👀 Browsing${l ? ` ${l}` : ''}`,
};

export async function alertKnownContact(
  db: SupabaseClient,
  opts: { visitorId: string | null; site: string; events: TrackedEvent[]; testTo?: string },
): Promise<{ sent: boolean; reason?: string }> {
  try {
    if (!opts.visitorId) return { sent: false, reason: 'no visitor' };
    const { data: link } = await db.from('site_visitor_links').select('client_id').eq('visitor_id', opts.visitorId).maybeSingle();
    if (!link?.client_id) return { sent: false, reason: 'unknown visitor' };

    // What qualifies in this batch.
    const triggers: { kind: string; label: string }[] = [];
    for (const e of opts.events) {
      if (TIER1.has(e.type)) triggers.push({ kind: e.type, label: (e.label ?? '').toString() });
      else if (e.type === 'page_exit' && (Number(e.value) || 0) >= ENGAGED_MIN_SEC) {
        triggers.push({ kind: 'engaged_visit', label: e.path ?? '' });
      }
    }
    if (!triggers.length) return { sent: false, reason: 'no trigger' };

    // Throttle per (client, kind) — skip kinds already alerted inside their window.
    const fresh: typeof triggers = [];
    const seen = new Set<string>();
    for (const t of triggers) {
      if (seen.has(t.kind)) continue; seen.add(t.kind);
      if (!opts.testTo) {
        const since = new Date(Date.now() - (t.kind === 'engaged_visit' ? ENGAGED_WINDOW_H * 60 : TIER1_WINDOW_MIN) * 60_000).toISOString();
        const { data: prior } = await db.from('site_contact_alerts').select('id').eq('client_id', link.client_id).eq('kind', t.kind).gte('created_at', since).limit(1);
        if (prior?.length) continue;
      }
      fresh.push(t);
    }
    if (!fresh.length) return { sent: false, reason: 'throttled' };

    const open = opts.testTo ? true : isBusinessOpen();
    const { data: k } = await db.from('crm_clients')
      .select('id, first_name, last_name, business_name, type, email, phone, cell_phone, agent_id, assigned_agent_ids, business_unit')
      .eq('id', link.client_id).maybeSingle();
    if (!k) return { sent: false, reason: 'contact gone' };

    if (!open) {
      // After hours: no email — just a quiet note on the contact's timeline, once per kind per 20 minutes.
      const quiet = fresh.filter(t => t.kind !== 'engaged_visit');
      const since = new Date(Date.now() - TIER1_WINDOW_MIN * 60_000).toISOString();
      for (const t of quiet) {
        const { data: prior } = await db.from('site_contact_alerts').select('id').eq('client_id', k.id).eq('kind', `afterhours_${t.kind}`).gte('created_at', since).limit(1);
        if (prior?.length) continue;
        await db.from('site_contact_alerts').insert([{ client_id: k.id, kind: `afterhours_${t.kind}`, sent_to: [], detail: t.label.slice(0, 160) }]);
        await db.from('crm_activity').insert([{ client_id: k.id, agent_id: k.agent_id ?? null, type: 'note', notes: `🌙 Website (after hours): ${(WHAT[t.kind] ?? (() => t.kind))(t.label)} (${siteShort(opts.site)})` }]);
      }
      return { sent: false, reason: 'after hours' };
    }

    // Owner + backup(s); fall back to the account owner so an alert is never dropped for lack of an owner.
    const { data: profiles } = await db.from('crm_profiles').select('id, email, first_name, role');
    const byId = new Map((profiles ?? []).map(p => [p.id as string, p]));
    const ids = [k.agent_id, ...((k.assigned_agent_ids ?? []) as string[])].filter(Boolean) as string[];
    let recips = [...new Set(ids)].map(id => byId.get(id)).filter(Boolean) as { id: string; email: string; first_name: string | null; role: string }[];
    if (!recips.length) recips = (profiles ?? []).filter(p => p.role === 'super_admin') as typeof recips;
    const to = opts.testTo ? [opts.testTo] : [...new Set(recips.map(p => ALERT_INBOX[p.email.toLowerCase()] ?? p.email).filter(Boolean))].slice(0, 3);
    if (!to.length) return { sent: false, reason: 'no recipient' };

    const commercial = k.business_unit === 'commercial';
    const key = (commercial ? process.env.RESEND_API_KEY_COMMERCIAL : process.env.RESEND_API_KEY) || process.env.RESEND_API_KEY;
    if (!key) return { sent: false, reason: 'no key' };
    const from = commercial && process.env.RESEND_API_KEY_COMMERCIAL ? 'CRECO Site Alerts <noreply@crecotx.com>' : 'Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>';

    // Where they've been recently (this visitor id, last 3 hours).
    const since3h = new Date(Date.now() - 3 * 3600_000).toISOString();
    const { data: pvs } = await db.from('site_pageviews').select('path, title, site, created_at').eq('visitor_id', opts.visitorId).gte('created_at', since3h).order('created_at', { ascending: false }).limit(8);

    const name = [k.first_name, k.last_name].filter(Boolean).join(' ') || (k.business_name as string) || 'A contact';
    const sub = [k.business_name && k.business_name !== name ? k.business_name : null, k.type].filter(Boolean).join(' · ');
    const lines = fresh.map(t => (WHAT[t.kind] ?? (() => t.kind))(t.label));
    const strong = fresh.find(t => t.kind !== 'engaged_visit');
    const headline = strong ? lines[fresh.indexOf(strong)].replace(/^\S+\s/, '') : 'is browsing the site right now';
    const subject = `${opts.testTo ? '[TEST] ' : ''}🔔 ${name} ${strong ? headline.charAt(0).toLowerCase() + headline.slice(1) : headline} — ${siteShort(opts.site)}`;
    const phone = ((k.cell_phone || k.phone) as string | null) || '';
    const telDigits = phone.replace(/\D/g, '').slice(-10);
    const crmUrl = `https://www.fairoaksrealtygroup.com/crm/${k.business_unit}#contacts`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A">
        <div style="background:#1A1A1A;color:#fff;padding:14px 18px;border-bottom:3px solid #C9922C"><strong style="font-size:16px">${opts.testTo ? 'TEST · ' : ''}A contact you know is on ${esc(siteShort(opts.site))}</strong></div>
        <div style="padding:18px;border:1px solid #E8E5E0;border-top:0">
          <p style="margin:0 0 2px;font-size:19px"><strong>${esc(name)}</strong></p>
          ${sub ? `<p style="margin:0 0 12px;font-size:14px;color:#555">${esc(sub)}</p>` : '<div style="height:10px"></div>'}
          ${lines.map(l => `<p style="margin:0 0 6px;font-size:16px;font-weight:700">${esc(l)}</p>`).join('')}
          ${pvs?.length ? `<p style="margin:14px 0 6px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px">Where they've been (last 3 hours)</p>
          <ul style="margin:0 0 16px;padding-left:18px;font-size:14px;color:#444">${pvs.map(p => `<li>${esc(String(p.path))}${p.title ? ` <span style="color:#999">— ${esc(String(p.title).slice(0, 50))}</span>` : ''}</li>`).join('')}</ul>` : '<div style="height:12px"></div>'}
          ${telDigits.length === 10 ? `<p style="margin:0 0 12px"><a href="tel:${telDigits}" style="display:block;text-align:center;padding:15px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-size:17px;font-weight:700">📞 Call ${esc(name.split(' ')[0])} · ${esc(prettyPhone(telDigits) || telDigits)}</a></p>` : ''}
          <a href="${crmUrl}" style="display:inline-block;padding:10px 16px;background:#C9922C;color:#1A1A1A;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700">Open in the CRM →</a>
          <p style="margin:14px 0 0;font-size:12px;color:#888">Their full website activity is on the contact card under “Website activity”. You'll get at most one alert per type every ${TIER1_WINDOW_MIN} minutes (browsing: once per ${ENGAGED_WINDOW_H} hours).</p>
        </div>
      </div>`;
    const res = await sendMonitored(new Resend(key.replace(/[\r\n\s]+$/, '')), { from, to, subject, html }, 'known_contact_alerts', { label: 'Known-contact website alert' });
    if (!res.ok) return { sent: false, reason: `send failed: ${res.error}` };

    if (!opts.testTo) {
      await db.from('site_contact_alerts').insert(fresh.map(t => ({ client_id: k.id, kind: t.kind, sent_to: to, detail: t.label.slice(0, 160) })));
      // Leave a breadcrumb on the contact's own timeline too.
      await db.from('crm_activity').insert([{ client_id: k.id, agent_id: k.agent_id ?? recips[0]?.id ?? null, type: 'note', notes: `🔔 Website: ${lines.join(' · ')} (${siteShort(opts.site)})` }]);
    }
    return { sent: true };
  } catch (e) {
    console.error('[known-contact-alert]', e);
    return { sent: false, reason: 'error' };
  }
}
