import { NextResponse, after } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { holdThenRedirect, renderReply, type DialTarget, say, startRecordingWhenLive, twiml, twilioConfigured, twilioParams, verifyTwilioSignature, voiceOrigin } from '@/lib/twilio';
import { loadSettings, nextReply, officeOpen, spokenFirstName, type BotReply, type Turn } from '@/lib/voicebot';
import { mayRingNow, pickTarget, transferOptions } from '@/lib/voice-transfer';
import { speechHints } from '@/lib/listing-knowledge';
import { toE164 } from '@/lib/phone';
import { asLang, holdLine, line, type Lang } from '@/lib/voice-lines';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TURNS = 12; // caller utterances — a hard stop so a confused loop can't run up minutes

/**
 * POST /api/voice/turn — Twilio <Gather> result: what the caller just said.
 * Append it, ask Claude for the next line, say it, and either listen again,
 * transfer, or hang up.
 */
export async function POST(req: Request) {
  if (!twilioConfigured()) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const p = await twilioParams(req);
  if (!verifyTwilioSignature(req, p)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const db = adminClient();
  const { data: call } = await db.from('crm_call_log').select('id, business_unit, from_number, contact_id, caller_name, ai_meta, recording_url').eq('source', 'voicebot').eq('external_id', p.CallSid).maybeSingle();
  if (!call) return twiml(`${say(line('wentWrong'))}<Hangup/>`);

  // Backstop: if the recording still hasn't started by the caller's first words, the
  // call is certainly live now — start it (one try, in the background).
  if (!call.recording_url) {
    after(() => startRecordingWhenLive(p.CallSid, async sid => {
      await db.from('crm_call_log').update({ recording_url: `twilio:${sid}` }).eq('id', call.id).is('recording_url', null);
    }, [0]));
  }

  const heard = (p.SpeechResult || '').trim();
  const callMeta = (call.ai_meta as Record<string, unknown> | null) || {};
  const multi = callMeta.stt === 'multi';
  const voice = callMeta.voice === 'new' ? 'new' as const : 'classic' as const;
  let lang: Lang = asLang(callMeta.lang);
  // Every round trip here is on the caller's clock — run them together, and build the
  // history from what was already stored plus what was just said.
  const [settings, { data: callerTurn }, { data: priorRows }, contactRow, hints] = await Promise.all([
    loadSettings(db, call.business_unit),
    db.from('crm_call_turns').insert({ call_id: call.id, role: 'caller', text: heard || '(silence)' }).select('id').single(),
    db.from('crm_call_turns').select('role, text').eq('call_id', call.id).order('created_at'),
    call.contact_id ? db.from('crm_clients').select('id, first_name, last_name, business_name').eq('id', call.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    speechHints(call.business_unit),
  ]);
  const history = [...((priorRows ?? []) as Turn[]), { role: 'caller' as const, text: heard || '(silence)' }];
  const callerTurns = history.filter(t => t.role === 'caller').length;
  const c = contactRow?.data;
  const contact = c ? { id: c.id as string, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || (c.business_name as string) || 'Contact', business_name: (c.business_name as string | null) ?? null, first: spokenFirstName(c.first_name as string | null) } : null;

  // Who Ava may ring on this call (nobody once a ring has already been tried), and who she picks for this turn.
  const tried = Boolean(callMeta.transfer);
  const options = tried ? [] : await transferOptions(db, settings, callMeta.caller_id_unknown === true ? null : call.from_number, call.business_unit);
  let dial: DialTarget | null = null;

  // Work out the reply, store it with what to do next, and keep the call row current.
  const work = (async (): Promise<BotReply> => {
    let reply: BotReply = callerTurns >= MAX_TURNS
      ? { say: line('maxTurns', lang), action: 'end', language: lang }
      : await nextReply(settings, history, { callerNumber: callMeta.caller_id_unknown === true ? null : call.from_number, contact, lang,
          transfer: { names: options.map(o => o.key), open: officeOpen(), tried }, forwarded: callMeta.caller_id_unknown === true });
    // A transfer only happens to someone we can ring right now; otherwise Ava takes the message instead of promising a connection she can't make.
    let target = null as ReturnType<typeof pickTarget>;
    if (reply.action === 'transfer') {
      target = mayRingNow(reply.urgent === true) ? pickTarget(options, reply.transfer_to) : null;
      if (target) dial = { name: target.name, number: target.number, callerId: settings.twilio_number };
      else reply = { ...reply, say: line('noTransfer', reply.language ?? lang), action: 'continue' };
    }
    // The model says which language it answered in; keep the call there until it changes.
    if (reply.language) lang = reply.language;
    await db.from('crm_call_turns').insert({ call_id: call.id, role: 'bot', text: reply.say, meta: { action: reply.action, after_turn: callerTurn?.id ?? null, lang, ...(target ? { transfer: { name: target.name, key: target.key, number: target.number } } : {}) } });
    const meta = { ...((call.ai_meta as Record<string, unknown>) || {}) };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (reply.caller_name) { meta.caller_name = reply.caller_name; if (!call.caller_name || call.caller_name === contact?.name) patch.caller_name = reply.caller_name; }
    if (reply.callback_number) { meta.callback_number = reply.callback_number; patch.callback_number = toE164(reply.callback_number); }
    if (reply.intent) { meta.intent = reply.intent; patch.intent = reply.intent; }
    if (reply.property) meta.property = reply.property;
    if (reply.caller_email) meta.caller_email = reply.caller_email;
    if (reply.needs_follow_up === false) meta.bot_said_no_follow_up = true;
    meta.lang = lang;
    if (target) meta.transfer = { to: target.name, key: target.key, number: target.number, urgent: reply.urgent === true, at: new Date().toISOString() };
    if (lang === 'es') meta.spoke_spanish = true;
    patch.ai_meta = meta;
    await db.from('crm_call_log').update(patch).eq('id', call.id);
    return reply;
  })();

  // Twilio gives a webhook 15 seconds. Answer directly when the reply is quick;
  // otherwise say so, let the work finish in the background, and have Twilio poll.
  const quick = await Promise.race<BotReply | null>([work, new Promise<null>(res => setTimeout(() => res(null), QUICK_BUDGET_MS))]);
  if (quick) return twiml(renderReply(quick, settings, call.from_number, hints, { lang, multi, voice, dial }));
  after(work.catch(e => console.error('[voice/turn] background', e)));
  const waitUrl = `${voiceOrigin()}/api/voice/wait?after=${encodeURIComponent(callerTurn?.id ?? '')}`;
  return twiml(holdThenRedirect(holdLine(callerTurns, lang), waitUrl, 2, lang, voice));
}

const QUICK_BUDGET_MS = 6500;
