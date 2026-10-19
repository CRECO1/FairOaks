import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { gather, twiml, twilioConfigured, twilioParams, verifyTwilioSignature, voiceOrigin } from '@/lib/twilio';
import { speechHints } from '@/lib/listing-knowledge';
import { asLang, line } from '@/lib/voice-lines';

export const dynamic = 'force-dynamic';

/**
 * POST /api/voice/dial-result — the <Dial action> after Ava rang an agent's cell.
 *
 * Records how the ring went on the call (who, answered or not, for how long) so the CRM tracks it either way.
 * A "completed" leg means the cell (or the cell's own voicemail) picked up and the call ran its course — nothing
 * more to do. Anything else (no-answer / busy / failed) means nobody was reached and there is no voicemail to
 * catch the caller, so Ava comes back on the line and takes the message in our system instead.
 */
export async function POST(req: Request) {
  if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const p = await twilioParams(req);
  if (!verifyTwilioSignature(req, p)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const db = adminClient();
  const status = p.DialCallStatus || 'failed';
  const duration = Number(p.DialCallDuration || 0) || 0;
  const { data: call } = await db.from('crm_call_log').select('id, business_unit, ai_meta').eq('source', 'voicebot').eq('external_id', p.CallSid).maybeSingle();
  if (!call) return twiml('<Hangup/>');

  const meta = { ...((call.ai_meta as Record<string, unknown>) || {}) };
  const prior = (meta.transfer as Record<string, unknown> | undefined) ?? {};
  meta.transfer = { ...prior, status, duration_sec: duration, ended_at: new Date().toISOString() };
  await db.from('crm_call_log').update({ ai_meta: meta, updated_at: new Date().toISOString() }).eq('id', call.id);

  if (status === 'completed') return twiml('<Hangup/>');

  // Nobody reached: take the message. The turn route sees meta.transfer and won't offer another transfer.
  const lang = asLang(meta.lang);
  const multi = meta.stt === 'multi';
  const voice = meta.voice === 'new' ? 'new' as const : 'classic' as const;
  const text = line('transferMissed', lang);
  await db.from('crm_call_turns').insert({ call_id: call.id, role: 'bot', text, meta: { action: 'continue', lang, after_dial: status } });
  return twiml(gather(text, `${voiceOrigin()}/api/voice/turn`, { hints: await speechHints(call.business_unit), lang, multi, voice }));
}
