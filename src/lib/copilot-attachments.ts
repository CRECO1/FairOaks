// Files the agent attaches to the Copilot chat. The bytes live in private storage (uploaded straight from the
// browser, so Vercel's 4.5 MB body limit never applies); the chat log only holds a small reference. On every
// model call the server turns the most recent references back into real content blocks — images, PDFs as
// documents, Word/Excel/CSV as text — so the conversation can be replayed from the log without it ever
// carrying a base64 payload.
import crypto from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ATTACHMENT_TYPES, attachmentInfo, type AttachmentRef } from '@/lib/copilot-attachment-types';

export const ATT_BUCKET = 'listing-files';
const LIVE_ATTACHMENTS = 3;             // only the newest few are re-sent to the model each turn
const BYTE_BUDGET = 18 * 1024 * 1024;   // raw bytes across those (Anthropic caps a request at 32 MB incl. base64)
const TEXT_CAP = 60_000;
const PDF_PAGE_CAP = 100;               // the API reads at most 100 pages of a PDF

export function newAttachmentPath(userId: string, filename: string): { id: string; path: string } {
  const id = crypto.randomBytes(5).toString('hex');
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file';
  return { id, path: `copilot/${userId}/${id}__${safe}` };
}

/** Only ever the caller's own folder — the reference comes from the browser, so it must be checked. */
export const ownsAttachmentPath = (userId: string, path: unknown): path is string =>
  typeof path === 'string' && path.startsWith(`copilot/${userId}/`) && !path.includes('..') && path.split('/').length === 3;

/** Find the stored object for an attachment id the model echoed back (caller's folder only). */
export async function findAttachmentById(db: SupabaseClient, userId: string, id: string): Promise<{ path: string; name: string } | null> {
  if (!/^[0-9a-f]{10}$/.test(id)) return null;
  const { data } = await db.storage.from(ATT_BUCKET).list(`copilot/${userId}`, { search: id, limit: 5 });
  const hit = (data ?? []).find(o => o.name.startsWith(`${id}__`));
  if (!hit) return null;
  // The stored name had its spaces turned into underscores (storage-safe); show it the way the agent named it.
  const stored = hit.name.slice(id.length + 2);
  return { path: `copilot/${userId}/${hit.name}`, name: stored.includes(' ') ? stored : stored.replace(/_+/g, ' ') };
}

/** Best-effort housekeeping: drop this user's attachments older than three days (the chat keeps 24 h). */
export async function purgeOldAttachments(db: SupabaseClient, userId: string): Promise<void> {
  try {
    const { data } = await db.storage.from(ATT_BUCKET).list(`copilot/${userId}`, { limit: 200 });
    const cut = Date.now() - 3 * 86_400_000;
    const old = (data ?? []).filter(o => o.created_at && Date.parse(o.created_at) < cut).map(o => `copilot/${userId}/${o.name}`);
    if (old.length) await db.storage.from(ATT_BUCKET).remove(old);
  } catch { /* housekeeping must never block an upload */ }
}

const clip = (s: string) => (s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}\n…[truncated — the file is longer than this]` : s);
const stub = (ref: AttachmentRef, why: string): Anthropic.ContentBlockParam =>
  ({ type: 'text', text: `[Attached file “${ref.name}” (id ${ref.id}) — ${why}]` });

type Built = { parts: Anthropic.ContentBlockParam[]; bytes: number };

async function build(db: SupabaseClient, ref: AttachmentRef): Promise<Built> {
  const info = attachmentInfo(ref.name);
  if (!info) return { parts: [stub(ref, 'this file type can’t be read')], bytes: 0 };
  const { data, error } = await db.storage.from(ATT_BUCKET).download(ref.path);
  if (error || !data) return { parts: [stub(ref, 'the file is no longer available — ask the agent to attach it again')], bytes: 0 };
  const buf = Buffer.from(await data.arrayBuffer());
  const head: Anthropic.ContentBlockParam = { type: 'text', text: `[Attached file: ${ref.name} · id ${ref.id}]` };
  try {
    if (info.kind === 'image') {
      const sharp = (await import('sharp')).default;
      // Phone photos are huge; the model sees them at ~1.5k px anyway. Normalise to a modest JPEG.
      const jpeg = await sharp(buf, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' }).resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      return { parts: [head, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } }], bytes: jpeg.length };
    }
    if (info.kind === 'pdf') {
      const { PDFDocument } = await import('pdf-lib');
      let bytes: Uint8Array = buf; let note = '';
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = src.getPageCount();
      if (pages > PDF_PAGE_CAP) {
        const out = await PDFDocument.create();
        for (const p of await out.copyPages(src, Array.from({ length: PDF_PAGE_CAP }, (_, i) => i))) out.addPage(p);
        bytes = await out.save(); note = ` (first ${PDF_PAGE_CAP} of ${pages} pages shown)`;
      }
      return { parts: [{ type: 'text', text: `[Attached file: ${ref.name} · id ${ref.id}${note}]` }, { type: 'document', title: ref.name, source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } }], bytes: bytes.length };
    }
    if (info.kind === 'docx') {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return { parts: [head, { type: 'text', text: `Contents of “${ref.name}”:\n${clip(value || '(no readable text)')}` }], bytes: buf.length };
    }
    if (info.kind === 'xlsx') {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      let out = '';
      wb.eachSheet((ws, i) => {
        if (i > 5) return;
        out += `\n## Sheet: ${ws.name}\n`;
        let rows = 0;
        ws.eachRow({ includeEmpty: false }, row => {
          if (rows++ >= 200) return;
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (c, n) => { if (n <= 30) cells.push(String((c.value as { result?: unknown } | null)?.result ?? c.text ?? '').replace(/[\t\r\n]+/g, ' ')); });
          out += cells.join('\t') + '\n';
        });
      });
      return { parts: [head, { type: 'text', text: `Contents of “${ref.name}” (tab-separated):${clip(out)}` }], bytes: buf.length };
    }
    return { parts: [head, { type: 'text', text: `Contents of “${ref.name}”:\n${clip(buf.toString('utf8'))}` }], bytes: buf.length };
  } catch (e) {
    console.warn('[copilot-attachments] could not read', ref.name, (e as Error).message);
    return { parts: [stub(ref, 'I couldn’t read this file (it may be encrypted, corrupt or unsupported)')], bytes: 0 };
  }
}

const isRef = (v: unknown): v is AttachmentRef =>
  !!v && typeof v === 'object' && typeof (v as AttachmentRef).id === 'string' && typeof (v as AttachmentRef).name === 'string' && typeof (v as AttachmentRef).path === 'string';

/**
 * Replace every attachment reference in a conversation with the real content for the model.
 * References not owned by the caller, older than the newest few, or over the byte budget become
 * a one-line stub instead. The input is not modified (the stored chat keeps its references).
 */
export async function hydrateAttachments(db: SupabaseClient, userId: string, messages: Anthropic.MessageParam[], cache = new Map<string, Built>()): Promise<Anthropic.MessageParam[]> {
  const slots: { m: number; b: number; ref: AttachmentRef }[] = [];
  messages.forEach((m, mi) => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return;
    (m.content as unknown as Array<Record<string, unknown>>).forEach((blk, bi) => { if (blk?.type === 'text' && isRef(blk.copilot_attachment)) slots.push({ m: mi, b: bi, ref: blk.copilot_attachment }); });
  });
  if (!slots.length) return messages;

  // Newest first: the newest files get the live slots and the byte budget.
  const built = new Map<string, Anthropic.ContentBlockParam[]>();   // `${m}:${b}` → parts
  let spent = 0, live = 0, lastLive: Anthropic.ContentBlockParam | null = null;
  for (const s of [...slots].reverse()) {
    const key = `${s.m}:${s.b}`;
    if (!ownsAttachmentPath(userId, s.ref.path)) { built.set(key, [stub(s.ref, 'not available')]); continue; }
    if (live >= LIVE_ATTACHMENTS) { built.set(key, [stub(s.ref, 'an earlier attachment that is no longer loaded — ask the agent to re-attach it if you need it again')]); continue; }
    let b = cache.get(s.ref.path);
    if (!b) { b = await build(db, s.ref); cache.set(s.ref.path, b); }
    if (spent + b.bytes > BYTE_BUDGET) { built.set(key, [stub(s.ref, 'too large to load alongside the other attachments')]); continue; }
    spent += b.bytes; live++;
    built.set(key, b.parts);
    if (!lastLive) lastLive = b.parts[b.parts.length - 1];
  }
  // One cache breakpoint on the newest attachment: follow-up turns and tool rounds then reuse it cheaply.
  const marked = lastLive ? { ...(lastLive as object), cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam : null;

  return messages.map((m, mi) => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return m;
    const out: Anthropic.ContentBlockParam[] = [];
    (m.content as unknown as Array<Record<string, unknown>>).forEach((blk, bi) => {
      const parts = built.get(`${mi}:${bi}`);
      if (!parts) { const { copilot_attachment: _drop, ...clean } = blk; void _drop; out.push(clean as unknown as Anthropic.ContentBlockParam); return; }
      parts.forEach((p, i) => out.push(marked && p === lastLive && i === parts.length - 1 ? marked : p));
    });
    return { role: 'user', content: out };
  });
}

export const ATTACHMENT_ALLOWED_EXT = Object.keys(ATTACHMENT_TYPES);
