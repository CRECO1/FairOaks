import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { resolveSignature, withSignature } from '@/lib/agent-signature';
import { logSecure, notifyUploads, removeRequestFiles, requestEmail, sendSecureEmail, secureUrl, sweepLeftovers, teamLabel, type SecureRequestRow } from '@/lib/secure-upload';

/**
 * GET /api/cron/secure-upload  (every 30 minutes, CRON_SECRET)
 *  1. Purge   — requests past purge_after (and not marked "keep") lose their files; the access log stays.
 *  2. Nudge the agent — a tenant who uploaded but never pressed "I'm done" is reported once they've been quiet for 30 minutes.
 *  3. Chase the tenant — an open link with nothing uploaded gets a reminder after 3 days, again after 4 more, then stops.
 *  4. Leftovers — stored files nothing points at any more are removed: every run for folders whose request is gone or
 *     deleted (a deleted contact takes its requests with it, but not the stored files); once a night, also uploads that
 *     reached storage but were never confirmed. `?deep=1` runs the nightly part now; `?dry=1` only counts.
 */
const DAY = 86_400_000;
const FIRST_AFTER_DAYS = 3;
const GAP_DAYS = 4;
const MAX_REMINDERS = 2;
const QUIET_MS = 30 * 60_000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const db = adminClient();
  const now = Date.now();
  const out: Record<string, unknown> = { purged: 0, notified: 0, reminded: 0, dry };
  const bump = (k: 'purged' | 'notified' | 'reminded') => { out[k] = (out[k] as number) + 1; };

  // Every live request, a page at a time (one query returns at most 1,000 rows — the rest must not be skipped forever).
  const rows: SecureRequestRow[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await db.from('crm_secure_requests').select('*').is('purged_at', null).order('created_at').order('id').range(from, from + 999);
    if (error) { console.error('[cron/secure-upload]', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
    rows.push(...((data ?? []) as SecureRequestRow[]));
    if ((data?.length ?? 0) < 1000) break;
  }

  for (const r of rows) {
    // 1 — purge
    if (!r.keep_files && Date.parse(r.purge_after) <= now) {
      if (!dry) {
        const n = await removeRequestFiles(db, r.id);
        await db.from('crm_secure_requests').update({ purged_at: new Date().toISOString(), status: 'revoked' }).eq('id', r.id);
        await logSecure(db, r.id, { label: 'system' }, 'purged', `auto-deleted after retention (${n} file${n === 1 ? '' : 's'})`);
      }
      bump('purged'); continue;
    }
    // 2 — uploaded, went quiet, never pressed done
    if (r.last_upload_at && !r.submitted_at && now - Date.parse(r.last_upload_at) >= QUIET_MS && (!r.notified_at || Date.parse(r.notified_at) < Date.parse(r.last_upload_at))) {
      if (!dry) await notifyUploads(db, r, false);
      bump('notified');
    }
    // 3 — nothing uploaded yet: chase the tenant
    const live = r.status === 'open' && Date.parse(r.expires_at) > now;
    if (live && r.kind !== 'folder' && r.sent_at && r.recipient_email && !r.last_upload_at && r.reminder_count < MAX_REMINDERS) {
      const since = Date.parse(r.reminded_at ?? r.sent_at);
      if (now - since >= (r.reminded_at ? GAP_DAYS : FIRST_AFTER_DAYS) * DAY) {
        if (!dry) {
          const { data: p } = r.created_by ? await db.from('crm_profiles').select('first_name, last_name').eq('id', r.created_by).maybeSingle() : { data: null };
          const sender = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || teamLabel(r.business_unit);
          const { subject, html } = requestEmail(r.business_unit, { name: r.recipient_name ?? '', senderName: sender, url: secureUrl(r.token), items: r.items, note: r.note, expiresAt: r.expires_at, reminder: true, needsPassword: !!r.pass_hash });
          const res = await sendSecureEmail(r.business_unit, r.recipient_email, subject, withSignature(html, await resolveSignature(db, { agentId: r.created_by })));
          if (!res.ok) { console.error('[cron/secure-upload] reminder failed', res.error); continue; }
          await db.from('crm_secure_requests').update({ reminded_at: new Date().toISOString(), reminder_count: r.reminder_count + 1 }).eq('id', r.id);
          await logSecure(db, r.id, { label: 'system' }, 'sent', `reminder ${r.reminder_count + 1} to ${r.recipient_email}`);
        }
        bump('reminded');
      }
    }
  }

  // 4 — leftovers. Its own try: a storage hiccup here must not turn the purge and reminders above into a failed run.
  try {
    const d = new Date(now);
    const nightly = d.getUTCHours() === 9 && d.getUTCMinutes() < 30;   // about 3–4 AM Central
    Object.assign(out, await sweepLeftovers(db, { dry, deep: nightly || req.nextUrl.searchParams.get('deep') === '1', now }));
  } catch (e) { console.error('[cron/secure-upload] leftovers sweep failed', e); out.sweepError = true; }
  return NextResponse.json(out);
}
