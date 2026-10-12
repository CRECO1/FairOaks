import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { fetchAll, tenantNoticeIds, type Signal } from '@/lib/campaign-engagement';

// Gmail replies to campaign emails — shared by the Marketing call list
// (/api/campaigns/engagement) and a property's Leasing Activity leads.
// Inboxes searched: the caller's own connected Gmail plus each campaign sender's
// (an admin or the sender themselves only — an agent never gets another agent's inbox
// searched for them). Only the fact, date and subject of a reply leave Gmail.

type Conn = { id: string; user_id: string; email: string | null; access_token: string; refresh_token: string; expires_at: string };

async function gmailToken(conn: Conn): Promise<string | null> {
  if (Date.now() < new Date(conn.expires_at).getTime() - 120_000) return decryptToken(conn.access_token);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: decryptToken(conn.refresh_token), grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const data = await r?.json().catch(() => null);
  if (!r?.ok || !data?.access_token) return null;
  await adminClient().from('gmail_connections').update({
    access_token: encryptToken(data.access_token),
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', conn.id);
  return data.access_token as string;
}

const AUTO_REPLY = /automatic reply|auto.?reply|out of (the )?office|undeliverable|delivery status|mail delivery|returned mail|away from|vacation/i;

/**
 * direction 'in': address → messages FROM it after `after` (not our sent mail).
 * direction 'out': address → messages WE sent TO it after `after` (= contacted).
 * Date + subject only.
 */
async function findMail(token: string, emails: string[], after: string, direction: 'in' | 'out'): Promise<Map<string, { at: string; subject: string }[]>> {
  const found = new Map<string, { at: string; subject: string }[]>();
  const afterDay = new Date(after).toISOString().slice(0, 10).replace(/-/g, '/');
  const H = { Authorization: `Bearer ${token}` };
  // One search per 30 addresses, three at a time (they used to run one after another —
  // ~40 round trips in a row on a big workspace). Order is kept so the 300 cap below
  // trims the same tail it always did.
  const searchIds: string[][] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < emails.length; i += 30) chunks.push(emails.slice(i, i + 30));
  let nextChunk = 0;
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, async () => {
    while (nextChunk < chunks.length) {
      const idx = nextChunk++;
      const who = chunks[idx].join(' OR ');
      // Inbound: only "Re:"-style subjects — a reply is matched on subject below anyway,
      // and tenants' everyday email would otherwise crowd real replies out of the cap.
      const q = direction === 'in' ? `from:(${who}) subject:(re OR fw OR fwd) after:${afterDay} -in:sent -in:chats` : `to:(${who}) after:${afterDay} in:sent`;
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=100`, { headers: H, signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!r?.ok) continue;
      const j = await r.json().catch(() => ({}));
      searchIds[idx] = ((j.messages ?? []) as { id: string }[]).map(m => m.id);
    }
  }));
  const ids = searchIds.flat().filter(Boolean);
  // Batches of 20: firing them all at once trips Gmail's per-user rate limit (429),
  // which silently dropped messages and made the reply count change run to run.
  const get = (id: string) => fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`, { headers: H, signal: AbortSignal.timeout(8000) });
  const metas: any[] = [];
  for (const batch of Array.from({ length: Math.ceil(Math.min(ids.length, 300) / 20) }, (_, i) => ids.slice(i * 20, i * 20 + 20))) {
    metas.push(...await Promise.all(batch.map(async id => {
      let r = await get(id).catch(() => null);
      if (r?.status === 429) { await new Promise(res => setTimeout(res, 600)); r = await get(id).catch(() => null); }
      return r?.ok ? r.json().catch(() => null) : null;
    })));
  }
  for (const m of metas) {
    if (!m) continue;
    const head = (n: string) => ((m.payload?.headers ?? []) as { name: string; value: string }[]).find(h => h.name.toLowerCase() === n)?.value ?? '';
    const at = new Date(Number(m.internalDate)).toISOString();
    if (at < after) continue;
    if (direction === 'in') {
      if (AUTO_REPLY.test(head('subject'))) continue;
      const from = (head('from').match(/<([^>]+)>/)?.[1] ?? head('from')).trim().toLowerCase();
      if (from) (found.get(from) ?? found.set(from, []).get(from)!).push({ at, subject: head('subject') });
    } else {
      const wanted = new Set(emails);
      for (const addr of `${head('to')},${head('cc')}`.toLowerCase().match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []) {
        if (wanted.has(addr)) (found.get(addr) ?? found.set(addr, []).get(addr)!).push({ at, subject: head('subject') });
      }
    }
  }
  return found;
}

// ── Scan cache ───────────────────────────────────────────────────────────────
// A Gmail scan (≈40 searches + up to 300 message reads per inbox and direction) takes
// 6–11s. Results are kept in crm_gmail_scan_cache so ANY instance can answer instantly:
// fresh (<3 min) → used as is; <30 min → used while a refresh runs in the background;
// older / none → scanned inline. A cached scan is usable for the addresses it covers, plus
// any address first emailed AFTER the scan (it cannot have replied before we wrote to it).
const SCAN_FRESH_MS = 3 * 60_000;
const SCAN_STALE_MS = 30 * 60_000;
const SCAN_KEEP = 8;
type Found = Map<string, { at: string; subject: string }[]>;
type ScanRow = { id: string; after_at: string; addrs: string[]; found: [string, { at: string; subject: string }[]][]; computed_at: string };
const scanInflight = new Map<string, Promise<Found | null>>();

async function scanMailCached(
  db: SupabaseClient, conn: Conn, direction: 'in' | 'out', addrs: string[], afterIso: string,
  firstSendTo: Map<string, string>, force: boolean,
): Promise<Found | null> {
  const key = `${conn.id}|${direction}`;
  let rows: ScanRow[] = [];
  try {
    const { data } = await db.from('crm_gmail_scan_cache')
      .select('id, after_at, addrs, found, computed_at').eq('conn_id', conn.id).eq('direction', direction)
      .order('computed_at', { ascending: false }).limit(SCAN_KEEP);
    rows = (data ?? []) as ScanRow[];
  } catch { /* no cache → scan inline */ }

  const covers = (r: ScanRow) => {
    if (r.after_at > afterIso) return false;
    const have = new Set(r.addrs);
    return addrs.every(a => have.has(a) || (firstSendTo.get(a) ?? '') >= r.computed_at);
  };
  const hit = rows.find(covers);
  const fromRow = (r: ScanRow): Found => new Map(r.found);
  const age = hit ? Date.now() - new Date(hit.computed_at).getTime() : Infinity;

  const recompute = async (): Promise<Found | null> => {
    const token = await gmailToken(conn);
    if (!token) return null;
    const found = await findMail(token, addrs, afterIso, direction);
    try {
      await db.from('crm_gmail_scan_cache').insert({ conn_id: conn.id, direction, after_at: afterIso, addrs, found: [...found] });
      const { data: old } = await db.from('crm_gmail_scan_cache').select('id').eq('conn_id', conn.id).eq('direction', direction)
        .order('computed_at', { ascending: false }).range(SCAN_KEEP, SCAN_KEEP + 50);
      if (old?.length) await db.from('crm_gmail_scan_cache').delete().in('id', old.map(o => o.id));
    } catch { /* the cache is an optimisation */ }
    return found;
  };
  // Share one scan between simultaneous callers on this instance.
  const run = () => {
    let p = scanInflight.get(key);
    if (!p) { p = recompute().finally(() => scanInflight.delete(key)); scanInflight.set(key, p); }
    return p;
  };

  if (!force && hit && age < SCAN_FRESH_MS) return fromRow(hit);
  if (!force && hit && age < SCAN_STALE_MS) {
    const bg = () => { void run().catch(() => {}); };
    try { after(bg); } catch { bg(); }
    return fromRow(hit);
  }
  const fresh = await run().catch(() => null);
  return fresh ?? (hit ? fromRow(hit) : null); // token / Gmail failure: stale beats nothing
}

export interface ReplyScan { extra: Map<string, Signal[]>; emailedAt: Map<string, string>; repliesChecked: string[] }

/** extra: `${campaign_id}|${client_id}` → reply signals. emailedAt: client → our latest Gmail to them. */
export async function gmailReplies(db: SupabaseClient, userId: string, admin: boolean,
  inScope: { id: string; sender_agent_id?: string | null }[], opts: { force?: boolean } = {}): Promise<ReplyScan> {
  const ctx = { userId };
  // ── Gmail replies ─────────────────────────────────────────────────────────
  const sendRows: { campaign_id: string; client_id: string; sent_at: string; subject: string | null }[] = [];
  for (let i = 0; i < inScope.length; i += 80) {
    sendRows.push(...await fetchAll<{ campaign_id: string; client_id: string; sent_at: string; subject: string | null }>((a, b) => db.from('crm_campaign_sends')
      .select('campaign_id, client_id, sent_at, subject').in('campaign_id', inScope.slice(i, i + 80).map(c => c.id))
      .eq('status', 'sent').eq('type', 'email').order('sent_at').range(a, b)));
  }
  const firstSent = new Map<string, string>();
  const sentSubject = new Map<string, string>();
  for (const s of sendRows) {
    const k = `${s.campaign_id}|${s.client_id}`;
    if (s.client_id && !firstSent.has(k)) { firstSent.set(k, s.sent_at); if (s.subject) sentSubject.set(k, s.subject); }
  }
  const recipientIds = [...new Set(sendRows.map(s => s.client_id).filter(Boolean))];
  const emailOf = new Map<string, string>();
  // Chunks are independent reads — run them together (they were awaited one at a time).
  const emailChunks = await Promise.all(Array.from({ length: Math.ceil(recipientIds.length / 150) }, (_, i) =>
    db.from('crm_clients').select('id, email').in('id', recipientIds.slice(i * 150, i * 150 + 150))));
  for (const { data } of emailChunks) for (const c of data ?? []) if (c.email) emailOf.set(c.id, String(c.email).trim().toLowerCase());

  const inboxOwners = new Set<string>([ctx.userId]);
  for (const c of inScope) {
    if (c.sender_agent_id && (admin || c.sender_agent_id === ctx.userId)) inboxOwners.add(c.sender_agent_id);
  }
  const { data: conns } = await db.from('gmail_connections')
    .select('id, user_id, email, access_token, refresh_token, expires_at').in('user_id', [...inboxOwners]);
  const extra = new Map<string, Signal[]>();
  const emailedAt = new Map<string, string>(); // client → our latest email to them
  const clientByEmail = new Map([...emailOf].map(([id, em]) => [em, id]));
  const repliesChecked: string[] = [];
  const earliestSend = sendRows.reduce<string | undefined>((m, s) => (!m || s.sent_at < m ? s.sent_at : m), undefined);
  const addrs = [...new Set(emailOf.values())].filter(e => /^[^\s@()"]+@[^\s@()"]+$/.test(e));
  // When we first emailed each address (via a campaign): a cached scan from before that
  // moment cannot be missing a reply from them.
  const firstSendTo = new Map<string, string>();
  for (const sr of sendRows) {
    const em = emailOf.get(sr.client_id);
    if (em && (!firstSendTo.has(em) || sr.sent_at < firstSendTo.get(em)!)) firstSendTo.set(em, sr.sent_at);
  }
  if (earliestSend && addrs.length) {
    const inbox = new Map<string, { at: string; subject: string }[]>();
    await Promise.all(((conns ?? []) as Conn[]).map(async conn => {
      const [got, sent] = await Promise.all([
        scanMailCached(db, conn, 'in', addrs, earliestSend, firstSendTo, !!opts.force),
        scanMailCached(db, conn, 'out', addrs, earliestSend, firstSendTo, !!opts.force),
      ]);
      if (!got && !sent) return; // no token and nothing cached
      repliesChecked.push(conn.email ?? 'Gmail');
      for (const [addr, msgs] of got ?? []) (inbox.get(addr) ?? inbox.set(addr, []).get(addr)!).push(...msgs);
      // Our own emails to them count as contact (a Gmail reply never becomes a CRM activity).
      for (const [addr, msgs] of sent ?? []) {
        const client = clientByEmail.get(addr);
        const last = msgs.map(m => m.at).sort().pop();
        if (client && last && (!emailedAt.has(client) || last > emailedAt.get(client)!)) emailedAt.set(client, last);
      }
    }));
    // A reply = a message whose subject is this campaign's subject (Re:/Fwd: stripped).
    // Any email after a send isn't enough: tenants write about the building every
    // week, and that is not a reply to "Please bag trash".
    const norm = (x: string) => x.toLowerCase().replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
    for (const [k, sent] of firstSent) {
      const client = k.split('|')[1];
      const subj = norm(sentSubject.get(k) ?? '');
      if (subj.length < 6) continue;
      const hit = (inbox.get(emailOf.get(client) ?? '') ?? [])
        .filter(m => m.at >= sent && norm(m.subject).startsWith(subj.slice(0, 40)))
        .sort((a, b) => a.at.localeCompare(b.at))[0];
      if (hit) (extra.get(k) ?? extra.set(k, []).get(k)!).push({ kind: 'reply', at: hit.at, label: 'Replied by email' });
    }
  }

  return { extra, emailedAt, repliesChecked };
}

/**
 * The workspace-wide scope the Marketing call list scans: email campaigns of a business unit
 * that sent in the last 90 days, minus tenant notices. Mirrors the no-campaign_id path of
 * /api/campaigns/engagement so the reply-scan cron warms exactly what that page asks for.
 */
export async function workspaceReplyScope(db: SupabaseClient, unit: string): Promise<{ id: string; sender_agent_id: string | null }[]> {
  const { data: campaigns } = await db.from('crm_campaigns').select('id, sender_agent_id').eq('type', 'email').eq('business_unit', unit).limit(500);
  const visible = (campaigns ?? []) as { id: string; sender_agent_id: string | null }[];
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const recent = new Set<string>();
  for (let i = 0; i < visible.length; i += 80) {
    const rows = await fetchAll<{ campaign_id: string }>((a, b) => db.from('crm_campaign_sends').select('campaign_id')
      .in('campaign_id', visible.slice(i, i + 80).map(c => c.id)).eq('status', 'sent').gte('sent_at', since).range(a, b));
    for (const r of rows) recent.add(r.campaign_id);
  }
  const inScope = visible.filter(c => recent.has(c.id));
  const notices = await tenantNoticeIds(db, inScope.map(c => c.id));
  return inScope.filter(c => !notices.has(c.id));
}
