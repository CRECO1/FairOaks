/**
 * Tag-a-teammate notifications: when someone is @mentioned in a deal note or newly
 * assigned to a deal / contact, they get an in-app notification (crm_notifications)
 * AND an email — automatically.
 *
 * Rules (all enforced here so every caller behaves the same):
 *   • never notify the actor (no self-email)
 *   • skip people who opted out (crm_profiles.notify_email = false); the in-app
 *     notification is still created
 *   • de-dupe: an identical notification to the same person within the window is
 *     dropped entirely (no second bell entry, no second email)
 *   • private deals: recipients who can't see the deal are skipped, and the email for a
 *     private deal carries no deal name or note text
 *
 * Internal teammate mail only — this never touches clients, and it is independent of
 * the automated client-email switches. Sent through Resend from the same address the
 * agent invite uses.
 *
 * SERVER-ONLY (service-role key).
 */
import 'server-only';
import { adminClient } from '@/lib/supabase-admin';
import { pushBellNotification } from '@/lib/notify';
import { crmLink } from '@/lib/push';

export const TEAM_MAIL_FROM = 'CRECO / Fair Oaks Realty Group <noreply@fairoaksrealtygroup.com>';
const APP_URL = 'https://www.fairoaksrealtygroup.com';
const PAGE: Record<string, string> = { deal: 'deals', contact: 'contacts' };

export type NotifyKind = 'mention' | 'assignment';

export interface NotifyOpts {
  kind: NotifyKind;
  recipientIds: string[];
  actorId: string;
  entityType: 'deal' | 'contact';
  entityId: string;
  /** Human label, e.g. "Acme Corp — 123 Main St". Omitted from private deals. */
  entityLabel: string;
  /** Note text (mentions only). */
  excerpt?: string;
  /** Deal is private: strip names/text from the email and filter recipients by access. */
  restricted?: boolean;
  /** Owner + assigned agents of a restricted deal (+ super_admins are always allowed). */
  allowedIds?: string[];
  /** De-dupe window in minutes. */
  windowMin?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function notifyTeammates(o: NotifyOpts): Promise<{ notified: number; emailed: number; skipped: number }> {
  const db = adminClient();
  const ids = Array.from(new Set(o.recipientIds)).filter(id => id && id !== o.actorId);
  if (!ids.length) return { notified: 0, emailed: 0, skipped: 0 };

  const { data: profs } = await db.from('crm_profiles').select('id, first_name, last_name, email, role, notify_email').in('id', ids);
  const { data: actor } = await db.from('crm_profiles').select('first_name, last_name').eq('id', o.actorId).maybeSingle();
  const actorName = `${actor?.first_name ?? 'A teammate'}`.trim();

  let people = profs ?? [];
  if (o.restricted) {
    const allowed = new Set(o.allowedIds ?? []);
    people = people.filter(p => p.role === 'super_admin' || allowed.has(p.id));
  }
  if (!people.length) return { notified: 0, emailed: 0, skipped: ids.length };

  const label = o.restricted ? 'a private deal' : o.entityLabel;
  const snippet = (o.excerpt ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const message = o.kind === 'mention'
    ? `@${actorName} mentioned you in a note on ${o.entityType === 'deal' ? 'deal' : 'contact'}: ${label}${snippet && !o.restricted ? ` — “${snippet}”` : ''}`
    : `${actorName} assigned you to ${o.entityType === 'deal' ? 'deal' : 'contact'}: ${label}`;

  // De-dupe against anything identical sent recently.
  const since = new Date(Date.now() - (o.windowMin ?? (o.kind === 'assignment' ? 24 * 60 : 60)) * 60_000).toISOString();
  const { data: recent } = await db.from('crm_notifications').select('recipient_id')
    .in('recipient_id', people.map(p => p.id)).eq('type', o.kind).eq('entity_type', o.entityType)
    .eq('entity_id', o.entityId).eq('message', message).gte('created_at', since);
  const already = new Set((recent ?? []).map(r => r.recipient_id as string));
  const fresh = people.filter(p => !already.has(p.id));
  if (!fresh.length) return { notified: 0, emailed: 0, skipped: ids.length };

  await db.from('crm_notifications').insert(fresh.map(p => ({
    recipient_id: p.id, sender_id: o.actorId, type: o.kind, message, entity_type: o.entityType, entity_id: o.entityId,
  })));

  // Phone alert, same as every other bell notification in the CRM.
  for (const p of fresh) await pushBellNotification(db, { recipientId: p.id, type: o.kind, message, entityType: o.entityType, entityId: o.entityId });

  // Email — opt-out respected, one message per person.
  let emailed = 0;
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const link = `${APP_URL}${crmLink(PAGE[o.entityType], { type: o.entityType, id: o.entityId })}`;
    const headline = o.kind === 'mention' ? `${esc(actorName)} mentioned you` : `${esc(actorName)} assigned you`;
    for (const p of fresh) {
      if (!p.email || p.notify_email === false) continue;
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="font-family:Georgia,serif;color:#111;margin:0 0 6px;">${headline}</h2>
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 6px;">Hi ${esc(p.first_name ?? 'there')},</p>
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 14px;">${o.kind === 'mention'
          ? `${esc(actorName)} tagged you in a note on <strong>${esc(label)}</strong>.`
          : `${esc(actorName)} added you to <strong>${esc(label)}</strong>.`}</p>
        ${snippet && !o.restricted ? `<blockquote style="margin:0 0 18px;padding:10px 14px;border-left:3px solid #c9922c;background:#faf7f0;color:#4b5563;font-size:14px;">${esc(snippet)}</blockquote>` : ''}
        <a href="${link}" style="display:inline-block;background:#c9922c;color:#111;text-decoration:none;font-weight:700;padding:11px 24px;border-radius:8px;font-size:14px;">Open in CRM</a>
        <p style="color:#9ca3af;font-size:12px;margin-top:22px;">You get these because you're on the CRECO / Fair Oaks team. Turn them off in your CRM profile settings.</p>
      </div>`;
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            from: TEAM_MAIL_FROM, to: [p.email],
            subject: o.kind === 'mention' ? `${actorName} mentioned you on ${label}` : `You've been assigned: ${label}`,
            html,
          }),
        });
        if (r.ok) emailed++; else console.error('[teammate-notify] resend', r.status);
      } catch (e) { console.error('[teammate-notify] send failed', e); }
    }
  }
  return { notified: fresh.length, emailed, skipped: ids.length - fresh.length };
}
