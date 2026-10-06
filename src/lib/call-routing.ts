/**
 * Calling Log housekeeping: who owns a call, who answered it, and keeping the
 * call-back queue honest. Runs after every Talkroute sync/webhook and every bot
 * call (tidyCallLog), so the queue fixes itself without anyone clicking.
 *
 * Ownership follows the same rule as web leads (CRECOWEBSITE src/lib/broker.ts):
 * Zack owns French Pl / Beacon Hill, AutoBrite, Elkhorn Point and 8000 Fair Oaks;
 * Brian owns everything else on the commercial side; each backs the other up.
 * An existing contact's own agent wins over all of that.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { last10 } from '@/lib/phone';
import { isBusinessOpen } from '@/lib/talkroute';
import { matchContact } from '@/lib/voicebot';

export interface Profile { id: string; email: string | null; first_name: string | null; last_name: string | null; role: string | null }

/** Zack's listings, as callers and the bot describe them. */
const ZACK_PROPERTIES = /french\s*pl|beacon\s*hill|1353\b|auto\s*-?\s*brite|5402\b|rigsby|car\s*wash|elkhorn|dietz|8923\b|8000\s*fair\s*oaks|fair\s*oaks\s*(pkwy|parkway|plaza)/i;

/** Spam and robocalls — and the number is worth remembering as spam. */
const SPAM = /\b(spam|robo\s*call|robocall|automated (spam|call|message)|no live caller|telemarket|sales pitch)\b/i;
/** Silent calls and misdials — nothing to call back about, but not spam (could be a bad line). */
const NOTHING = /\b(silent call|misdial|wrong number)\b/i;

export function zackProfile(profiles: Profile[]): Profile | undefined {
  return profiles.find(p => p.role === 'super_admin');
}
export function brianProfile(profiles: Profile[]): Profile | undefined {
  return profiles.find(p => (p.email ?? '').toLowerCase() === 'brian@crecotx.com');
}

/** Who should return a call: the contact's agent, else the listing's owner, else the unit default. */
export function ownerFor(
  call: { business_unit: string; summary?: string | null; intent?: string | null; ai_meta?: Record<string, unknown> | null },
  contact: { agent_id?: string | null } | null,
  profiles: Profile[],
): string | null {
  if (contact?.agent_id && profiles.some(p => p.id === contact.agent_id)) return contact.agent_id;
  const zack = zackProfile(profiles), brian = brianProfile(profiles);
  const text = [call.ai_meta?.property, call.intent, call.summary].filter(Boolean).join(' ');
  // A caller who asks for someone by name gets that person.
  const asked = profiles.find(p => {
    const first = (p.first_name ?? '').split(' ')[0];
    if (p.id === zack?.id) return /\b(zach|zack|zachary|stovall)\b/i.test(text);
    return first.length >= 3 && new RegExp(`\\b${first}\\b`, 'i').test(text);
  });
  if (asked) return asked.id;
  if (ZACK_PROPERTIES.test(text)) return zack?.id ?? null;
  if (call.business_unit === 'commercial') return brian?.id ?? zack?.id ?? null;
  return zack?.id ?? null;
}

/** Zack and Brian back each other up. */
export function backupFor(ownerId: string | null, profiles: Profile[]): string | null {
  const zack = zackProfile(profiles), brian = brianProfile(profiles);
  if (!ownerId) return null;
  if (ownerId === zack?.id) return brian?.id ?? null;
  return zack?.id ?? null;
}

/**
 * Who picked up, from Talkroute's call events ("Call answered by _Brian Blanco_ - …").
 * "Primary Forward Number" is the main line's first ring — Zack.
 */
export function answererFromEvents(events: Array<{ description?: string }> | null | undefined, profiles: Profile[]): { profileId: string | null; bot: boolean } {
  const label = (events ?? []).map(e => e.description?.match(/answered by _([^_]+)_/i)?.[1]).find(Boolean)?.trim();
  if (!label) return { profileId: null, bot: false };
  if (/ai receptionist/i.test(label)) return { profileId: null, bot: true };
  if (/primary/i.test(label)) return { profileId: zackProfile(profiles)?.id ?? null, bot: false };
  const hit = profiles.find(p => `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim().toLowerCase() === label.toLowerCase())
    ?? profiles.find(p => (p.first_name ?? '').toLowerCase() === label.split(/\s+/)[0].toLowerCase());
  return { profileId: hit?.id ?? null, bot: false };
}

/** The bot's intent label decides; the summary only when there is no label. */
export function junkKind(c: { intent?: string | null; summary?: string | null }): 'spam' | 'nothing' | null {
  const text = c.intent || c.summary || '';
  return SPAM.test(text) ? 'spam' : NOTHING.test(text) ? 'nothing' : null;
}

/**
 * When the call-back clock starts: the call time during business hours (Mon–Sat
 * 8–6 Central), otherwise the next opening — a 9 pm bot call isn't "late" at 9:30.
 */
export function businessClockStart(iso: string): Date {
  const d = new Date(iso);
  if (isBusinessOpen(d)) return d;
  const t = new Date(d);
  t.setUTCMinutes(Math.ceil(t.getUTCMinutes() / 15) * 15, 0, 0);
  for (let i = 0; i < 7 * 24 * 4; i++) {
    if (isBusinessOpen(t)) return t;
    t.setTime(t.getTime() + 15 * 60_000);
  }
  return d;
}

/** Minutes of business time between the clock start and now (approximate — open hours only). */
export function businessMinutesSince(iso: string, now = new Date()): number {
  const start = businessClockStart(iso).getTime();
  if (start >= now.getTime()) return 0;
  let mins = 0;
  for (let t = start; t < now.getTime(); t += 15 * 60_000) if (isBusinessOpen(new Date(t))) mins += Math.min(15, (now.getTime() - t) / 60_000);
  return Math.round(mins);
}

/** Default due time for a call-back: two business hours after the clock starts. */
export function defaultCallbackDue(startedAt: string): string {
  const t = businessClockStart(startedAt);
  let left = 120;
  while (left > 0) {
    t.setTime(t.getTime() + 15 * 60_000);
    if (isBusinessOpen(t)) left -= 15;
  }
  return t.toISOString();
}

type Row = {
  id: string; business_unit: string; source: string; kind: string; direction: string; result: string | null;
  from_number: string | null; to_number: string | null; callback_number: string | null; contact_id: string | null;
  started_at: string; summary: string | null; intent: string | null; ai_meta: Record<string, unknown> | null;
  needs_follow_up: boolean; handled_at: string | null; follow_up_assignee: string | null; follow_up_due: string | null;
  answered_by: string | null; answered_by_bot: boolean; outcome: string | null; notes: string | null; raw: { events?: Array<{ description?: string }> } | null;
};

const theirNumber = (r: Pick<Row, 'direction' | 'from_number' | 'to_number'>) => (r.direction === 'outbound' ? r.to_number : r.from_number);

/**
 * Keep the log tidy. Idempotent and cheap (the table is small); safe to run often.
 *  1. Who answered each Talkroute call; hide the leg the AI receptionist took.
 *  2. Link calls to contacts — including contacts added after the call.
 *  3. Close junk call-backs (silent/spam/robocalls, and numbers already marked spam).
 *  4. Close call-backs that were actually returned (a later outbound call to the
 *     number, or the caller rang again and a person answered).
 *  5. Give every open call-back an owner and a due time.
 */
export async function tidyCallLog(db: SupabaseClient, opts: { days?: number; callIds?: string[]; dryRun?: boolean } = {}): Promise<{ counts: Record<string, number>; plan?: Array<{ id: string; patch: Record<string, unknown> }> }> {
  const since = new Date(Date.now() - (opts.days ?? 120) * 86_400_000).toISOString();
  let q = db.from('crm_call_log')
    .select('id, business_unit, source, kind, direction, result, from_number, to_number, callback_number, contact_id, started_at, summary, intent, ai_meta, needs_follow_up, handled_at, follow_up_assignee, follow_up_due, answered_by, answered_by_bot, outcome, notes, raw')
    .gte('started_at', since).order('started_at');
  if (opts.callIds?.length) q = q.in('id', opts.callIds);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const { data: profileRows } = await db.from('crm_profiles').select('id, email, first_name, last_name, role');
  const profiles = (profileRows ?? []) as Profile[];
  const out = { answered: 0, bot_legs: 0, linked: 0, junk_closed: 0, returned_closed: 0, assigned: 0, dated: 0 };
  const now = new Date().toISOString();
  const plan: Array<{ id: string; patch: Record<string, unknown> }> = [];
  // dryRun: record what would change instead of writing it.
  const write = async (id: string, patch: Record<string, unknown>) => {
    if (opts.dryRun) { plan.push({ id, patch }); return; }
    await db.from('crm_call_log').update(patch).eq('id', id);
  };

  // For opts.callIds runs, step 3/4 still need the neighbouring calls.
  const all = opts.callIds?.length
    ? ((await db.from('crm_call_log').select('id, direction, result, from_number, to_number, started_at, answered_by, outcome, source').gte('started_at', since)).data ?? []) as Row[]
    : rows;

  // 1. Answerer
  for (const r of rows) {
    if (r.source !== 'talkroute' || r.result !== 'answered' || r.answered_by || r.answered_by_bot) continue;
    const a = answererFromEvents(r.raw?.events, profiles);
    if (!a.profileId && !a.bot) continue;
    await write(r.id, a.bot ? { answered_by_bot: true } : { answered_by: a.profileId });
    if (a.bot) { r.answered_by_bot = true; out.bot_legs++; } else { r.answered_by = a.profileId; out.answered++; }
  }

  // 2. Contacts
  const cache = new Map<string, { id: string; agent_id: string | null } | null>();
  for (const r of rows) {
    if (r.contact_id) continue;
    for (const n of [r.callback_number, theirNumber(r)]) {
      const key = `${r.business_unit}:${last10(n)}`;
      if (last10(n).length < 10) continue;
      if (!cache.has(key)) {
        const m = await matchContact(db, n, r.business_unit);
        let agent: string | null = null;
        if (m) agent = ((await db.from('crm_clients').select('agent_id').eq('id', m.id).maybeSingle()).data?.agent_id as string | null) ?? null;
        cache.set(key, m ? { id: m.id, agent_id: agent } : null);
      }
      const hit = cache.get(key);
      if (hit) {
        await write(r.id, { contact_id: hit.id, updated_at: now });
        r.contact_id = hit.id; out.linked++;
        break;
      }
    }
  }

  // 3–5. The open call-back queue
  const spamNumbers = new Set(all.filter(r => r.outcome === 'spam').map(r => last10(theirNumber(r))).filter(d => d.length === 10));
  const agentOf = new Map<string, string | null>();
  for (const r of rows) {
    if (!r.needs_follow_up || r.handled_at) continue;
    const tail = last10(r.callback_number || theirNumber(r));

    const junk = junkKind(r) ?? (tail.length === 10 && spamNumbers.has(tail) ? 'spam' : null);
    if (junk) {
      await write(r.id, {
        handled_at: now, outcome: r.outcome ?? (junk === 'spam' ? 'spam' : 'other'),
        notes: [r.notes, junk === 'spam' ? 'Auto-closed: spam / robocall.' : 'Auto-closed: silent call or misdial — nothing to call back about.'].filter(Boolean).join('\n'),
        updated_at: now,
      });
      out.junk_closed++;
      continue;
    }

    if (tail.length === 10) {
      const later = all.find(o => o.id !== r.id && o.started_at > r.started_at && last10(theirNumber(o)) === tail
        && (o.direction === 'outbound' || (o.result === 'answered' && !!o.answered_by)));
      if (later) {
        const who = later.answered_by ? profiles.find(p => p.id === later.answered_by) : null;
        const what = later.direction === 'outbound' ? 'Called back' : `They called again and reached ${who?.first_name ?? 'the team'}`;
        await write(r.id, {
          handled_at: later.started_at, handled_by: later.answered_by ?? null,
          notes: [r.notes, `Auto-closed: ${what} on ${new Date(later.started_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })}.`].filter(Boolean).join('\n'),
          updated_at: now,
        });
        out.returned_closed++;
        continue;
      }
    }

    const patch: Record<string, unknown> = {};
    if (!r.follow_up_assignee) {
      let contact: { agent_id: string | null } | null = null;
      if (r.contact_id) {
        if (!agentOf.has(r.contact_id)) agentOf.set(r.contact_id, ((await db.from('crm_clients').select('agent_id').eq('id', r.contact_id).maybeSingle()).data?.agent_id as string | null) ?? null);
        contact = { agent_id: agentOf.get(r.contact_id) ?? null };
      }
      const owner = ownerFor(r, contact, profiles);
      if (owner) { patch.follow_up_assignee = owner; out.assigned++; }
    }
    if (!r.follow_up_due) { patch.follow_up_due = defaultCallbackDue(r.started_at); out.dated++; }
    if (Object.keys(patch).length) await write(r.id, { ...patch, updated_at: now });
  }
  return opts.dryRun ? { counts: out, plan } : { counts: out };
}
