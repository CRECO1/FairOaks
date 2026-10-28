/**
 * Live view of the CALLER'S OWN Gmail (Zack, 2026-10-28: "all my email in here, so I don't have to go to Gmail"). Nothing
 * is copied into the CRM: threads are listed and read from Gmail on demand, with the same token the CRM already holds
 * (gmail.readonly). Only the caller's own connected mailbox is ever read — never a teammate's.
 */
import { extractEmailText } from '@/lib/gmail-body';
import { collectAttachmentParts } from '@/lib/email-attachments';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type ThreadSummary = { id: string; subject: string; snippet: string; from: string; to: string; date: number; unread: boolean; count: number };
export type LiveAttachment = { part: string; name: string; size: number; mime: string };
export type LiveMessage = {
  id: string; from: string; to: string; cc: string; subject: string; date: number; unread: boolean;
  rfcId: string; refs: string; html: string; text: string; attachments: LiveAttachment[];
};

type GPart = { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: GPart[] };
type GMsg = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GPart };

const hdr = (m: GMsg, name: string) => m.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function g(token: string, path: string): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/** One page of the inbox or sent folder, newest first. */
export async function listThreads(token: string, opts: { box: 'inbox' | 'sent'; q?: string; pageToken?: string }) {
  const params = new URLSearchParams({ maxResults: '25', labelIds: opts.box === 'sent' ? 'SENT' : 'INBOX' });
  if (opts.q) params.set('q', opts.q);
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  const list = await g(token, `/threads?${params}`);
  if (!list.ok) return { ok: false as const, status: list.status };
  const ids: string[] = (list.json.threads ?? []).map((t: { id: string }) => t.id);
  const got = await pool(ids, 8, async id => {
    const r = await g(token, `/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
    return r.ok ? (r.json as { id: string; messages?: GMsg[] }) : null;
  });
  const threads: ThreadSummary[] = [];
  for (const t of got) {
    const msgs = t?.messages ?? [];
    if (!t || !msgs.length) continue;
    // Inbox shows the last message that isn't a draft; Sent shows the last message sent by the user.
    const last = (opts.box === 'sent' ? [...msgs].reverse().find(m => m.labelIds?.includes('SENT')) : null) ?? msgs[msgs.length - 1];
    threads.push({
      id: t.id, subject: hdr(msgs[0], 'Subject') || '(no subject)', snippet: last.snippet ?? '',
      from: hdr(last, 'From'), to: hdr(last, 'To'), date: Number(last.internalDate) || 0,
      unread: msgs.some(m => m.labelIds?.includes('UNREAD')), count: msgs.length,
    });
  }
  return { ok: true as const, threads, next: (list.json.nextPageToken as string | undefined) ?? null };
}

export async function unreadCounts(token: string) {
  const [all, primary] = await Promise.all([g(token, '/labels/INBOX'), g(token, '/labels/CATEGORY_PRIMARY')]);
  return { inbox: Number(all.json.threadsUnread) || 0, primary: primary.ok ? Number(primary.json.threadsUnread) || 0 : null };
}

/** A whole conversation: the message HTML (sanitized in the BROWSER before display — the jsdom-based sanitizer can't load in a serverless route), plain text for quoting, attachments. */
export async function readThread(token: string, id: string): Promise<{ ok: false; status: number } | { ok: true; messages: LiveMessage[] }> {
  const r = await g(token, `/threads/${id}?format=full`);
  if (!r.ok) return { ok: false, status: r.status };
  const msgs: GMsg[] = (r.json.messages ?? []).filter((m: GMsg) => !m.labelIds?.includes('DRAFT'));
  const out: LiveMessage[] = [];
  for (const m of msgs) {
    const html = await renderHtml(token, m);
    const atts = collectAttachmentParts(m.payload).map(p => ({ part: p.partId ?? '', name: p.filename ?? 'attachment', size: p.body?.size ?? 0, mime: p.mimeType ?? 'application/octet-stream' }));
    out.push({
      id: m.id, from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc'), subject: hdr(m, 'Subject') || '(no subject)',
      date: Number(m.internalDate) || 0, unread: !!m.labelIds?.includes('UNREAD'),
      rfcId: hdr(m, 'Message-ID'), refs: hdr(m, 'References'),
      html, text: extractEmailText(m.payload).slice(0, 30000), attachments: atts,
    });
  }
  return { ok: true, messages: out };
}

function findPart(p: GPart | undefined, mime: string): GPart | null {
  if (!p) return null;
  if (p.mimeType === mime && p.body?.data) return p;
  for (const c of p.parts ?? []) { const x = findPart(c, mime); if (x) return x; }
  return null;
}
function inlineImages(p: GPart | undefined, out: GPart[] = []): GPart[] {
  if (!p) return out;
  const cid = p.headers?.find(h => h.name.toLowerCase() === 'content-id')?.value;
  if (cid && p.body?.attachmentId && /^image\//i.test(p.mimeType ?? '')) out.push(p);
  for (const c of p.parts ?? []) inlineImages(c, out);
  return out;
}

async function renderHtml(token: string, m: GMsg): Promise<string> {
  const htmlPart = findPart(m.payload, 'text/html');
  if (!htmlPart) {
    const plain = findPart(m.payload, 'text/plain') ?? (m.payload?.body?.data ? m.payload : null);
    const text = plain?.body?.data ? b64(plain.body.data).toString('utf-8') : '';
    return `<div style="white-space:pre-wrap">${esc(text.replace(/\r\n?/g, '\n'))}</div>`;
  }
  let raw = b64(htmlPart.body!.data!).toString('utf-8');
  // Pictures embedded in the message (cid:) → small data URIs so they show; capped so a big newsletter stays fast.
  const imgs = inlineImages(m.payload).filter(p => (p.body?.size ?? 0) <= 250_000).slice(0, 8);
  await pool(imgs, 4, async p => {
    const cid = (p.headers!.find(h => h.name.toLowerCase() === 'content-id')!.value).replace(/^<|>$/g, '');
    if (!raw.includes(`cid:${cid}`)) return;
    const a = await g(token, `/messages/${m.id}/attachments/${p.body!.attachmentId}`);
    if (a.ok && a.json.data) raw = raw.split(`cid:${cid}`).join(`data:${p.mimeType};base64,${b64(a.json.data).toString('base64')}`);
  });
  return raw;
}

/** The bytes of one attachment of one message, or null. Identified by partId, like the rest of the CRM. */
export async function fetchAttachment(token: string, messageId: string, partId: string) {
  const r = await g(token, `/messages/${messageId}?format=full`);
  if (!r.ok) return null;
  const part = collectAttachmentParts((r.json as GMsg).payload).find(p => p.partId === partId);
  if (!part?.body?.attachmentId) return null;
  const a = await g(token, `/messages/${messageId}/attachments/${part.body.attachmentId}`);
  if (!a.ok || !a.json.data) return null;
  return { bytes: b64(a.json.data), name: part.filename ?? 'attachment', mime: part.mimeType ?? 'application/octet-stream' };
}
