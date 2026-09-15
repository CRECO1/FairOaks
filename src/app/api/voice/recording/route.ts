import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { twilioConfigured, twilioParams, verifyTwilioSignature } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

/**
 * POST /api/voice/recording — Twilio tells us a recording is ready. We keep the
 * RecordingSid; the CRM streams the audio through /api/crm/calls/audio so the
 * Twilio credentials never leave the server.
 */
export async function POST(req: Request) {
  if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const p = await twilioParams(req);
  if (!verifyTwilioSignature(req, p)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  if (p.RecordingStatus && p.RecordingStatus !== 'completed') return NextResponse.json({ ok: true, ignored: p.RecordingStatus });
  if (!p.CallSid || !p.RecordingSid) return NextResponse.json({ ok: true, ignored: 'no sid' });

  const db = adminClient();
  const patch: Record<string, unknown> = { recording_url: `twilio:${p.RecordingSid}`, updated_at: new Date().toISOString() };
  const dur = Number(p.RecordingDuration || 0);
  const { data: call } = await db.from('crm_call_log').select('id, duration_sec').eq('source', 'voicebot').eq('external_id', p.CallSid).maybeSingle();
  if (!call) return NextResponse.json({ ok: true, unknown: true });
  if (!call.duration_sec && dur) patch.duration_sec = dur;
  await db.from('crm_call_log').update(patch).eq('id', call.id);
  return NextResponse.json({ ok: true });
}
