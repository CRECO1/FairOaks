import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase-admin';
import { decryptToken, encryptToken } from '@/lib/token-crypto';
import { fetchAll, type Signal } from '@/lib/campaign-engagement';

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
  const ids: string[] = [];
  for (let i = 0; i < emails.length; i += 30) {
    const who = emails.slice(i, i + 30).join(' OR ');
    // Inbound: only "Re:"-style subjects — a reply is matched on subject below anyway,
    // and tenants' everyday email would otherwise crowd real replies out of the cap.
    const q = direction === 'in' ? `from:(${who}) subject:(re OR fw OR fwd) after:${afterDay} -in:sent -in:chats` : `to:(${who}) after:${afterDay} in:sent`;
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=100`, { headers: H, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) continue;
    const j = await r.json().catch(() => ({}));
    ids.push(...((j.messages ?? []) as { id: string }[]).map(m => m.id));
    if (ids.length >= 300) break;
  }
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

export interface ReplyScan { extra: Map<string, Signal[]>; emailedAt: Map<string, string>; repliesChecked: string[] }

/** extra: `${campaign_id}|${client_id}` → reply signals. emailedAt: client → our latest Gmail to them. */
export async function gmailReplies(db: SupabaseClient, userId: string, admin: boolean,
  inScope: { id: string; sender_agent_id?: string | null }[]): Promise<ReplyScan> {
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
  for (let i = 0; i < recipientIds.length; i += 150) {
    const { data } = await db.from('crm_clients').select('id, email').in('id', recipientIds.slice(i, i + 150));
    for (const c of data ?? []) if (c.email) emailOf.set(c.id, String(c.email).trim().toLowerCase());
  }

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
  const earliestSend = sendRows[0]?.sent_at;
  const addrs = [...new Set(emailOf.values())].filter(e => /^[^\s@()"]+@[^\s@()"]+$/.test(e));
  if (earliestSend && addrs.length) {
    const inbox = new Map<string, { at: string; subject: string }[]>();
    await Promise.all(((conns ?? []) as Conn[]).map(async conn => {
      const token = await gmailToken(conn);
      if (!token) return;
      repliesChecked.push(conn.email ?? 'Gmail');
      const [got, sent] = await Promise.all([findMail(token, addrs, earliestSend, 'in'), findMail(token, addrs, earliestSend, 'out')]);
      for (const [addr, msgs] of got) (inbox.get(addr) ?? inbox.set(addr, []).get(addr)!).push(...msgs);
      // Our own emails to them count as contact (a Gmail reply never becomes a CRM activity).
      for (const [addr, msgs] of sent) {
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
