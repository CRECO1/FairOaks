import { NextResponse, after } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { say, twiml, twilioConfigured, twilioParams, verifyTwilioSignature } from '@/lib/twilio';
import { blockKey } from '@/lib/block-key';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const GOODBYE = 'We are unable to take your call at this time. Goodbye.'; // same words as BLOCKED_MESSAGE in lib/call-blocklist
const LOOKUP_BUDGET_MS = 2500; // Talkroute only waits a few seconds on this leg; past that, let the team ring

/**
 * POST /api/voice/screen — the "call screen" forwarding number, FIRST member of a Talkroute team ring group.
 *
 *   blocked caller → answer, say goodbye, hang up. The call ends here: no phone in the ring group ever rings.
 *   anyone else    → <Reject reason="busy"/>. The leg fails instantly and Talkroute moves on to the next
 *                    member (the team), exactly as if the screen weren't there. Rejected calls are not billed.
 *
 * It must NEVER be the reason a real call is lost, so every doubt resolves to "advance": Twilio or the database
 * not configured, a bad signature, an unusable caller ID, a lookup error or a slow lookup. No AI, one indexed query.
 *
 * The screen can't tell which Talkroute line was dialled, so it matches a block on ANY line — a spam number
 * blocked for one line is turned away on both here (the bot's own check, voice/inbound, still honours the line).
 * The call itself is logged by Talkroute; lib/call-routing marks the "answered by Call screen" leg as blocked.
 */
export async function POST(req: Request) {
  const advance = () => twiml('<Reject reason="busy"/>');
  try {
    if (!twilioConfigured()) return advance();
    const p = await twilioParams(req);
    if (!verifyTwilioSignature(req, p)) return advance();
    const key = blockKey(p.From);
    if (!key) return advance(); // withheld / anonymous / short code: never screened out

    const db = adminClient();
    const lookup = db.from('crm_blocked_numbers').select('id, hits').eq('phone_key', key).limit(1).maybeSingle()
      .then(r => (r.error ? null : r.data), () => null);
    const row = await Promise.race([lookup, new Promise<null>(res => setTimeout(() => res(null), LOOKUP_BUDGET_MS))]);
    if (!row) return advance();

    after(async () => {
      try { await db.from('crm_blocked_numbers').update({ hits: ((row.hits as number) ?? 0) + 1, last_blocked_at: new Date().toISOString() }).eq('id', row.id); }
      catch (e) { console.warn('[voice/screen] hit count', e); }
    });
    return twiml(`${say(GOODBYE)}<Hangup/>`);
  } catch (e) {
    console.warn('[voice/screen] failing open', e);
    return advance();
  }
}

// Anything but Twilio's POST: nothing to do. (Never 5xx a real call's leg by accident.)
export async function GET() { return NextResponse.json({ ok: true, service: 'call-screen' }); }
