import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logEvent, reminderEmail, sendEsignEmail, signUrl } from '@/lib/esign';

/**
 * GET /api/cron/esign-reminders
 *
 * Chases signatures that have gone quiet. The dashboard has always had a manual
 * 🔔 Nudge, but it only fires when somebody remembers to press it — so a lease
 * could sit unsigned for a fortnight without anyone noticing.
 *
 * Only ever emails the ONE signer whose turn it currently is: the others have
 * either already signed or haven't been invited yet, and mailing them would be
 * confusing. Secured by CRON_SECRET, like the other crons.
 */

const FIRST_AFTER_DAYS = 3;   // wait this long after the invite before the first chase
const GAP_DAYS = 4;           // and this long between chases
const MAX_REMINDERS = 3;      // then stop; past that it's a phone call, not an email

const DAY = 86_400_000;
const daysSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / DAY : Infinity);

interface Signer {
  id: string; envelope_id: string; name: string; email: string; signing_order: number;
  status: string; access_token: string; sent_at: string | null; signed_at: string | null;
  declined_at: string | null; reminded_at: string | null; reminder_count: number; in_person: boolean;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Live requests only — voided, declined and completed ones are finished business.
  const { data: envs, error } = await db
    .from('crm_envelopes')
    .select('id, title, business_unit, status, created_by, archived_at')
    .in('status', ['sent', 'in_progress'])
    .is('archived_at', null);
  if (error) { console.error('[cron/esign-reminders]', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  if (!envs?.length) return NextResponse.json({ checked: 0, reminded: 0 });

  const { data: allSigners } = await db
    .from('crm_envelope_signers')
    .select('id, envelope_id, name, email, signing_order, status, access_token, sent_at, signed_at, declined_at, reminded_at, reminder_count, in_person')
    .in('envelope_id', envs.map(e => e.id))
    .order('signing_order');
  const byEnv = new Map<string, Signer[]>();
  for (const s of (allSigners ?? []) as Signer[]) {
    const list = byEnv.get(s.envelope_id) ?? [];
    list.push(s); byEnv.set(s.envelope_id, list);
  }

  // Sender names, so the reminder can say who is waiting on them.
  const senderIds = [...new Set(envs.map(e => e.created_by).filter(Boolean))] as string[];
  const senderById = new Map<string, string>();
  if (senderIds.length) {
    const { data: profs } = await db.from('crm_profiles').select('id, first_name, last_name').in('id', senderIds);
    for (const p of profs ?? []) senderById.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || 'your agent');
  }

  const reminded: Array<{ envelope: string; to: string; nth: number }> = [];
  const failed: Array<{ to: string; error: string }> = [];

  for (const env of envs) {
    const signers = byEnv.get(env.id) ?? [];
    if (signers.some(s => s.declined_at || s.status === 'declined')) continue;
    const current = signers.find(s => s.status !== 'signed' && !s.signed_at);
    if (!current || !current.sent_at) continue;                       // not yet invited
    if (current.in_person) continue;                                  // no emailed link to chase
    if (current.reminder_count >= MAX_REMINDERS) continue;

    const waited = daysSince(current.sent_at);
    const sinceLast = daysSince(current.reminded_at);
    const due = current.reminded_at ? sinceLast >= GAP_DAYS : waited >= FIRST_AFTER_DAYS;
    if (!due) continue;

    const { subject, html } = reminderEmail(env.business_unit, {
      signerName: current.name, docTitle: env.title, url: signUrl(current.access_token),
      senderName: (env.created_by && senderById.get(env.created_by)) || 'your agent',
      daysWaiting: Math.max(1, Math.round(waited)),
    });
    const res = await sendEsignEmail(env.business_unit, current.email, subject, html);
    if (!res.ok) { failed.push({ to: current.email, error: res.error ?? 'send failed' }); continue; }

    // Only count a reminder that actually went out, so a Resend outage doesn't
    // silently burn through the allowance.
    const nth = current.reminder_count + 1;
    await db.from('crm_envelope_signers')
      .update({ reminded_at: new Date().toISOString(), reminder_count: nth })
      .eq('id', current.id);
    await logEvent(db, env.id, current.id, 'sent', { actor: 'system', meta: { reminder: nth, to: current.email } });
    reminded.push({ envelope: env.id, to: current.email, nth });
  }

  return NextResponse.json({ checked: envs.length, reminded: reminded.length, details: reminded, failed });
}
