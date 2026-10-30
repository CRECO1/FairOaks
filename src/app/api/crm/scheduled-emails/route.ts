import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { sendScheduledRow } from '@/lib/scheduled-emails';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Your scheduled ("send later") emails. Personal: you only ever see and change your own.
// GET                          → { items: [...] }  pending + failed ones
// POST { send_at, payload }    → schedule (payload = what Compose would POST to /api/gmail/send)
// PATCH { id, action: 'cancel' | 'send_now' }
const MAX_PENDING = 50;
const MAX_PAYLOAD = 400_000; // characters of JSON — scheduled mail carries CRM-file references, never uploaded files

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { data, error } = await adminClient().from('crm_scheduled_emails')
    .select('id, send_at, summary_to, summary_subject, status, attempts, last_error, created_at')
    .eq('user_id', ctx.userId).in('status', ['pending', 'sending', 'failed']).order('send_at', { ascending: true }).limit(100);
  if (error) return dbError('api/crm/scheduled-emails GET', error);
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => null) as { send_at?: string; payload?: Record<string, unknown> } | null;
  const when = b?.send_at ? new Date(b.send_at) : null;
  const p = b?.payload;
  if (!when || isNaN(when.getTime()) || !p) return NextResponse.json({ error: 'send_at and payload are required' }, { status: 400 });
  if (when.getTime() < Date.now() + 60_000) return NextResponse.json({ error: 'Pick a time at least a minute from now.' }, { status: 400 });
  if (when.getTime() > Date.now() + 90 * 86_400_000) return NextResponse.json({ error: 'You can schedule up to 90 days ahead.' }, { status: 400 });
  if (p.userId !== ctx.userId) return NextResponse.json({ error: 'That email is not yours to schedule.' }, { status: 403 });
  if (!p.to || !p.subject || !p.body) return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 });
  if (Array.isArray(p.attachments) && p.attachments.length) return NextResponse.json({ error: 'Files from your computer can’t be scheduled yet — attach them from Deal docs, or send now.' }, { status: 400 });
  if (JSON.stringify(p).length > MAX_PAYLOAD) return NextResponse.json({ error: 'That email is too large to schedule.' }, { status: 413 });
  const db = adminClient();
  const { count } = await db.from('crm_scheduled_emails').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('status', 'pending');
  if ((count ?? 0) >= MAX_PENDING) return NextResponse.json({ error: `You already have ${MAX_PENDING} emails waiting. Cancel some first.` }, { status: 400 });
  const recipients = String(p.to).split(/[,;]+/).map(x => x.trim()).filter(Boolean);
  const { data, error } = await db.from('crm_scheduled_emails').insert({
    user_id: ctx.userId, send_at: when.toISOString(), payload: p,
    summary_to: recipients.slice(0, 3).join(', ') + (recipients.length > 3 ? ` +${recipients.length - 3}` : ''), summary_subject: String(p.subject).slice(0, 200),
  }).select('id, send_at, summary_to, summary_subject, status').single();
  if (error) return dbError('api/crm/scheduled-emails POST', error);
  return NextResponse.json({ item: data });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => ({})) as { id?: string; action?: string };
  if (!b.id || !['cancel', 'send_now'].includes(b.action ?? '')) return NextResponse.json({ error: 'id and action required' }, { status: 400 });
  const db = adminClient();
  const { data: row } = await db.from('crm_scheduled_emails').select('id, user_id, status').eq('id', b.id).maybeSingle();
  if (!row || row.user_id !== ctx.userId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (b.action === 'cancel') {
    const { data } = await db.from('crm_scheduled_emails').update({ status: 'cancelled' }).eq('id', b.id).in('status', ['pending', 'failed']).select('id').maybeSingle();
    return data ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'It was already sent or is sending right now.' }, { status: 409 });
  }
  // send_now: a failed one gets another try; the claim inside makes sure it can only ever go out once.
  if (row.status === 'failed') await db.from('crm_scheduled_emails').update({ status: 'pending', attempts: 0, last_error: null }).eq('id', b.id).eq('status', 'failed');
  const r = await sendScheduledRow(b.id);
  if (r.status === 'sent') return NextResponse.json({ ok: true, sent: true });
  if (r.status === 'skipped') return NextResponse.json({ error: 'It is already being sent.' }, { status: 409 });
  return NextResponse.json({ error: r.error ?? 'It did not send.', status: r.status }, { status: 502 });
}
