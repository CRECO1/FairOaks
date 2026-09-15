// ─────────────────────────────────────────────────────────────────────────────
// Talkroute — the brokerage's phone system. Its public API is deliberately
// non-voice (no call control, no media), so it is our SOURCE OF RECORD for calls
// and voicemails, while the AI voice bot lives on Twilio (see voicebot.ts).
//
//   API base   https://api.talkroute.com/api/v2   Bearer tr_live_<64 hex>
//   Call log   GET /call-history?after=&before=&page=&pageSize=
//   Voicemail  GET /voice-messages  +  GET /voice-messages/{id}/audio-url
//   Webhooks   POST /subscriptions {hookUrl, type}  — new_call_record | new_voicemail |
//              call_completed | new_text_message. Payloads are not signed, so our
//              hook URL carries a secret in the query string.
// ─────────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from '@supabase/supabase-js';
import { toE164 } from '@/lib/phone';
import { matchContact, unitForNumber } from '@/lib/voicebot';

const BASE = 'https://api.talkroute.com/api/v2';

export function talkrouteConfigured(): boolean {
  return !!process.env.TALKROUTE_API_KEY;
}

export class TalkrouteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function tr<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.TALKROUTE_API_KEY;
  if (!key) throw new TalkrouteError(0, 'TALKROUTE_API_KEY is not set');
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
    cache: 'no-store',
  });
  const text = await r.text();
  if (!r.ok) throw new TalkrouteError(r.status, `Talkroute ${r.status} on ${path}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text) as T; } catch { throw new TalkrouteError(r.status, `Talkroute returned non-JSON on ${path}`); }
}

// ── Shapes (from the published OpenAPI spec, Talkroute 2.0.x) ────────────────
export interface TrCallEvent { id: string; type: string; description?: string; createdAt?: string }
export interface TrCallRecord {
  id: string; direction: 'inbound' | 'outbound'; callDate: string;
  externalName?: string | null; externalNumber?: string; phoneNumber?: string;
  duration?: number; recorded?: boolean; recording?: string; result?: string; events?: TrCallEvent[];
}
export interface TrVoiceMessage {
  id: string; read: boolean; phoneNumber?: string; callResult?: string; callerName?: string; callerNumber?: string;
  duration?: number; transcript?: string; transcriptionInProgress?: boolean; audioLink?: string; createdAt?: string;
}
interface Paged<T> { data: T[]; pagination?: { totalPages?: number; currentPage?: number; nextPageUrl?: string | null } }
export interface TrSubscription { id?: string; hookUrl: string; type: 'new_text_message' | 'new_call_record' | 'new_voicemail' | 'call_completed' }

/** Plan + feature gates — some endpoints answer 402 when the plan doesn't include them. */
export async function getPlanInfo(): Promise<{ plan: unknown; features: unknown; probes: Record<string, number> }> {
  const safe = async (path: string) => { try { return await tr<unknown>(path); } catch (e) { return { error: e instanceof TalkrouteError ? e.status : String(e) }; } };
  const [plan, features] = await Promise.all([safe('/accounts/plan'), safe('/accounts/permitted-features')]);
  const probes: Record<string, number> = {};
  const after = encodeURIComponent(new Date(Date.now() - 48 * 3_600_000).toISOString());
  for (const path of ['/call-history?pageSize=1', '/call-history?pageSize=100', '/call-history?pageSize=25', '/call-history?page=1', '/call-history?page=2', `/call-history?after=${after}`, `/call-history?after=${after}&page=1&pageSize=100`, '/voice-messages?pageSize=1', '/voice-messages?pageSize=100', '/virtual-numbers', '/subscriptions']) {
    try { await tr(path); probes[path] = 200; } catch (e) { probes[path] = e instanceof TalkrouteError ? e.status : -1; }
  }
  return { plan, features, probes };
}

export async function getAccount(): Promise<Record<string, unknown>> {
  const j = await tr<{ data?: Record<string, unknown> }>('/account');
  return j.data ?? j;
}

export async function listCallHistory(opts: { after?: string; before?: string; page?: number; pageSize?: number } = {}): Promise<Paged<TrCallRecord>> {
  const q = new URLSearchParams();
  // NOTE: `after`/`before` return 402 on plans without date-filtered reporting — callers page instead.
  if (opts.after) q.set('after', opts.after);
  if (opts.before) q.set('before', opts.before);
  q.set('page', String(opts.page ?? 1));
  q.set('pageSize', String(opts.pageSize ?? 100));
  return tr<Paged<TrCallRecord>>(`/call-history?${q}`);
}

export async function listVoiceMessages(opts: { page?: number; pageSize?: number } = {}): Promise<Paged<TrVoiceMessage>> {
  const q = new URLSearchParams({ page: String(opts.page ?? 1), pageSize: String(opts.pageSize ?? 100) });
  return tr<Paged<TrVoiceMessage>>(`/voice-messages?${q}`);
}

/** Short-lived S3 link to a voicemail's audio — fetched on demand, never stored long-term. */
export async function voicemailAudioUrl(id: string): Promise<string | null> {
  const j = await tr<{ url?: string; data?: { url?: string } }>(`/voice-messages/${encodeURIComponent(id)}/audio-url`);
  return j.url ?? j.data?.url ?? null;
}

export async function listSubscriptions(): Promise<TrSubscription[]> {
  const j = await tr<Paged<TrSubscription>>('/subscriptions?pageSize=100');
  return j.data ?? [];
}
export async function createSubscription(sub: TrSubscription): Promise<TrSubscription> {
  const j = await tr<{ data: TrSubscription }>('/subscriptions', { method: 'POST', body: JSON.stringify(sub) });
  return j.data;
}
export async function deleteSubscription(id: string): Promise<void> {
  await tr(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Normalisation into crm_call_log rows ─────────────────────────────────────────
export interface CallRow {
  business_unit: string; source: string; kind: string; external_id: string; direction: string; result: string | null;
  from_number: string | null; to_number: string | null; caller_name: string | null; contact_id: string | null;
  started_at: string; duration_sec: number | null; recording_url: string | null; transcript: string | null;
  needs_follow_up: boolean; raw: unknown;
}

function callResult(r?: string): string | null {
  if (!r) return null;
  const v = r.toLowerCase();
  return ['answered', 'missed', 'hangup'].includes(v) ? v : v;
}

/** Inbound "hangup" under a minute = the caller gave up before anyone answered. */
export const SHORT_HANGUP_SEC = 60;
export function shortHangup(result: string | null | undefined, durationSec: number | null | undefined): boolean {
  return result === 'hangup' && durationSec != null && durationSec < SHORT_HANGUP_SEC;
}

export async function callRecordToRow(rec: TrCallRecord, db: SupabaseClient): Promise<CallRow> {
  const inbound = rec.direction !== 'outbound';
  const ours = toE164(rec.phoneNumber);
  const theirs = toE164(rec.externalNumber);
  const unit = await unitForNumber(db, ours);
  const contact = await matchContact(db, theirs, unit);
  const result = callResult(rec.result);
  // A voicemail event on the call means Talkroute's mailbox picked up — the
  // voicemail row (from /voice-messages) carries the transcript; this row is the call.
  const reachedVoicemail = (rec.events ?? []).some(e => e.type === 'voicemail');
  return {
    business_unit: unit, source: 'talkroute', kind: 'call', external_id: `call:${rec.id}`,
    direction: inbound ? 'inbound' : 'outbound', result,
    from_number: inbound ? theirs : ours, to_number: inbound ? ours : theirs,
    // Talkroute repeats the number as the name when there is no CNAM — that is not a name.
    caller_name: rec.externalName && !/^[\d\s()+.-]+$/.test(rec.externalName) ? rec.externalName : null, contact_id: contact?.id ?? null,
    started_at: rec.callDate, duration_sec: rec.duration ?? null,
    recording_url: rec.recorded && rec.recording ? rec.recording : null,
    transcript: null,
    // A missed inbound call that nobody has returned is the whole point of the log —
    // and so is a caller who gave up on the menu or the ringing within a minute.
    needs_follow_up: inbound && (result === 'missed' || reachedVoicemail || shortHangup(result, rec.duration)),
    raw: rec,
  };
}

export async function voicemailToRow(vm: TrVoiceMessage, db: SupabaseClient): Promise<CallRow> {
  const ours = toE164(vm.phoneNumber);
  const theirs = toE164(vm.callerNumber);
  const unit = await unitForNumber(db, ours);
  const contact = await matchContact(db, theirs, unit);
  return {
    business_unit: unit, source: 'talkroute', kind: 'voicemail', external_id: `vm:${vm.id}`,
    direction: 'inbound', result: 'voicemail',
    from_number: theirs, to_number: ours,
    caller_name: vm.callerName && !/^[\d\s()+.-]+$/.test(vm.callerName) ? vm.callerName : null, contact_id: contact?.id ?? null,
    started_at: vm.createdAt || new Date().toISOString(), duration_sec: vm.duration ?? null,
    recording_url: vm.audioLink || null,
    transcript: vm.transcriptionInProgress ? null : (vm.transcript || null),
    needs_follow_up: !vm.read,
    raw: vm,
  };
}

/**
 * Upsert provider rows without clobbering what an agent has done since: follow-up
 * flags, handled state, notes and contact links are only set on first insert.
 */
export async function upsertCalls(db: SupabaseClient, rows: CallRow[]): Promise<{ inserted: number; updated: number }> {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const ids = rows.map(r => r.external_id);
  const { data: existing } = await db.from('crm_call_log').select('id, external_id, transcript, recording_url').eq('source', 'talkroute').in('external_id', ids);
  const byExt = new Map((existing ?? []).map(e => [e.external_id as string, e]));
  let inserted = 0, updated = 0;
  const fresh = rows.filter(r => !byExt.has(r.external_id));
  if (fresh.length) {
    const { error } = await db.from('crm_call_log').insert(fresh);
    if (error) throw new Error(`crm_call_log insert: ${error.message}`);
    inserted = fresh.length;
  }
  for (const r of rows) {
    const ex = byExt.get(r.external_id);
    if (!ex) continue;
    // Transcripts arrive late and recording links expire and get re-signed — refresh those only.
    const patch: Record<string, unknown> = {};
    if (r.transcript && r.transcript !== ex.transcript) patch.transcript = r.transcript;
    if (r.recording_url && r.recording_url !== ex.recording_url) patch.recording_url = r.recording_url;
    if (r.duration_sec != null) patch.duration_sec = r.duration_sec;
    if (r.result) patch.result = r.result;
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      const { error } = await db.from('crm_call_log').update(patch).eq('id', ex.id);
      if (!error) updated++;
    }
  }
  return { inserted, updated };
}

/** Pull recent call records + voicemails from Talkroute into crm_call_log. */
export async function syncTalkroute(db: SupabaseClient, opts: { sinceHours?: number; maxPages?: number } = {}): Promise<{ calls: number; voicemails: number; inserted: number; updated: number; callHistoryBlocked: boolean }> {
  const sinceHours = opts.sinceHours ?? 48;
  const maxPages = opts.maxPages ?? 5;
  const after = new Date(Date.now() - sinceHours * 3_600_000).toISOString();

  const rows: CallRow[] = [];
  let calls = 0, voicemails = 0;
  let callHistoryBlocked = false;
  const cutoff = Date.parse(after);
  // Talkroute's Basic plan answers 402 to the `after` date filter (date-filtered
  // reporting is a paid feature) but pages fine, so page newest-first and stop
  // once a whole page is older than the window.
  for (let page = 1; page <= maxPages; page++) {
    let j: Paged<TrCallRecord>;
    try { j = await listCallHistory({ page, pageSize: 100 }); }
    catch (e) {
      if (e instanceof TalkrouteError && (e.status === 402 || e.status === 403)) { callHistoryBlocked = true; break; }
      throw e;
    }
    const data = j.data ?? [];
    let anyRecent = false;
    for (const rec of data) {
      if (rec.callDate && Date.parse(rec.callDate) < cutoff) continue;
      anyRecent = true;
      rows.push(await callRecordToRow(rec, db)); calls++;
    }
    const totalPages = j.pagination?.totalPages ?? 1;
    if (!anyRecent || page >= totalPages || !data.length) break;
  }
  for (let page = 1; page <= maxPages; page++) {
    const j = await listVoiceMessages({ page, pageSize: 100 });
    const data = j.data ?? [];
    let anyRecent = false;
    for (const vm of data) {
      if (vm.createdAt && Date.parse(vm.createdAt) < cutoff) continue;
      anyRecent = true;
      rows.push(await voicemailToRow(vm, db)); voicemails++;
    }
    const totalPages = j.pagination?.totalPages ?? 1;
    if (!anyRecent || page >= totalPages || !data.length) break;
  }
  const { inserted, updated } = await upsertCalls(db, rows);
  return { calls, voicemails, inserted, updated, callHistoryBlocked };
}
