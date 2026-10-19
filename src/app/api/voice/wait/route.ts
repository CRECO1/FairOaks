import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { holdThenRedirect, renderReply, type DialTarget, say, twiml, twilioConfigured, twilioParams, verifyTwilioSignature, voiceOrigin } from '@/lib/twilio';
import { loadSettings } from '@/lib/voicebot';
import { asLang, line } from '@/lib/voice-lines';
import { speechHints } from '@/lib/listing-knowledge';

export const dynamic = 'force-dynamic';

const MAX_WAIT_MS = 40_000; // past this the caller has waited long enough — take a message instead

/**
 * POST /api/voice/wait?after=<caller turn id>
 * Twilio polls here (every ~2s) while a slow reply is still being worked out in
 * the background by /api/voice/turn. As soon as the bot's line for that turn is
 * stored, it's spoken; until then, a short pause and another poll.
 */
export async function POST(req: Request) {
  if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const p = await twilioParams(req);
  if (!verifyTwilioSignature(req, p)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  const after = new URL(req.url).searchParams.get('after') || '';
  const db = adminClient();

  const { data: call } = await db.from('crm_call_log').select('id, business_unit, from_number, ai_meta').eq('source', 'voicebot').eq('external_id', p.CallSid).maybeSingle();
  if (!call) return twiml(`${say(line('wentWrong'))}<Hangup/>`);

  const { data: callerTurn } = after ? await db.from('crm_call_turns').select('id, created_at').eq('id', after).eq('call_id', call.id).maybeSingle() : { data: null };
  const { data: botTurn } = await db.from('crm_call_turns').select('text, meta, created_at').eq('call_id', call.id).eq('role', 'bot')
    .gt('created_at', callerTurn?.created_at ?? '1970-01-01').order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (botTurn) {
    const settings = await loadSettings(db, call.business_unit);
    const action = ((botTurn.meta as { action?: string } | null)?.action ?? 'continue') as 'continue' | 'end' | 'transfer';
    const lang = asLang((botTurn.meta as { lang?: string } | null)?.lang ?? (call.ai_meta as { lang?: string } | null)?.lang);
    const multi = (call.ai_meta as { stt?: string } | null)?.stt === 'multi';
    const voice = (call.ai_meta as { voice?: string } | null)?.voice === 'new' ? 'new' as const : 'classic' as const;
    const t = (botTurn.meta as { transfer?: { name?: string; number?: string } } | null)?.transfer;
    const dial: DialTarget | null = action === 'transfer' && t?.number ? { name: t.name || 'agent', number: t.number, callerId: settings.twilio_number } : null;
    return twiml(renderReply({ say: botTurn.text, action }, settings, call.from_number, await speechHints(call.business_unit), { lang, multi, voice, dial }));
  }
  const waited = callerTurn ? Date.now() - new Date(callerTurn.created_at).getTime() : MAX_WAIT_MS;
  if (waited > MAX_WAIT_MS) {
    await db.from('crm_call_turns').insert({ call_id: call.id, role: 'bot', text: '[timed out waiting for a reply]', meta: { action: 'end' } });
    const lang = asLang((call.ai_meta as { lang?: string } | null)?.lang);
    const vgen = (call.ai_meta as { voice?: string } | null)?.voice === 'new' ? 'new' as const : 'classic' as const;
    return twiml(`${say(line('timedOut', lang), lang, vgen)}<Hangup/>`);
  }
  return twiml(holdThenRedirect(null, `${voiceOrigin()}/api/voice/wait?after=${encodeURIComponent(after)}`, 2));
}
