import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminClient } from '@/lib/supabase-admin';
import { shortHangup, syncTalkroute, talkrouteConfigured, upsertCalls, type CallRow } from '@/lib/talkroute';
import { matchContact, unitForNumber } from '@/lib/voicebot';
import { toE164 } from '@/lib/phone';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/webhooks/talkroute?key=<TALKROUTE_WEBHOOK_SECRET>
 *
 * Talkroute pushes new_call_record / new_voicemail / call_completed here the moment
 * they happen, so a missed call shows in the log within seconds instead of at the
 * next 15-minute sync. Payloads carry no signature, so the secret rides in the URL.
 *
 * The push payloads have no record id, so a pushed row is keyed by number+time and
 * the next API sync (which does carry ids) reconciles it.
 */
interface CallPayload { datetime?: string; call_result?: string; direction?: string; duration?: number; caller_number?: string; called_number?: string; caller_cname?: string }
interface VmPayload { datetime?: string; call_result?: string; duration?: number; called_number?: string; caller_number?: string; transcription?: string; mailbox_name?: string }

function keyed(secret: string, req: NextRequest): boolean {
  const got = req.nextUrl.searchParams.get('key') ?? '';
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.TALKROUTE_WEBHOOK_SECRET;
  if (!secret) { console.warn('[webhooks/talkroute] TALKROUTE_WEBHOOK_SECRET unset — refusing'); return NextResponse.json({ error: 'not configured' }, { status: 503 }); }
  if (!keyed(secret, req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  // Talkroute may wrap the payload; accept {type, data} or a bare payload with ?type=.
  const type = String(body.type ?? body.event ?? req.nextUrl.searchParams.get('type') ?? '');
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
  const db = adminClient();

  if (type === 'new_call_record' || type === 'call_completed') {
    const p = data as CallPayload;
    const inbound = p.direction !== 'outbound';
    const ours = toE164(p.called_number), theirs = toE164(p.caller_number);
    const unit = await unitForNumber(db, ours);
    const contact = await matchContact(db, theirs, unit);
    const at = p.datetime ? new Date(p.datetime).toISOString() : new Date().toISOString();
    const row: CallRow = {
      business_unit: unit, source: 'talkroute', kind: 'call', external_id: `push:${ours ?? ''}:${theirs ?? ''}:${at.slice(0, 16)}`,
      direction: inbound ? 'inbound' : 'outbound', result: p.call_result ?? null,
      from_number: inbound ? theirs : ours, to_number: inbound ? ours : theirs,
      caller_name: p.caller_cname || null, contact_id: contact?.id ?? null,
      started_at: at, duration_sec: p.duration ?? null, recording_url: null, transcript: null,
      needs_follow_up: inbound && (p.call_result === 'missed' || shortHangup(p.call_result, p.duration)), raw: { type, ...data },
    };
    await upsertCalls(db, [row]);
    // Pull the authoritative record (with id + recording) straight away rather than waiting for the cron.
    if (talkrouteConfigured()) { try { await syncTalkroute(db, { sinceHours: 2, maxPages: 1 }); } catch (e) { console.warn('[webhooks/talkroute] sync', e); } }
    return NextResponse.json({ ok: true });
  }

  if (type === 'new_voicemail') {
    const p = data as VmPayload;
    const ours = toE164(p.called_number), theirs = toE164(p.caller_number);
    const unit = await unitForNumber(db, ours);
    const contact = await matchContact(db, theirs, unit);
    const at = p.datetime ? new Date(p.datetime).toISOString() : new Date().toISOString();
    const row: CallRow = {
      business_unit: unit, source: 'talkroute', kind: 'voicemail', external_id: `pushvm:${ours ?? ''}:${theirs ?? ''}:${at.slice(0, 16)}`,
      direction: 'inbound', result: 'voicemail', from_number: theirs, to_number: ours,
      caller_name: null, contact_id: contact?.id ?? null, started_at: at, duration_sec: p.duration ?? null,
      recording_url: null, transcript: p.transcription || null, needs_follow_up: true, raw: { type, ...data },
    };
    await upsertCalls(db, [row]);
    if (talkrouteConfigured()) { try { await syncTalkroute(db, { sinceHours: 2, maxPages: 1 }); } catch (e) { console.warn('[webhooks/talkroute] sync', e); } }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: type || 'unknown' });
}
