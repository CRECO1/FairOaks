import { adminClient } from '@/lib/supabase-admin';
import { handleSend } from '@/lib/gmail-send';
import { sendPushToProfiles } from '@/lib/push';
import type { CrmContext } from '@/lib/crm-auth';

// "Send later". A scheduled email is stored as exactly the request Compose would have POSTed to /api/gmail/send, and sent
// through the same pipeline (signature, open tracking, filing on the deal/contact, Gmail threading) when its time comes.
// Safe against double-sends: a row is CLAIMED (pending → sending) before anything is sent, and a row left "sending" by a
// crashed run is never retried automatically — it is marked failed so a human checks Sent first.

const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = 10;

export type SendOutcome = { ok: boolean; status: 'sent' | 'retry' | 'failed' | 'skipped'; error?: string };

export async function sendScheduledRow(id: string): Promise<SendOutcome> {
  const db = adminClient();
  const { data: row } = await db.from('crm_scheduled_emails').select('*').eq('id', id).maybeSingle();
  if (!row || row.status !== 'pending') return { ok: false, status: 'skipped' };
  // Claim it. If someone else (the cron, or "Send now") got there first, this update matches nothing.
  const { data: claimed } = await db.from('crm_scheduled_emails').update({ status: 'sending', attempts: (row.attempts ?? 0) + 1 })
    .eq('id', id).eq('status', 'pending').select('*').maybeSingle();
  if (!claimed) return { ok: false, status: 'skipped' };

  const { data: prof } = await db.from('crm_profiles').select('id, role, business_unit').eq('id', claimed.user_id).maybeSingle();
  const finish = async (patch: Record<string, unknown>) => { await db.from('crm_scheduled_emails').update(patch).eq('id', id); };
  if (!prof) { await finish({ status: 'failed', last_error: 'That agent no longer exists.' }); return { ok: false, status: 'failed', error: 'no agent' }; }
  const ctx: CrmContext = { userId: prof.id as string, role: (prof.role as string | null) ?? null, businessUnit: (prof.business_unit as string | null) ?? null };

  let status = 0; let json: { error?: string; duplicate?: boolean } = {};
  try {
    const res = await handleSend(new Request('http://internal/api/gmail/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(claimed.payload) }), ctx);
    status = res.status; json = await res.json().catch(() => ({}));
  } catch (e) { status = 500; json = { error: e instanceof Error ? e.message : 'Send crashed' }; }

  if (status >= 200 && status < 300) { await finish({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }); return { ok: true, status: 'sent' }; }
  if (status === 409 && json.duplicate) { await finish({ status: 'sent', sent_at: new Date().toISOString(), last_error: 'Already sent a moment earlier — not sent twice.' }); return { ok: true, status: 'sent' }; }
  const error = (json.error ?? `Send failed (${status})`).slice(0, 300);
  if (status >= 500 && claimed.attempts < MAX_ATTEMPTS) {
    await finish({ status: 'pending', last_error: error, send_at: new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString() });
    return { ok: false, status: 'retry', error };
  }
  await finish({ status: 'failed', last_error: error });
  try {
    await sendPushToProfiles([ctx.userId], { title: 'Scheduled email did not send', body: `“${String(claimed.summary_subject).slice(0, 60)}” to ${String(claimed.summary_to).slice(0, 60)}: ${error}`, url: '/crm/commercial#emails', tag: `sched-${id}`, category: 'mentions', businessUnit: ctx.businessUnit }, { db });
  } catch { /* the failed row is still shown on the Drafts tab */ }
  return { ok: false, status: 'failed', error };
}

/** Everything due now, oldest first. Rows stuck in "sending" (a run died mid-send) are NOT retried — marked failed for a human. */
export async function runDueScheduledEmails(limit = 15) {
  const db = adminClient();
  const stuckBefore = new Date(Date.now() - 20 * 60_000).toISOString();
  await db.from('crm_scheduled_emails').update({ status: 'failed', last_error: 'Interrupted while sending — check your Sent folder before sending again.' }).eq('status', 'sending').lt('send_at', stuckBefore);
  const { data: due } = await db.from('crm_scheduled_emails').select('id').eq('status', 'pending').lte('send_at', new Date().toISOString()).order('send_at', { ascending: true }).limit(limit);
  const out: Array<{ id: string } & SendOutcome> = [];
  for (const r of due ?? []) out.push({ id: r.id as string, ...(await sendScheduledRow(r.id as string)) });
  return out;
}
