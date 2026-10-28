/**
 * Attachments on logged emails. Gmail only lets the mailbox OWNER read a message, so a file Brian sent was invisible
 * to everyone else on the deal. Each attachment is now copied into the private `email-attachments` bucket when the
 * email is logged (sent from the CRM, synced, or pulled in by the replies cron) and listed on the row, so anyone who
 * can open the deal/contact can see and download it — the same rule as the deal's Docs tab.
 *
 * crm_deal_emails.attachments: NULL = not checked yet, [] = checked, none, [{name,size,mime,path}] = stored
 * (path null = too large to copy; still listed by name).
 */
import { adminClient } from '@/lib/supabase-admin';

export const EMAIL_ATTACH_BUCKET = 'email-attachments';
export interface StoredAttachment { name: string; size: number; mime: string; path: string | null }

const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 30 * 1024 * 1024;
const MAX_FILES = 12;

type GPart = { partId?: string; filename?: string; mimeType?: string; headers?: { name: string; value: string }[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: GPart[] };

/** The real attachments of a Gmail message payload — signature logos and embedded pictures don't count. */
export function collectAttachmentParts(part: GPart | undefined, out: GPart[] = []): GPart[] {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) {
    const h = (n: string) => part.headers?.find(x => x.name.toLowerCase() === n)?.value ?? '';
    const inlineImage = /^inline/i.test(h('content-disposition')) && h('content-id') && /^image\//i.test(part.mimeType ?? '');
    if (!inlineImage) out.push(part);
  }
  for (const p of part.parts ?? []) collectAttachmentParts(p, out);
  return out;
}

const safeName = (s: string) => (s || 'attachment').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120);

async function put(emailId: string, idx: number, name: string, mime: string, bytes: Buffer): Promise<string | null> {
  const path = `${emailId}/${idx}_${safeName(name)}`;
  const { error } = await adminClient().storage.from(EMAIL_ATTACH_BUCKET).upload(path, bytes, { contentType: mime || 'application/octet-stream', upsert: true });
  return error ? null : path;
}

/** Files we attached ourselves (already in memory as base64) → the email row. */
export async function storeOutgoingAttachments(emailId: string, files: Array<{ name: string; mimeType: string; data: string }>): Promise<void> {
  if (!files.length) { await adminClient().from('crm_deal_emails').update({ attachments: [] }).eq('id', emailId); return; }
  const out: StoredAttachment[] = [];
  let total = 0;
  for (let i = 0; i < files.length && i < MAX_FILES; i++) {
    const f = files[i];
    const bytes = Buffer.from(f.data, 'base64');
    total += bytes.length;
    const path = bytes.length <= MAX_FILE && total <= MAX_TOTAL ? await put(emailId, i, f.name, f.mimeType, bytes) : null;
    out.push({ name: f.name, size: bytes.length, mime: f.mimeType || 'application/octet-stream', path });
  }
  await adminClient().from('crm_deal_emails').update({ attachments: out }).eq('id', emailId);
}

/** A Gmail message's attachments → copied into storage and listed on the email row. Safe to call repeatedly. */
export async function storeGmailAttachments(emailId: string, gmailMessageId: string, accessToken: string, payload?: GPart): Promise<StoredAttachment[] | null> {
  let root = payload;
  if (!root) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null; // not in this mailbox
    root = (await res.json()).payload as GPart;
  }
  const parts = collectAttachmentParts(root);
  const out: StoredAttachment[] = [];
  let total = 0;
  for (let i = 0; i < parts.length && i < MAX_FILES; i++) {
    const p = parts[i];
    const size = p.body?.size ?? 0;
    const name = p.filename ?? 'attachment';
    const mime = p.mimeType ?? 'application/octet-stream';
    let path: string | null = null;
    if (size <= MAX_FILE && total + size <= MAX_TOTAL) {
      const a = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}/attachments/${p.body!.attachmentId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (a.ok) {
        const bytes = Buffer.from(((await a.json()).data as string).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        total += bytes.length;
        path = await put(emailId, i, name, mime, bytes);
      }
    }
    out.push({ name, size, mime, path });
  }
  await adminClient().from('crm_deal_emails').update({ attachments: out }).eq('id', emailId);
  return out;
}
