// Call block list: numbers the inbound voice flow turns away. See supabase/20261022_call_blocklist.sql.
// Everything here FAILS OPEN — a lookup error must never stop a real call from being answered.
import type { SupabaseClient } from '@supabase/supabase-js';
import { digits, toE164 } from '@/lib/phone';
import { ownLineNumbers } from '@/lib/voicebot';
import { internalNumbers } from '@/lib/call-history';

export interface BlockedNumber {
  id: string; phone_e164: string; phone_key: string; business_unit: string; reason: string | null;
  source: 'auto' | 'manual'; created_by: string | null; call_id: string | null; hits: number;
  last_blocked_at: string | null; created_at: string;
}

/**
 * The matching key for a caller ID: last 10 digits for a US/Canada number (so +1, 1-, parentheses and
 * dashes all collapse), the full digits for an international one. Null for anything that isn't a real
 * number ("anonymous", "restricted", "266696687", short codes) — those are never blocked or listed.
 */
export function blockKey(n: string | null | undefined): string | null {
  const raw = String(n ?? '').trim();
  const d = digits(raw);
  if (d.length === 10) return d;
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (raw.startsWith('+') && d.length >= 11 && d.length <= 15) return d;
  return null;
}

/** The block-list row that matches this caller on this line, or null (also null on any error). */
export async function findBlock(db: SupabaseClient, number: string | null | undefined, unit: string): Promise<BlockedNumber | null> {
  const key = blockKey(number);
  if (!key) return null;
  try {
    const { data, error } = await db.from('crm_blocked_numbers').select('*').eq('phone_key', key).in('business_unit', ['all', unit]).limit(1).maybeSingle();
    if (error) { console.warn('[call-blocklist] lookup failed, failing open:', error.message); return null; }
    return (data as BlockedNumber | null) ?? null;
  } catch (e) { console.warn('[call-blocklist] lookup threw, failing open:', e); return null; }
}

/** Count a turned-away call against the row (best effort). */
export async function recordBlockedHit(db: SupabaseClient, b: Pick<BlockedNumber, 'id' | 'hits'>): Promise<void> {
  try { await db.from('crm_blocked_numbers').update({ hits: (b.hits ?? 0) + 1, last_blocked_at: new Date().toISOString() }).eq('id', b.id); }
  catch (e) { console.warn('[call-blocklist] hit count', e); }
}

/**
 * Hand-block guard: the numbers that must never be on the list because blocking them would cut the
 * company off from itself — our own lines, team phones, and the phones Talkroute forwards to.
 */
export async function isOurNumber(db: SupabaseClient, number: string): Promise<boolean> {
  const key = blockKey(number);
  if (!key) return false;
  const [own, internal] = await Promise.all([ownLineNumbers(db), internalNumbers(db, 'commercial')]);
  return own.has(key) || internal.has(key);
}

/** Is this number on a saved contact's card (any workspace, phone or cell)? */
async function belongsToContact(db: SupabaseClient, key: string): Promise<boolean> {
  const tail = key.slice(-4);
  const { data, error } = await db.from('crm_clients').select('phone, cell_phone').or(`phone.ilike.%${tail}%,cell_phone.ilike.%${tail}%`).limit(200);
  if (error) throw error; // can't prove it's safe → caller treats as unsafe
  return (data ?? []).some(c => blockKey(c.phone) === key || blockKey(c.cell_phone) === key);
}

/**
 * May the bot AUTO-block this call? Only an unknown, ordinary 10-digit number that the bot itself flagged as spam.
 * Anything uncertain → no (an unblocked robocall is a nuisance; a blocked prospect is lost business).
 */
export async function autoBlockVerdict(db: SupabaseClient, call: {
  business_unit: string; number: string | null; contact_id: string | null; caller_name_said: boolean; callback_number: string | null; transferred: boolean;
}): Promise<{ ok: true; key: string } | { ok: false; why: string }> {
  const key = blockKey(call.number);
  if (!key || key.length !== 10) return { ok: false, why: 'no usable caller number' };
  if (call.contact_id) return { ok: false, why: 'call is linked to a saved contact' };
  if (call.transferred) return { ok: false, why: 'call was transferred to a person' };
  if (call.caller_name_said) return { ok: false, why: 'caller gave a name' };
  if (call.callback_number && blockKey(call.callback_number) && blockKey(call.callback_number) !== key) return { ok: false, why: 'caller asked for a call-back on a different number' };
  try {
    if (await isOurNumber(db, key)) return { ok: false, why: 'one of our own / team numbers' };
    if (await belongsToContact(db, key)) return { ok: false, why: 'number belongs to a saved contact' };
    if (call.callback_number && await belongsToContact(db, blockKey(call.callback_number) ?? key)) return { ok: false, why: 'call-back number belongs to a saved contact' };
  } catch (e) { return { ok: false, why: `safety lookup failed (${e instanceof Error ? e.message : 'error'})` }; }
  return { ok: true, key };
}

/** Add a number. Idempotent: an existing row for the same number+line is returned untouched. */
export async function addBlock(db: SupabaseClient, o: {
  number: string; unit?: string; reason?: string | null; source: 'auto' | 'manual'; createdBy?: string | null; callId?: string | null;
}): Promise<{ row: BlockedNumber; created: boolean } | { error: string }> {
  const key = blockKey(o.number);
  if (!key) return { error: 'That is not a valid phone number.' };
  const unit = o.unit && ['all', 'commercial', 'residential'].includes(o.unit) ? o.unit : 'all';
  const { data: existing } = await db.from('crm_blocked_numbers').select('*').eq('phone_key', key).eq('business_unit', unit).maybeSingle();
  if (existing) return { row: existing as BlockedNumber, created: false };
  const { data, error } = await db.from('crm_blocked_numbers').insert({
    phone_e164: toE164(o.number) ?? o.number, phone_key: key, business_unit: unit, reason: o.reason?.trim().slice(0, 200) || null,
    source: o.source, created_by: o.createdBy ?? null, call_id: o.callId ?? null,
  }).select('*').single();
  if (error || !data) {
    // Lost a race with another insert for the same key → it exists now.
    const { data: again } = await db.from('crm_blocked_numbers').select('*').eq('phone_key', key).eq('business_unit', unit).maybeSingle();
    if (again) return { row: again as BlockedNumber, created: false };
    return { error: error?.message ?? 'Could not save the block.' };
  }
  return { row: data as BlockedNumber, created: true };
}

/** What the bot says to a blocked caller before hanging up. */
export const BLOCKED_MESSAGE = 'We are unable to take your call at this time. Goodbye.';
