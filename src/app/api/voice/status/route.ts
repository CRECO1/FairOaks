import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { twiml, twilioConfigured, twilioParams, verifyTwilioSignature } from '@/lib/twilio';
import { flattenTranscript, loadSettings, notifyCallSummary, summarizeCall, type Turn } from '@/lib/voicebot';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/voice/status — Twilio status callback (configure for "completed") and
 * the action URL of the fallback <Record> when the bot is switched off.
 *
 * Closes the call record: duration, final result, an AI summary of the
 * conversation, and the "you have a callback to make" email.
 */
export async function POST(req: Request) {
  if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const p = await twilioParams(req);
  if (!verifyTwilioSignature(req, p)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const db = adminClient();
  const status = p.CallStatus || '';

  // The bot-off <Record> path posts here with RecordingUrl instead of a final status.
  if (p.RecordingUrl && !status) return twiml('<Hangup/>');
  if (!['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) return NextResponse.json({ ok: true, ignored: status });

  const { data: call } = await db.from('crm_call_log').select('id, business_unit, from_number, caller_name, contact_id, started_at, summary, ai_meta').eq('source', 'voicebot').eq('external_id', p.CallSid).maybeSingle();
  if (!call) return NextResponse.json({ ok: true, unknown: true });
  if (call.summary) return NextResponse.json({ ok: true, already: true }); // Twilio retries; do the expensive part once

  const duration = Number(p.CallDuration || p.Duration || 0) || null;
  const { data: turnRows } = await db.from('crm_call_turns').select('role, text').eq('call_id', call.id).order('created_at');
  const turns = (turnRows ?? []) as Turn[];
  const transcript = flattenTranscript(turns);

  let contact = null as null | { id: string; name: string };
  if (call.contact_id) {
    const { data: c } = await db.from('crm_clients').select('id, first_name, last_name, business_name').eq('id', call.contact_id).maybeSingle();
    if (c) contact = { id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.business_name || 'Contact' };
  }

  const s = await summarizeCall(turns, { callerNumber: call.from_number, contact });
  const meta = (call.ai_meta as Record<string, unknown>) || {};
  const patch: Record<string, unknown> = {
    result: status === 'completed' ? 'bot_answered' : status,
    duration_sec: duration,
    transcript,
    summary: s?.summary || (turns.some(t => t.role === 'caller' && t.text !== '(silence)') ? 'Bot answered; the caller did not leave details.' : 'Bot answered; the caller hung up without speaking.'),
    intent: s?.intent ?? meta.intent ?? null,
    callback_number: s?.callback_number ?? meta.callback_number ?? null,
    needs_follow_up: s ? s.needs_follow_up : turns.some(t => t.role === 'caller' && t.text !== '(silence)'),
    ai_meta: { ...meta, property: s?.property ?? meta.property ?? null, urgency: s?.urgency ?? 'normal', call_status: status },
    updated_at: new Date().toISOString(),
  };
  if (s?.caller_name && (!call.caller_name || call.caller_name === contact?.name)) patch.caller_name = s.caller_name;
  await db.from('crm_call_log').update(patch).eq('id', call.id);

  if (patch.needs_follow_up) {
    const settings = await loadSettings(db, call.business_unit);
    await notifyCallSummary(settings, {
      id: call.id, from_number: call.from_number, caller_name: (patch.caller_name as string) || call.caller_name, contact,
      started_at: call.started_at, duration_sec: duration, summary: patch.summary as string, intent: patch.intent as string | null,
      callback_number: patch.callback_number as string | null, property: (s?.property ?? (meta.property as string | undefined)) ?? null, urgency: s?.urgency ?? 'normal', transcript,
    });
  }
  return NextResponse.json({ ok: true });
}
