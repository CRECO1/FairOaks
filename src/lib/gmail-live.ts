/**
 * Live view of the CALLER'S OWN Gmail (Zack, 2026-10-28: "all my email in here, so I don't have to go to Gmail"). Nothing
 * is copied into the CRM: threads are listed and read from Gmail on demand, with the same token the CRM already holds
 * (gmail.readonly). Only the caller's own connected mailbox is ever read — never a teammate's.
 */
import { extractEmailText } from '@/lib/gmail-body';
import { collectAttachmentParts } from '@/lib/email-attachments';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type ThreadSummary = { id: string; subject: string; snippet: string; from: string; to: string; date: number; unread: boolean; count: number; files: boolean; starred: boolean; lastMine: boolean; labels: string[] };
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
export async function listThreads(token: string, opts: { box: 'inbox' | 'sent'; q?: string; pageToken?: string; labelId?: string }) {
  const params = new URLSearchParams({ maxResults: '25', labelIds: opts.box === 'sent' ? 'SENT' : 'INBOX' });
  if (opts.labelId) params.append('labelIds', opts.labelId); // threads.list ANDs repeated labelIds
  if (opts.q) params.set('q', opts.q);
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  // Which of these have files? On the first page Gmail can say exactly (the same search plus has:attachment lists the
  // newest attachment threads, a superset of this page's); on older pages we fall back to the message's MIME shape.
  const filesParams = new URLSearchParams({ maxResults: '100', labelIds: params.get('labelIds')! });
  if (opts.labelId) filesParams.append('labelIds', opts.labelId);
  filesParams.set('q', `${opts.q ?? ''} has:attachment`.trim());
  const [list, filesList] = await Promise.all([
    g(token, `/threads?${params}`),
    opts.pageToken ? Promise.resolve(null) : g(token, `/threads?${filesParams}`),
  ]);
  const withFiles = filesList?.ok ? new Set<string>((filesList.json.threads ?? []).map((t: { id: string }) => t.id)) : null;
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
      // The newest real message (not a draft) was sent by the user, to someone else: nobody has answered yet.
      labels: [...new Set(msgs.flatMap(m => (m.labelIds ?? []).filter(l => /^Label_\d+$/.test(l))))],
      lastMine: (() => { const real = msgs.filter(m => !m.labelIds?.includes('DRAFT')), l = real[real.length - 1]; return !!l && !!l.labelIds?.includes('SENT') && !l.labelIds.includes('INBOX'); })(),
      unread: msgs.some(m => m.labelIds?.includes('UNREAD')), starred: msgs.some(m => m.labelIds?.includes('STARRED')), count: msgs.length,
      files: withFiles ? withFiles.has(t.id) : msgs.some(m => m.payload?.mimeType === 'multipart/mixed'),
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

// ── Changing mail (needs the gmail.modify permission; the CRM first connected with read-only) ─────────────────────────
export const THREAD_ACTIONS = ['read', 'unread', 'archive', 'unarchive', 'star', 'unstar', 'trash', 'untrash'] as const;
export type ThreadAction = typeof THREAD_ACTIONS[number];
const LABELS: Record<Exclude<ThreadAction, 'trash' | 'untrash'>, { add?: string[]; remove?: string[] }> = {
  read: { remove: ['UNREAD'] }, unread: { add: ['UNREAD'] }, archive: { remove: ['INBOX'] }, unarchive: { add: ['INBOX'] },
  star: { add: ['STARRED'] }, unstar: { remove: ['STARRED'] },
};

/** Apply one change to a whole conversation. Trash is recoverable in Gmail for 30 days; nothing here deletes permanently. */
export const LABEL_ACTION = /^(label|unlabel):(Label_\d+)$/; // add or remove one of the user's own labels
export async function modifyThread(token: string, id: string, action: ThreadAction | string): Promise<{ ok: boolean; status: number }> {
  const lab = LABEL_ACTION.exec(action);
  const plain = action === 'trash' || action === 'untrash';
  const url = plain ? `${API}/threads/${id}/${action}` : `${API}/threads/${id}/modify`;
  const body = plain ? undefined : lab
    ? JSON.stringify(lab[1] === 'label' ? { addLabelIds: [lab[2]], removeLabelIds: [] } : { addLabelIds: [], removeLabelIds: [lab[2]] })
    : JSON.stringify({ addLabelIds: LABELS[action as keyof typeof LABELS].add ?? [], removeLabelIds: LABELS[action as keyof typeof LABELS].remove ?? [] });
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body, cache: 'no-store' });
  return { ok: res.ok, status: res.status };
}

// Does this token carry gmail.modify? (Tokens from before the permission was widened only read.) Cached briefly per token.
const scopeCache = new Map<string, { at: number; modify: boolean }>();
export async function hasModifyScope(token: string): Promise<boolean> {
  const hit = scopeCache.get(token);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.modify;
  let modify = false;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    modify = r.ok && typeof j.scope === 'string' && /\/auth\/gmail\.modify\b|mail\.google\.com\//.test(j.scope);
  } catch { /* unknown → treat as read-only; the buttons then offer to allow it */ }
  if (scopeCache.size > 50) scopeCache.clear();
  scopeCache.set(token, { at: Date.now(), modify });
  return modify;
}

// ── The user's own labels (system labels like INBOX/STARRED are handled by the actions above) ───────────────────────
export type GLabel = { id: string; name: string; bg: string | null; fg: string | null };
export async function listLabels(token: string): Promise<GLabel[]> {
  const r = await g(token, '/labels');
  if (!r.ok) return [];
  return ((r.json.labels ?? []) as Array<{ id: string; name: string; type?: string; color?: { backgroundColor?: string; textColor?: string } }>)
    .filter(l => l.type === 'user' && /^Label_\d+$/.test(l.id))
    .map(l => ({ id: l.id, name: l.name, bg: l.color?.backgroundColor ?? null, fg: l.color?.textColor ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function createLabel(token: string, name: string): Promise<{ ok: true; label: GLabel } | { ok: false; status: number }> {
  const res = await fetch(`${API}/labels`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id) return { ok: false, status: res.status };
  return { ok: true, label: { id: j.id as string, name: j.name as string, bg: j.color?.backgroundColor ?? null, fg: j.color?.textColor ?? null } };
}
